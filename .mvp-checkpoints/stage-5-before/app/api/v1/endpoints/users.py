from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logger import log_activity
from app.core.security import decode_token
from app.core.validators import Validators
from app.database import get_db
from app.dependencies import get_current_user
from app.models import ActivityLog, TokenBlacklist, User, UserSession
from app.schemas.user import UserProfileResponse, UserUpdateRequest
from app.services.billing import BillingService
from app.services.cache import redis_cache
from app.services.email import send_email
from app.utils.file_upload import save_avatar, validate_image

router = APIRouter(prefix="/users", tags=["users"])


def _role_value(role) -> str:
    return role.value if hasattr(role, "value") else str(role)


def _bool_or_default(value, default: bool = False) -> bool:
    return default if value is None else bool(value)


@router.get("/me", response_model=UserProfileResponse)
async def get_current_user_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current user profile."""
    billing = BillingService()
    try:
        balance = await billing.get_balance(current_user.billing_id)
        tariff = await billing.get_current_tariff(current_user.billing_id)
    except Exception:
        balance = None
        tariff = None

    session_result = await db.execute(
        select(UserSession).where(
            UserSession.user_id == current_user.id,
            UserSession.is_revoked == False,
            UserSession.expires_at > datetime.utcnow(),
        ),
    )
    active_sessions = session_result.scalars().all()

    activity_result = await db.execute(
        select(ActivityLog)
        .where(ActivityLog.user_id == current_user.id)
        .order_by(ActivityLog.created_at.desc())
        .limit(10),
    )
    recent_activity = activity_result.scalars().all()

    return UserProfileResponse(
        id=current_user.id,
        billing_id=current_user.billing_id or None,
        phone=current_user.phone,
        email=current_user.email,
        avatar_url=current_user.avatar_url,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        middle_name=current_user.middle_name,
        role=_role_value(current_user.role),
        is_active=_bool_or_default(current_user.is_active, default=True),
        is_verified=_bool_or_default(current_user.is_verified),
        is_2fa_enabled=_bool_or_default(current_user.is_2fa_enabled),
        created_at=current_user.created_at or datetime.utcnow(),
        last_login_at=current_user.last_login_at,
        language=current_user.language or "ru",
        balance=float(balance) if balance is not None else None,
        current_tariff=tariff,
        active_sessions_count=len(active_sessions),
        recent_activity=[
            {
                "action": item.action,
                "created_at": item.created_at,
                "ip": str(item.ip_address),
            }
            for item in recent_activity
        ],
    )


@router.put("/me")
async def update_user_profile(
    request: Request,
    update_data: UserUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update editable profile fields and allow clearing optional values."""
    payload = update_data.dict(exclude_unset=True)

    if "email" in payload:
        normalized_email = (update_data.email or "").strip()
        if normalized_email:
            valid, error = Validators.validate_email(normalized_email)
            if not valid:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

            result = await db.execute(
                select(User).where(User.email == normalized_email, User.id != current_user.id),
            )
            if result.scalar_one_or_none():
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Этот email уже используется")

            current_user.email = normalized_email
        else:
            current_user.email = None

    if "first_name" in payload:
        current_user.first_name = (update_data.first_name or "").strip()[:100] or None

    if "last_name" in payload:
        current_user.last_name = (update_data.last_name or "").strip()[:100] or None

    if "middle_name" in payload:
        current_user.middle_name = (update_data.middle_name or "").strip()[:100] or None

    if "language" in payload:
        current_user.language = (update_data.language or "ru").strip()[:8] or "ru"

    if "notification_settings" in payload:
        current_user.notification_settings = update_data.notification_settings or {}

    await db.commit()

    await log_activity(
        db,
        current_user.id,
        "profile_update",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra=payload,
    )

    return {"message": "Профиль успешно обновлён"}


@router.post("/me/avatar")
async def upload_avatar(
    request: Request,
    avatar: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload user avatar."""
    if not validate_image(avatar):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Недопустимый формат изображения или слишком большой размер файла",
        )

    avatar_path = await save_avatar(avatar, current_user.id)
    current_user.avatar_url = avatar_path
    await db.commit()

    await log_activity(
        db,
        current_user.id,
        "avatar_upload",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
    )

    return {"message": "Аватар загружен", "path": avatar_path}


@router.get("/me/sessions")
async def get_active_sessions(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all active sessions for current user."""
    result = await db.execute(
        select(UserSession).where(
            UserSession.user_id == current_user.id,
            UserSession.is_revoked == False,
            UserSession.expires_at > datetime.utcnow(),
        ),
    )
    sessions = result.scalars().all()

    return [
        {
            "id": session.id,
            "ip_address": str(session.ip_address),
            "user_agent": session.user_agent,
            "created_at": session.created_at,
            "expires_at": session.expires_at,
            "last_activity_at": session.last_activity_at,
            "is_current": session.token == request.headers.get("authorization", "").replace("Bearer ", ""),
        }
        for session in sessions
    ]


@router.delete("/me/sessions/{session_id}")
async def revoke_session(
    session_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke specific session."""
    result = await db.execute(
        select(UserSession).where(UserSession.id == session_id, UserSession.user_id == current_user.id),
    )
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сессия не найдена")

    await blacklist_token(db, session.token, current_user.id, "session_revoked")
    if session.refresh_token:
        await blacklist_token(db, session.refresh_token, current_user.id, "session_revoked")

    session.is_revoked = True
    await db.commit()

    await log_activity(
        db,
        current_user.id,
        "session_revoked",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"session_id": session_id},
    )

    return {"message": "Сессия отключена"}


@router.post("/me/change-email")
async def change_email_request(
    request: Request,
    new_email: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Request email change with verification."""
    valid, error = Validators.validate_email(new_email)
    if not valid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    result = await db.execute(select(User).where(User.email == new_email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Этот email уже используется")

    import uuid

    token = str(uuid.uuid4())
    await redis_cache.set(f"email_change:{current_user.id}:{token}", new_email, expire=3600)

    verification_url = f"https://lk.operator.ru/verify-email?token={token}"
    await send_email(
        new_email,
        "Подтвердите смену email",
        f"Перейдите по ссылке, чтобы подтвердить новый email: {verification_url}\n\nСсылка действует 1 час.",
    )

    await log_activity(
        db,
        current_user.id,
        "email_change_requested",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"new_email": new_email},
    )

    return {"message": "Письмо для подтверждения отправлено на новый адрес"}


@router.post("/me/verify-email")
async def verify_email_change(
    token: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Verify and complete email change."""
    new_email = await redis_cache.get(f"email_change:{current_user.id}:{token}")
    if not new_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Недействительный или просроченный токен")

    current_user.email = new_email
    await db.commit()

    await redis_cache.delete(f"email_change:{current_user.id}:{token}")
    await log_activity(
        db,
        current_user.id,
        "email_changed",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"new_email": new_email},
    )

    return {"message": "Адрес электронной почты успешно изменён"}


async def blacklist_token(db: AsyncSession, token: str, user_id: int, reason: str):
    """Persist token revocation in the active transaction."""
    payload = decode_token(token)
    token_type = payload.get("type", "access") if payload else "access"
    expires_at = (
        datetime.utcfromtimestamp(payload.get("exp"))
        if payload
        else datetime.utcnow() + timedelta(hours=1)
    )

    blacklisted = TokenBlacklist(
        token=token,
        token_type=token_type,
        user_id=user_id,
        revoked_at=datetime.utcnow(),
        expires_at=expires_at,
        reason=reason,
    )
    db.add(blacklisted)


@router.post("/me/sessions/logout-all")
async def logout_other_sessions(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Revoke all sessions except the current one."""
    current_token = request.headers.get("authorization", "").replace("Bearer ", "")
    result = await db.execute(
        select(UserSession).where(
            UserSession.user_id == current_user.id,
            UserSession.is_revoked == False,
        ),
    )
    sessions = result.scalars().all()

    revoked = 0
    for session in sessions:
        if current_token and session.token == current_token:
            continue
        session.is_revoked = True
        revoked += 1
        await blacklist_token(db, session.token, current_user.id, "logout_all_sessions")
        if session.refresh_token:
            await blacklist_token(db, session.refresh_token, current_user.id, "logout_all_sessions")

    await db.commit()

    await log_activity(
        db,
        current_user.id,
        "logout_other_sessions",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"revoked_sessions": revoked},
    )

    return {
        "message": "Дополнительные сессии завершены",
        "revoked_sessions": revoked,
    }
