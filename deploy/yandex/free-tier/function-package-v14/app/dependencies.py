from collections.abc import Iterable

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional, List
from app.config import settings
from app.database import get_db
from app.core.security import decode_token
from app.models import User, UserRole, TokenBlacklist
from app.services.cache import redis_cache
from app.core.rate_limit import rate_limiter
import logging

logger = logging.getLogger(__name__)
security = HTTPBearer(auto_error=False)


def _role_value(role: object) -> str:
    return role.value if hasattr(role, "value") else str(role)

async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> User:
    """Get current authenticated user"""
    
    # Check for token in cookie as well
    token = None
    if credentials:
        token = credentials.credentials
    else:
        token = request.cookies.get("access_token")
    
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Decode token
    payload = decode_token(token)
    if not payload or "sub" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Check if token is blacklisted
    blacklisted = await db.execute(
        select(TokenBlacklist).where(TokenBlacklist.token == token)
    )
    if blacklisted.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_id = int(payload["sub"])
    
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active or user.is_blocked:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is blocked or inactive"
        )
    
    # Cache user
    cache_key = f"user:{user_id}"
    await redis_cache.set(cache_key, {
        "id": user.id,
        "phone": user.phone,
        "email": user.email,
        "role": _role_value(user.role),
        "is_active": user.is_active,
        "is_blocked": user.is_blocked
    }, expire=300)
    
    return user


async def get_optional_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    try:
        return await get_current_user(request=request, credentials=credentials, db=db)
    except HTTPException as exc:
        if exc.status_code in {
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
        }:
            return None
        raise

async def get_current_admin(user: User = Depends(get_current_user)) -> User:
    """Check if user has admin role"""
    if _role_value(user.role) not in {
        _role_value(UserRole.ADMIN),
        _role_value(UserRole.OPERATOR),
        _role_value(UserRole.SUPER_ADMIN),
    }:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ разрешён только сотрудникам MTN"
        )
    return user

async def get_current_superadmin(user: User = Depends(get_current_user)) -> User:
    """Check if user has super admin role"""
    if _role_value(user.role) != _role_value(UserRole.SUPER_ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ разрешён только суперадминистратору MTN"
        )
    return user


def require_roles(allowed_roles: Iterable[UserRole | str]):
    allowed = {_role_value(role) for role in allowed_roles}

    async def dependency(user: User = Depends(get_current_user)) -> User:
        if _role_value(user.role) not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Недостаточно прав",
            )
        return user

    return dependency

def rate_limit(limit: int, window: int):
    """Rate limit dependency"""
    async def dependency(request: Request):
        if not settings.rate_limit_enabled:
            return True

        client_ip = request.client.host if request.client else "unknown"
        rate_key = f"dependency:{request.url.path}:ip:{client_ip}"
        allowed, retry_after = await rate_limiter.limiter.is_allowed(rate_key, limit, window)
        
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many requests. Try again in {retry_after} seconds",
                headers={"Retry-After": str(retry_after)}
            )
        return True
    return dependency

def rate_limit_action(action: str):
    """Rate limit by action type"""
    async def dependency(request: Request, user: Optional[User] = Depends(get_current_user)):
        if not settings.rate_limit_enabled:
            return True

        client_ip = request.client.host if request.client else "unknown"
        
        # Check by user if authenticated, else by IP
        if user:
            allowed, retry_after = await rate_limiter.check(user.id, action)
        else:
            allowed, retry_after = await rate_limiter.check_ip(client_ip, action)
        
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many {action} attempts. Try again in {retry_after} seconds",
                headers={"Retry-After": str(retry_after)}
            )
        return True
    return dependency
