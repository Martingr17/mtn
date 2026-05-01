from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_admin, get_current_user, get_optional_current_user
from app.models import User
from app.schemas.notification import (
    NotificationArchiveRequest,
    NotificationCreateRequest,
    NotificationEventTypeResponse,
    NotificationListResponse,
    NotificationMarkReadRequest,
    NotificationResponse,
    NotificationSettingsResponse,
    NotificationSettingsUpdateRequest,
    PushSubscriptionCreateRequest,
    PushSubscriptionResponse,
)
from app.services.notification_center import (
    archive_notification,
    create_notification,
    ensure_notification_settings,
    get_event_type_catalog,
    get_notification_settings_response,
    get_recent_notifications,
    get_unread_count,
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
    mark_notifications_read,
    push_supported,
    serialize_notification,
    unsubscribe_push_subscriptions,
    update_notification_settings,
    upsert_push_subscription,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])
admin_router = APIRouter(prefix="/admin/notifications", tags=["admin-notifications"])


def _require_admin_or_api_key(
    current_user: Optional[User],
    api_key: Optional[str],
) -> None:
    if current_user is not None:
        role = current_user.role.value if hasattr(current_user.role, "value") else str(current_user.role)
        if role in {"operator", "admin", "super_admin"}:
            return
    if settings.notifications_external_api_key and api_key == settings.notifications_external_api_key:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")


@router.get("", response_model=NotificationListResponse)
@router.get("/", response_model=NotificationListResponse)
async def get_notifications(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    event_type: Optional[str] = Query(default=None, alias="type"),
    is_read: Optional[bool] = Query(default=None),
    date_from: Optional[datetime] = Query(default=None, alias="from_date"),
    date_to: Optional[datetime] = Query(default=None, alias="to_date"),
    include_archived: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    payload = await list_notifications(
        db,
        user_id=current_user.id,
        page=page,
        limit=limit,
        event_type=event_type,
        is_read=is_read,
        date_from=date_from,
        date_to=date_to,
        include_archived=include_archived,
    )
    return NotificationListResponse(**payload)


@router.get("/unread/count")
async def get_unread_notifications_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return {"unread_count": await get_unread_count(db, current_user.id)}


@router.post("/{notification_id}/read", response_model=NotificationResponse)
async def read_notification(
    notification_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notification = await mark_notification_read(db, user_id=current_user.id, notification_id=notification_id)
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Уведомление не найдено")
    await db.commit()
    return NotificationResponse(**serialize_notification(notification))


@router.post("/bulk/read")
async def read_notifications_bulk(
    payload: NotificationMarkReadRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    count = await mark_notifications_read(
        db,
        user_id=current_user.id,
        notification_ids=payload.notification_ids,
    )
    await db.commit()
    return {"updated": count}


@router.post("/read-all")
@router.post("/mark-all-read")
async def read_all_notifications(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    count = await mark_all_notifications_read(db, user_id=current_user.id)
    await db.commit()
    return {"updated": count}


@router.post("/{notification_id}/archive", response_model=NotificationResponse)
async def archive_single_notification(
    notification_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notification = await archive_notification(db, user_id=current_user.id, notification_id=notification_id)
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Уведомление не найдено")
    await db.commit()
    return NotificationResponse(**serialize_notification(notification))


@router.post("/archive")
async def archive_notifications_bulk(
    payload: NotificationArchiveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    updated = 0
    for notification_id in payload.notification_ids:
        notification = await archive_notification(db, user_id=current_user.id, notification_id=notification_id)
        if notification is not None:
            updated += 1
    await db.commit()
    return {"updated": updated}


@router.delete("/{notification_id}")
async def delete_notification_legacy(
    notification_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notification = await archive_notification(db, user_id=current_user.id, notification_id=notification_id)
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Уведомление не найдено")
    await db.commit()
    return {"message": "Уведомление отправлено в архив"}


@router.get("/settings", response_model=NotificationSettingsResponse)
async def get_notification_settings_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    payload = await get_notification_settings_response(db, user=current_user)
    return NotificationSettingsResponse(**payload)


@router.put("/settings", response_model=NotificationSettingsResponse)
async def update_notification_settings_endpoint(
    payload: NotificationSettingsUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    settings_row = await update_notification_settings(db, user=current_user, payload=payload.model_dump())
    await db.commit()
    response_payload = await get_notification_settings_response(db, user=current_user)
    return NotificationSettingsResponse(**response_payload)


@router.get("/events/types", response_model=list[NotificationEventTypeResponse])
async def get_notification_event_types():
    return [NotificationEventTypeResponse(**item) for item in get_event_type_catalog()]


@router.post("/subscribe/push", response_model=PushSubscriptionResponse)
async def subscribe_push_notifications(
    payload: PushSubscriptionCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not push_supported():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push-уведомления временно недоступны",
        )
    subscription = await upsert_push_subscription(
        db,
        user_id=current_user.id,
        endpoint=payload.endpoint,
        p256dh_key=payload.keys.p256dh,
        auth_key=payload.keys.auth,
        user_agent=request.headers.get("user-agent"),
    )
    settings_row = await ensure_notification_settings(db, current_user.id, user=current_user)
    settings_row.browser_push_enabled = True
    settings_row.updated_at = datetime.utcnow()
    await db.commit()
    return PushSubscriptionResponse.model_validate(subscription, from_attributes=True)


@router.delete("/subscribe/push")
async def unsubscribe_push_notifications(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    endpoint_value = None
    try:
        payload = await request.json()
    except Exception:
        payload = None
    if isinstance(payload, dict):
        endpoint_value = payload.get("endpoint")
    elif isinstance(payload, str):
        endpoint_value = payload
    count = await unsubscribe_push_subscriptions(db, user_id=current_user.id, endpoint=endpoint_value)
    await db.commit()
    return {"updated": count}


@admin_router.post("")
async def create_admin_notification(
    payload: NotificationCreateRequest,
    request: Request,
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    _require_admin_or_api_key(current_user, x_api_key)

    target_user_ids = set(int(item) for item in payload.user_ids if int(item) > 0)
    if payload.user_id:
        target_user_ids.add(int(payload.user_id))

    if payload.all_users:
        result = await db.execute(
        select(User).where(User.is_active == True, User.is_blocked == False)
        )
        for user in result.scalars().all():
            role = user.role.value if hasattr(user.role, "value") else str(user.role)
            if role not in {"operator", "admin", "super_admin"}:
                target_user_ids.add(user.id)

    if not target_user_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Не указаны получатели")

    result = await db.execute(select(User).where(User.id.in_(sorted(target_user_ids))))
    users = list(result.scalars().all())
    if not users:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Получатели не найдены")

    created = 0
    for user in users:
        await create_notification(
            db,
            user_id=user.id,
            user=user,
            title=payload.title,
            message=payload.message,
            event_type=payload.event_type,
            category=payload.category,
            priority=payload.priority,
            delivery_type=payload.delivery_type,
            action_url=payload.action_url,
            metadata=payload.data,
            expires_at=payload.expires_at,
        )
        created += 1

    await db.commit()
    return {"created": created, "recipient_count": len(users)}
