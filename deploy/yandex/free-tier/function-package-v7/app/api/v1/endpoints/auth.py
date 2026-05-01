from fastapi import APIRouter, Depends, HTTPException, status, Request, BackgroundTasks, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from datetime import datetime, timedelta
from typing import Optional
import uuid
import pyotp
import qrcode
from io import BytesIO
import base64

from app.database import get_db
from app.schemas.auth import (
    LoginRequest, LoginResponse, RefreshRequest, RegisterRequest, 
    RegisterConfirmRequest, ChangePasswordRequest, ResetPasswordRequest,
    TwoFactorSetupResponse, TwoFactorVerifyRequest,
    TwoFactorLoginRequest,
)
from app.models import User, UserSession, TokenBlacklist, UserRole
from app.core.security import (
    verify_password, get_password_hash, create_access_token, 
    create_refresh_token, decode_token
)
from app.services.sms import send_sms_code, verify_sms_code
from app.services.email import send_email
from app.services.billing import BillingService
from app.services.cache import redis_cache
from app.core.logger import log_activity
from app.dependencies import rate_limit, get_current_user
from app.core.validators import Validators
from app.config import settings

router = APIRouter(prefix="/auth", tags=["authentication"])
security = HTTPBearer()


def _demo_sms_payload(phone: str, code: Optional[str]) -> dict:
    if not code or not settings.demo_show_sms_code:
        return {}
    return {
        "demo_sms_code": code,
        "demo_sms_phone": phone,
        "demo_sms_ttl": 300,
    }


def _role_value(role: object) -> str:
    return role.value if hasattr(role, "value") else str(role)


def _is_staff_user(user: User) -> bool:
    return _role_value(user.role) in {
        UserRole.ADMIN.value,
        UserRole.OPERATOR.value,
        UserRole.SUPER_ADMIN.value,
    }


def _ensure_staff_2fa(user: User) -> None:
    if not _is_staff_user(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Двухфакторная защита доступна только для сотрудников.",
        )


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    secure_cookie = settings.environment == "production"
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=secure_cookie,
        samesite="strict",
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=secure_cookie,
        samesite="strict",
        max_age=settings.refresh_token_expire_days * 24 * 3600,
        path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")


async def _issue_login_tokens(
    *,
    user: User,
    request: Request,
    db: AsyncSession,
    response: Optional[Response] = None,
    auth_method: str,
) -> LoginResponse:
    access_token = create_access_token(data={"sub": str(user.id), "role": _role_value(user.role), "jti": str(uuid.uuid4())})
    refresh_token = create_refresh_token(data={"sub": str(user.id), "jti": str(uuid.uuid4())})

    session = UserSession(
        user_id=user.id,
        token=access_token,
        refresh_token=refresh_token,
        ip_address=request.client.host,
        user_agent=request.headers.get("user-agent", ""),
        expires_at=datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes),
        device_info={},
    )
    db.add(session)

    user.last_login_at = datetime.utcnow()
    user.last_login_ip = request.client.host
    await db.commit()

    await log_activity(
        db,
        user.id,
        "login",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"method": auth_method},
    )

    if response is not None:
        _set_auth_cookies(response, access_token, refresh_token)

    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.access_token_expire_minutes * 60,
        user_id=user.id,
        role=_role_value(user.role),
        requires_2fa=False,
        two_factor_token=None,
        message="Вход выполнен успешно.",
    )

@router.post("/login", response_model=LoginResponse)
async def login(
    request: Request,
    login_data: LoginRequest,
    background_tasks: BackgroundTasks,
    response: Response,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(rate_limit(5, 60))
):
    """Аутентификация по паролю или SMS-коду"""
    
    # Find user by phone
    result = await db.execute(select(User).where(User.phone == login_data.phone))
    user = result.scalar_one_or_none()
    
    if not user:
        # Log failed attempt
        await log_activity(db, None, "login_failed", request.client.host, request.headers.get("user-agent", ""), 
                          extra={"phone": login_data.phone, "reason": "user_not_found"})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный номер телефона или код подтверждения")
    
    if user.is_blocked:
        await log_activity(db, user.id, "login_failed", request.client.host, request.headers.get("user-agent", ""),
                          extra={"reason": "account_blocked"})
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Аккаунт временно заблокирован")

    if not user.is_active:
        await log_activity(db, user.id, "login_failed", request.client.host, request.headers.get("user-agent", ""),
                          extra={"reason": "account_not_activated"})
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Сначала завершите регистрацию и подтвердите номер кодом из SMS."
        )
    
    # Check login attempts
    attempts_key = f"login_attempts:{user.id}"
    attempts = await redis_cache.get(attempts_key, 0)
    if attempts >= settings.max_login_attempts:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Слишком много попыток входа. Попробуйте снова через {settings.lockout_minutes} минут."
        )
    
    authenticated = False
    auth_method = None
    
    # Staff login with password
    if _is_staff_user(user):
        if not login_data.password:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Для сотрудников требуется пароль")
        
        if not user.password_hash:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Пароль не задан. Сначала выполните восстановление доступа.")
        
        if verify_password(login_data.password, user.password_hash):
            authenticated = True
            auth_method = "password"
    
    # User login with SMS code
    else:
        if login_data.sms_code:
            if await verify_sms_code(user.phone, login_data.sms_code):
                authenticated = True
                auth_method = "sms"
        elif not login_data.sms_code:
            # No code provided, send one
            demo_sms_code = await send_sms_code(user.phone, background_tasks)
            return LoginResponse(
                access_token="",
                refresh_token="",
                expires_in=0,
                user_id=user.id,
                role=_role_value(user.role),
                requires_2fa=False,
                two_factor_token=None,
                message="Код подтверждения отправлен. Введите его в это же окно, чтобы завершить вход.",
                **_demo_sms_payload(user.phone, demo_sms_code),
            )
    
    # Check 2FA if enabled
    requires_2fa = False
    two_factor_token = None
    
    if authenticated and user.is_2fa_enabled and user.totp_secret:
        if not login_data.totp_code:
            # Generate temporary token for 2FA
            two_factor_token = str(uuid.uuid4())
            await redis_cache.set(f"2fa_token:{two_factor_token}", str(user.id), expire=300)
            return LoginResponse(
                access_token="",
                refresh_token="",
                expires_in=0,
                user_id=user.id,
                role=_role_value(user.role),
                requires_2fa=True,
                two_factor_token=two_factor_token,
                message="Основная проверка пройдена. Теперь введите код из приложения-аутентификатора.",
            )
        else:
            # Verify TOTP code
            totp = pyotp.TOTP(user.totp_secret)
            if not totp.verify(login_data.totp_code):
                authenticated = False
                await redis_cache.incr(attempts_key)
                await redis_cache.expire(attempts_key, settings.lockout_minutes * 60)
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный код двухфакторной аутентификации")
    
    if not authenticated:
        # Increment failed attempts
        await redis_cache.incr(attempts_key)
        await redis_cache.expire(attempts_key, settings.lockout_minutes * 60)
        
        await log_activity(db, user.id, "login_failed", request.client.host, request.headers.get("user-agent", ""),
                          extra={"reason": "invalid_credentials", "method": auth_method})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Не удалось подтвердить вход. Проверьте пароль или SMS-код.")
    
    # Reset attempts on successful login
    await redis_cache.delete(attempts_key)
    
    # Generate tokens
    access_token = create_access_token(data={"sub": str(user.id), "role": _role_value(user.role), "jti": str(uuid.uuid4())})
    refresh_token = create_refresh_token(data={"sub": str(user.id), "jti": str(uuid.uuid4())})
    
    # Store session
    session = UserSession(
        user_id=user.id,
        token=access_token,
        refresh_token=refresh_token,
        ip_address=request.client.host,
        user_agent=request.headers.get("user-agent", ""),
        expires_at=datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes),
        device_info={}
    )
    db.add(session)
    
    # Update user last login
    user.last_login_at = datetime.utcnow()
    user.last_login_ip = request.client.host
    await db.commit()
    
    # Log successful login
    await log_activity(db, user.id, "login", request.client.host, request.headers.get("user-agent", ""),
                      extra={"method": auth_method})
    
    _set_auth_cookies(response, access_token, refresh_token)
    
    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.access_token_expire_minutes * 60,
        user_id=user.id,
        role=_role_value(user.role),
        requires_2fa=requires_2fa,
        two_factor_token=two_factor_token,
        message="Вход выполнен успешно.",
    )

@router.post("/2fa/login", response_model=LoginResponse)
async def complete_two_factor_login(
    request: Request,
    payload: TwoFactorLoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    _: bool = Depends(rate_limit(5, 60))
):
    """Р—Р°РІРµСЂС€РёС‚СЊ РІС…РѕРґ РїРѕ РІСЂРµРјРµРЅРЅРѕРјСѓ 2FA-С‚РѕРєРµРЅСѓ."""

    user_id = await redis_cache.get(f"2fa_token:{payload.two_factor_token}")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="РЎРµСЃСЃРёСЏ РґРІСѓС…С„Р°РєС‚РѕСЂРЅРѕР№ РїСЂРѕРІРµСЂРєРё РёСЃС‚РµРєР»Р°."
        )

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user or not user.is_active or user.is_blocked:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµРґРѕСЃС‚СѓРїРµРЅ РґР»СЏ РІС…РѕРґР°."
        )

    if not user.is_2fa_enabled or not user.totp_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Р”РІСѓС…С„Р°РєС‚РѕСЂРЅР°СЏ Р·Р°С‰РёС‚Р° РґР»СЏ СЌС‚РѕР№ СѓС‡С‘С‚РЅРѕР№ Р·Р°РїРёСЃРё РЅРµ Р°РєС‚РёРІРЅР°."
        )

    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(payload.code):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="РќРµРІРµСЂРЅС‹Р№ РєРѕРґ РґРІСѓС…С„Р°РєС‚РѕСЂРЅРѕР№ Р°СѓС‚РµРЅС‚РёС„РёРєР°С†РёРё."
        )

    await redis_cache.delete(f"2fa_token:{payload.two_factor_token}")
    return await _issue_login_tokens(
        user=user,
        request=request,
        db=db,
        response=response,
        auth_method="password+2fa",
    )


@router.post("/refresh", response_model=LoginResponse)
async def refresh_token(
    request: Request,
    refresh_data: RefreshRequest,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """Обновление access-токена по refresh-токену"""
    
    # Also check cookie for refresh token
    refresh_token = refresh_data.refresh_token or request.cookies.get("refresh_token")
    
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Требуется refresh-токен")
    
    # Decode refresh token
    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh" or "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный refresh-токен")
    
    # Check if token is blacklisted
    is_blacklisted = await db.execute(
        select(TokenBlacklist).where(TokenBlacklist.token == refresh_token)
    )
    if is_blacklisted.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Токен отозван")
    
    user_id = int(payload["sub"])
    
    # Verify session exists
    session_result = await db.execute(
        select(UserSession).where(
            and_(
                UserSession.user_id == user_id,
                UserSession.refresh_token == refresh_token,
                UserSession.is_revoked == False
            )
        )
    )
    session = session_result.scalar_one_or_none()
    
    if not session or session.is_expired:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Сессия истекла")
    
    # Get user
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    
    if not user or not user.is_active or user.is_blocked:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Пользователь недоступен для авторизации")
    
    # Generate new tokens
    new_access = create_access_token(data={"sub": str(user.id), "role": _role_value(user.role), "jti": str(uuid.uuid4())})
    new_refresh = create_refresh_token(data={"sub": str(user.id), "jti": str(uuid.uuid4())})
    
    # Update session
    session.token = new_access
    session.refresh_token = new_refresh
    session.expires_at = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    session.last_activity_at = datetime.utcnow()
    await db.commit()

    _set_auth_cookies(response, new_access, new_refresh)
    
    return LoginResponse(
        access_token=new_access,
        refresh_token=new_refresh,
        expires_in=settings.access_token_expire_minutes * 60,
        user_id=user.id,
        role=_role_value(user.role),
        requires_2fa=False,
        two_factor_token=None
    )

@router.post("/register")
async def register(
    reg_data: RegisterRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """Запуск регистрации нового абонента"""
    
    billing_id = reg_data.billing_id.upper()

    result = await db.execute(select(User).where(User.phone == reg_data.phone))
    existing_user = result.scalar_one_or_none()
    billing_result = await db.execute(select(User).where(User.billing_id == billing_id))
    billing_user = billing_result.scalar_one_or_none()

    if billing_user and (existing_user is None or billing_user.id != existing_user.id):
        detail = (
            "Этот лицевой счет уже привязан к другому аккаунту."
            if billing_user.is_active
            else "Регистрация для этого лицевого счета уже начата с другим номером телефона."
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    if existing_user:
        if existing_user.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Этот номер уже зарегистрирован")

        existing_user.billing_id = billing_id
        existing_user.email = reg_data.email
        existing_user.first_name = reg_data.first_name
        existing_user.last_name = reg_data.last_name
        existing_user.updated_at = datetime.utcnow()
        await db.commit()

        demo_sms_code = await send_sms_code(reg_data.phone, background_tasks)
        await log_activity(
            db,
            existing_user.id,
            "register_resend",
            "127.0.0.1",
            "system",
            extra={"billing_id": reg_data.billing_id}
        )

        return {
            "message": "Регистрация уже была начата. Мы отправили новый SMS-код на ваш номер.",
            "user_id": existing_user.id,
            "requires_confirmation": True,
            **_demo_sms_payload(reg_data.phone, demo_sms_code),
        }
    
    # Verify billing account exists
    billing = BillingService()
    try:
        account_info = await billing.get_account_info(reg_data.billing_id)
        if not account_info:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Лицевой счёт не найден")
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Биллинг временно недоступен")
    
    # Create temporary user (inactive until SMS confirmation)
    new_user = User(
        billing_id=billing_id,
        phone=reg_data.phone,
        email=reg_data.email,
        first_name=reg_data.first_name,
        last_name=reg_data.last_name,
        role=UserRole.USER,
        is_active=False,  # Will activate after SMS confirmation
        is_verified=False
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    
    # Send SMS verification code
    demo_sms_code = await send_sms_code(reg_data.phone, background_tasks)
    
    await log_activity(db, new_user.id, "register", "127.0.0.1", "system",
                      extra={"billing_id": reg_data.billing_id})
    
    return {
        "message": "Регистрация начата. Код подтверждения уже отправлен на ваш номер.",
        "user_id": new_user.id,
        "requires_confirmation": True,
        **_demo_sms_payload(reg_data.phone, demo_sms_code),
    }

@router.post("/register/confirm")
async def confirm_registration(
    confirm: RegisterConfirmRequest,
    db: AsyncSession = Depends(get_db)
):
    """Подтверждение регистрации по SMS-коду"""
    
    result = await db.execute(select(User).where(User.phone == confirm.phone))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")
    
    if user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Аккаунт уже активирован")
    
    # Verify SMS code
    if not await verify_sms_code(confirm.phone, confirm.sms_code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный SMS-код")
    
    # Activate user
    user.is_active = True
    user.is_verified = True
    
    # Set password if provided (for staff)
    if confirm.password:
        valid, error = Validators.validate_password(confirm.password)
        if not valid:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)
        user.set_password(confirm.password)
    
    await db.commit()
    
    # Send welcome email
    if user.email:
        background_tasks = None  # Will be handled by Celery
        await send_email(
            user.email,
            "Добро пожаловать в личный кабинет",
            f"{user.first_name or user.phone},\n\nВаш аккаунт успешно активирован.\n\nТеперь можно войти в личный кабинет и пользоваться сервисом."
        )
    
    await log_activity(db, user.id, "register_confirm", "127.0.0.1", "system")
    
    return {"message": "Регистрация подтверждена. Теперь можно войти в личный кабинет."}

@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Logout user - revoke tokens"""
    
    # Get token from header
    auth_header = request.headers.get("authorization", "")
    token = auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else request.cookies.get("access_token")
    
    if token:
        # Add to blacklist
        payload = decode_token(token)
        expires_at = datetime.utcfromtimestamp(payload.get("exp")) if payload else datetime.utcnow() + timedelta(hours=1)
        
        blacklisted = TokenBlacklist(
            token=token,
            token_type="access",
            user_id=user.id,
            revoked_at=datetime.utcnow(),
            expires_at=expires_at,
            reason="user_logout"
        )
        db.add(blacklisted)
        
        # Revoke session
        session_result = await db.execute(
            select(UserSession).where(UserSession.token == token)
        )
        session = session_result.scalar_one_or_none()
        if session:
            session.is_revoked = True
    
    # Also blacklist refresh token from cookie
    refresh_token = request.cookies.get("refresh_token")
    if refresh_token:
        blacklisted = TokenBlacklist(
            token=refresh_token,
            token_type="refresh",
            user_id=user.id,
            revoked_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(days=settings.refresh_token_expire_days),
            reason="user_logout"
        )
        db.add(blacklisted)
    
    await db.commit()
    
    _clear_auth_cookies(response)
    
    await log_activity(db, user.id, "logout", request.client.host, request.headers.get("user-agent", ""))
    
    return {"message": "Выход выполнен успешно"}

@router.post("/change-password")
async def change_password(
    request: Request,
    password_data: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Change user password"""
    
    if not user.password_hash:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Пароль не задан. Используйте восстановление доступа.")
    
    if not verify_password(password_data.old_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный текущий пароль")
    
    user.set_password(password_data.new_password)
    await db.commit()
    
    await log_activity(db, user.id, "password_change", request.client.host, request.headers.get("user-agent", ""))
    
    return {"message": "Пароль успешно изменён"}

@router.post("/reset-password")
async def reset_password(
    request: Request,
    reset_data: ResetPasswordRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """Восстановление пароля"""
    
    result = await db.execute(select(User).where(User.phone == reset_data.phone))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Сначала активируйте аккаунт, затем можно восстанавливать пароль."
        )

    if not reset_data.sms_code and not reset_data.new_password:
        demo_sms_code = await send_sms_code(reset_data.phone, background_tasks)
        await log_activity(
            db, user.id, "password_reset_requested",
            request.client.host, request.headers.get("user-agent", "")
        )
        return {
            "message": "Код подтверждения отправлен. Введите его и задайте новый пароль.",
            **_demo_sms_payload(reset_data.phone, demo_sms_code),
        }

    if not reset_data.sms_code or not reset_data.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Для завершения восстановления нужны SMS-код и новый пароль."
        )
    
    # Verify SMS code
    if not await verify_sms_code(reset_data.phone, reset_data.sms_code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный SMS-код")
    
    # Set new password
    user.set_password(reset_data.new_password)
    await db.commit()
    
    # Revoke all user sessions
    sessions_result = await db.execute(
        select(UserSession).where(UserSession.user_id == user.id)
    )
    sessions = sessions_result.scalars().all()
    for session in sessions:
        session.is_revoked = True
    
    # Blacklist all tokens
    for session in sessions:
        blacklisted = TokenBlacklist(
            token=session.token,
            token_type="access",
            user_id=user.id,
            revoked_at=datetime.utcnow(),
            expires_at=session.expires_at,
            reason="password_reset"
        )
        db.add(blacklisted)
        
        if session.refresh_token:
            blacklisted_refresh = TokenBlacklist(
                token=session.refresh_token,
                token_type="refresh",
                user_id=user.id,
                revoked_at=datetime.utcnow(),
                expires_at=datetime.utcnow() + timedelta(days=settings.refresh_token_expire_days),
                reason="password_reset"
            )
            db.add(blacklisted_refresh)
    
    await db.commit()
    
    # Send confirmation email
    if user.email:
        await send_email(
            user.email,
            "Пароль изменён",
            "Пароль для входа в личный кабинет успешно изменён. Если это сделали не вы, срочно свяжитесь с поддержкой."
        )
    
    await log_activity(db, user.id, "password_reset", request.client.host, request.headers.get("user-agent", ""))
    
    return {"message": "Пароль успешно изменён. Теперь войдите с новым паролем."}

@router.post("/2fa/setup", response_model=TwoFactorSetupResponse)
async def setup_2fa(
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Подготовить двухфакторную аутентификацию"""
    
    _ensure_staff_2fa(user)
    if user.is_2fa_enabled and user.totp_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA уже включена для этой учётной записи",
        )

    # Generate TOTP secret
    secret = pyotp.random_base32()
    
    # Generate OTP auth URL
    totp = pyotp.TOTP(secret)
    otpauth_url = totp.provisioning_uri(
        name=user.phone,
        issuer_name="MTN | Martin Telecom Network"
    )
    
    # Generate QR code
    qr = qrcode.QRCode(box_size=10, border=4)
    qr.add_data(otpauth_url)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    buffered = BytesIO()
    img.save(buffered, format="PNG")
    qr_base64 = base64.b64encode(buffered.getvalue()).decode()
    
    # Store secret temporarily (not yet enabled)
    await redis_cache.set(f"2fa_secret:{user.id}", secret, expire=600)
    
    await log_activity(db, user.id, "2fa_setup_initiated", request.client.host, request.headers.get("user-agent", ""))
    
    return TwoFactorSetupResponse(
        secret=secret,
        otpauth_url=otpauth_url,
        qr_code=f"data:image/png;base64,{qr_base64}"
    )

@router.post("/2fa/verify")
async def verify_2fa(
    request: Request,
    verify_data: TwoFactorVerifyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Проверить код и включить 2FA"""
    
    _ensure_staff_2fa(user)

    # Get temporary secret
    secret = await redis_cache.get(f"2fa_secret:{user.id}")
    if not secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Настройка 2FA ещё не была начата")
    
    # Verify code
    totp = pyotp.TOTP(secret)
    if not totp.verify(verify_data.code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный проверочный код")
    
    # Enable 2FA
    user.totp_secret = secret
    user.is_2fa_enabled = True
    await db.commit()
    
    # Clean up temporary secret
    await redis_cache.delete(f"2fa_secret:{user.id}")
    
    # Generate backup codes (optional)
    backup_codes = [pyotp.random_base32()[:8] for _ in range(10)]
    await redis_cache.set(f"2fa_backup_codes:{user.id}", backup_codes, expire=86400 * 365)
    
    await log_activity(db, user.id, "2fa_enabled", request.client.host, request.headers.get("user-agent", ""))
    
    return {
        "message": "Двухфакторная защита включена",
        "backup_codes": backup_codes  # Show once
    }

@router.post("/2fa/disable")
async def disable_2fa(
    request: Request,
    verify_data: TwoFactorVerifyRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Отключить двухфакторную аутентификацию"""
    
    _ensure_staff_2fa(user)

    if not user.is_2fa_enabled or not user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA сейчас не включена")
    
    # Verify code
    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(verify_data.code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный проверочный код")
    
    # Disable 2FA
    user.totp_secret = None
    user.is_2fa_enabled = False
    await db.commit()
    
    await redis_cache.delete(f"2fa_backup_codes:{user.id}")
    await log_activity(db, user.id, "2fa_disabled", request.client.host, request.headers.get("user-agent", ""))
    
    return {"message": "Двухфакторная защита отключена"}
