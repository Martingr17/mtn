import math
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import MvpRole
from app.database import get_db
from app.dependencies import require_mvp_roles
from app.models import AuditLog, User
from app.schemas.audit import AuditActorResponse, AuditLogListResponse, AuditLogResponse


router = APIRouter(prefix="/audit", tags=["audit"])

AUDIT_ROLES = (MvpRole.ADMIN,)


def _role_value(role: object) -> str:
    return role.value if hasattr(role, "value") else str(role)


def _display_name(user: User) -> str:
    return getattr(user, "full_name", None) or " ".join(
        part for part in [user.last_name, user.first_name, user.middle_name] if part
    ) or user.phone


def audit_log_payload(item: AuditLog) -> dict[str, Any]:
    actor = item.user
    return {
        "id": item.id,
        "user_id": item.user_id,
        "entity_type": item.entity_type,
        "entity_id": item.entity_id,
        "action": item.operation,
        "operation": item.operation,
        "changes": item.changes if isinstance(item.changes, dict) else None,
        "ip_address": str(item.ip_address),
        "user_agent": item.user_agent,
        "reason": item.reason,
        "requires_retention": bool(item.requires_retention),
        "created_at": item.created_at,
        "actor": AuditActorResponse(
            id=actor.id,
            full_name=_display_name(actor),
            role=_role_value(actor.role),
        )
        if actor is not None
        else None,
    }


async def _actor_ids_for_filter(db: AsyncSession, actor: str) -> list[int]:
    actor = actor.strip()
    if not actor:
        return []

    term = f"%{actor}%"
    result = await db.execute(
        select(User.id).where(
            or_(
                User.phone.ilike(term),
                User.email.ilike(term),
                User.billing_id.ilike(term),
                User.first_name.ilike(term),
                User.last_name.ilike(term),
                User.middle_name.ilike(term),
            ),
        ),
    )
    return [int(item) for item in result.scalars().all()]


@router.get("", response_model=AuditLogListResponse)
async def list_audit_logs(
    entity_type: str = Query("all", max_length=64),
    action: str = Query("all", max_length=64),
    actor: str = Query("", max_length=120),
    actor_id: Optional[int] = Query(None, ge=1),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_mvp_roles(AUDIT_ROLES)),
) -> AuditLogListResponse:
    filters = []

    if entity_type != "all":
        filters.append(AuditLog.entity_type == entity_type)
    if action != "all":
        filters.append(AuditLog.operation == action)
    if actor_id is not None:
        filters.append(AuditLog.user_id == actor_id)
    elif actor.strip():
        actor_ids = await _actor_ids_for_filter(db, actor)
        filters.append(AuditLog.user_id.in_(actor_ids) if actor_ids else AuditLog.user_id == -1)
    if date_from is not None:
        filters.append(AuditLog.created_at >= date_from)
    if date_to is not None:
        filters.append(AuditLog.created_at <= date_to)

    total = int(await db.scalar(select(func.count()).select_from(AuditLog).where(*filters)) or 0)
    result = await db.execute(
        select(AuditLog)
        .options(selectinload(AuditLog.user))
        .where(*filters)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size),
    )
    items = [AuditLogResponse(**audit_log_payload(item)) for item in result.scalars().all()]
    return AuditLogListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=max(math.ceil(total / page_size), 1),
    )
