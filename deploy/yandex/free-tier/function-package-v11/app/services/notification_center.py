from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, time, timedelta
from typing import Any, Dict, Iterable, List, Optional, Sequence

from sqlalchemy import and_, desc, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.constants import NotificationPriority, NotificationType
from app.models import MonitoringNotificationSetting, Notification, PushSubscription, User
from app.services.websocket_manager import websocket_manager

logger = logging.getLogger(__name__)

try:
    from pywebpush import WebPushException, webpush
except Exception:  # pragma: no cover - optional dependency in local runtime
    WebPushException = Exception
    webpush = None


DEFAULT_ENABLED_EVENT_TYPES: List[str] = [
    "connection_issues",
    "maintenance",
    "news",
    "tariff_changes",
    "payment",
    "tickets",
]

NOTIFICATION_EVENT_TYPES: List[Dict[str, Any]] = [
    {
        "key": "connection_issues",
        "label": "Проблемы с соединением",
        "description": "Обрывы, высокий пинг, потери пакетов и другие отклонения линии.",
        "icon": "🚨",
        "color": "danger",
        "default_enabled": True,
    },
    {
        "key": "maintenance",
        "label": "Плановые технические работы",
        "description": "Предупреждения о сервисных окнах и возможных перерывах.",
        "icon": "🔧",
        "color": "primary",
        "default_enabled": True,
    },
    {
        "key": "news",
        "label": "Новости и акции",
        "description": "Обновления сервиса, выгодные предложения и важные новости MTN.",
        "icon": "ℹ️",
        "color": "neutral",
        "default_enabled": True,
    },
    {
        "key": "tariff_changes",
        "label": "Смена тарифа и услуг",
        "description": "Подтверждения изменений по тарифу, услугам и дополнительным опциям.",
        "icon": "📶",
        "color": "info",
        "default_enabled": True,
    },
    {
        "key": "traffic_threshold",
        "label": "Достижение порога трафика",
        "description": "Предупреждения о приближении к лимиту или исчерпании пакета.",
        "icon": "📊",
        "color": "warning",
        "default_enabled": False,
    },
    {
        "key": "payment",
        "label": "Платежи и баланс",
        "description": "Списания, пополнения и предупреждения о низком балансе.",
        "icon": "💳",
        "color": "warning",
        "default_enabled": True,
    },
    {
        "key": "tickets",
        "label": "Заявки и поддержка",
        "description": "Ответы оператора, изменения статусов и важные действия по обращениям.",
        "icon": "🎧",
        "color": "info",
        "default_enabled": True,
    },
]

SEMANTIC_TYPE_META: Dict[str, Dict[str, str]] = {
    "critical": {"icon": "🚨", "color": "danger"},
    "warning": {"icon": "⚠️", "color": "warning"},
    "resolved": {"icon": "✅", "color": "success"},
    "maintenance": {"icon": "🔧", "color": "primary"},
    "info": {"icon": "ℹ️", "color": "neutral"},
    "payment": {"icon": "💳", "color": "warning"},
}

PRIORITY_LABELS = {
    NotificationPriority.LOW: "Низкий",
    NotificationPriority.NORMAL: "Обычный",
    NotificationPriority.HIGH: "Высокий",
    NotificationPriority.URGENT: "Срочный",
}


def push_supported() -> bool:
    return bool(settings.webpush_vapid_public_key and settings.webpush_vapid_private_key and webpush)


def get_event_type_catalog() -> List[Dict[str, Any]]:
    return [dict(item) for item in NOTIFICATION_EVENT_TYPES]


def _normalize_enabled_types(values: Optional[Iterable[str]]) -> List[str]:
    allowed = {item["key"] for item in NOTIFICATION_EVENT_TYPES}
    cleaned: List[str] = []
    for value in values or []:
        normalized = str(value or "").strip()
        if normalized and normalized in allowed and normalized not in cleaned:
            cleaned.append(normalized)
    return cleaned or DEFAULT_ENABLED_EVENT_TYPES.copy()


def _normalize_time_value(value: Optional[str | time]) -> Optional[time]:
    if value is None or value == "":
        return None
    if isinstance(value, time):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        hour, minute = text.split(":", 1)
        return time(hour=int(hour), minute=int(minute))
    except Exception:
        return None


def _legacy_enabled_types(settings_payload: Dict[str, Any]) -> List[str]:
    enabled = {item["key"] for item in NOTIFICATION_EVENT_TYPES if item["default_enabled"]}
    if settings_payload.get("payment_notifications") is False:
        enabled.discard("payment")
    if settings_payload.get("ticket_notifications") is False:
        enabled.discard("tickets")
    return sorted(enabled)


def _sync_legacy_user_settings(user: Optional[User], settings_row: MonitoringNotificationSetting) -> None:
    if user is None:
        return

    enabled_types = _normalize_enabled_types(settings_row.enabled_event_types)
    legacy = dict(user.notification_settings or {})
    legacy.update(
        {
            "monitoring_enabled": bool(settings_row.monitoring_enabled),
            "site_enabled": bool(settings_row.site_enabled),
            "email_enabled": bool(settings_row.email_enabled),
            "telegram_enabled": bool(settings_row.telegram_enabled),
            "browser_push_enabled": bool(settings_row.browser_push_enabled),
            "push_enabled": bool(settings_row.browser_push_enabled),
            "payment_notifications": "payment" in enabled_types,
            "ticket_notifications": "tickets" in enabled_types,
            "enabled_event_types": enabled_types,
            "quiet_hours_start": settings_row.quiet_hours_start.isoformat(timespec="minutes")
            if settings_row.quiet_hours_start
            else None,
            "quiet_hours_end": settings_row.quiet_hours_end.isoformat(timespec="minutes")
            if settings_row.quiet_hours_end
            else None,
        }
    )
    user.notification_settings = legacy


async def ensure_notification_settings(
    db: AsyncSession,
    user_id: int,
    user: Optional[User] = None,
) -> MonitoringNotificationSetting:
    result = await db.execute(
        select(MonitoringNotificationSetting).where(MonitoringNotificationSetting.user_id == user_id)
    )
    settings_row = result.scalar_one_or_none()

    legacy = dict((user.notification_settings or {}) if user is not None else {})
    if settings_row is None:
        settings_row = MonitoringNotificationSetting(
            user_id=user_id,
            monitoring_enabled=bool(legacy.get("monitoring_enabled", True)),
            site_enabled=bool(legacy.get("site_enabled", True)),
            email_enabled=bool(legacy.get("email_enabled", False)),
            telegram_enabled=bool(legacy.get("telegram_enabled", False)),
            browser_push_enabled=bool(
                legacy.get("browser_push_enabled", legacy.get("push_enabled", False))
            ),
            enabled_event_types=_normalize_enabled_types(
                legacy.get("enabled_event_types") or _legacy_enabled_types(legacy)
            ),
            quiet_hours_start=_normalize_time_value(legacy.get("quiet_hours_start")),
            quiet_hours_end=_normalize_time_value(legacy.get("quiet_hours_end")),
            telegram_chat_id=legacy.get("telegram_chat_id"),
            alert_cooldown_minutes=int(
                legacy.get("alert_cooldown_minutes", settings.monitoring_alert_cooldown_minutes)
            ),
            updated_at=datetime.utcnow(),
        )
        db.add(settings_row)
        await db.flush()
    else:
        if settings_row.enabled_event_types in (None, []):
            settings_row.enabled_event_types = _normalize_enabled_types(
                legacy.get("enabled_event_types") or _legacy_enabled_types(legacy)
            )
        if settings_row.site_enabled is None:
            settings_row.site_enabled = True
        if settings_row.alert_cooldown_minutes is None:
            settings_row.alert_cooldown_minutes = settings.monitoring_alert_cooldown_minutes

    _sync_legacy_user_settings(user, settings_row)
    return settings_row


def serialize_notification(notification: Notification) -> Dict[str, Any]:
    event_type = str(getattr(notification, "event_type", "info") or "info")
    priority = notification.priority
    priority_value = priority.value if hasattr(priority, "value") else int(priority or 0)
    priority_enum = priority if isinstance(priority, NotificationPriority) else NotificationPriority(priority_value)
    delivery_type = notification.type.value if hasattr(notification.type, "value") else str(notification.type)
    meta = SEMANTIC_TYPE_META.get(event_type, SEMANTIC_TYPE_META["info"])
    return {
        "id": notification.id,
        "title": notification.title,
        "message": notification.body,
        "body": notification.body,
        "type": delivery_type,
        "priority": priority_value,
        "priority_label": PRIORITY_LABELS.get(priority_enum, "Обычный"),
        "event_type": event_type,
        "category": str(getattr(notification, "category", "system") or "system"),
        "is_read": bool(notification.is_read),
        "is_archived": bool(getattr(notification, "is_archived", False)),
        "is_sent": bool(notification.is_sent),
        "action_url": notification.action_url,
        "action_data": notification.action_data or {},
        "metadata": getattr(notification, "meta", None) or {},
        "created_at": notification.created_at,
        "sent_at": notification.sent_at,
        "read_at": getattr(notification, "read_at", None),
        "expires_at": getattr(notification, "expires_at", None),
        "icon": meta["icon"],
        "color": meta["color"],
    }


async def get_unread_count(db: AsyncSession, user_id: int) -> int:
    unread = await db.scalar(
        select(func.count()).select_from(Notification).where(
            Notification.user_id == user_id,
                Notification.is_archived == False,
                Notification.is_read == False,
        )
    )
    return int(unread or 0)


async def list_notifications(
    db: AsyncSession,
    *,
    user_id: int,
    page: int,
    limit: int,
    event_type: Optional[str] = None,
    is_read: Optional[bool] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    include_archived: bool = False,
) -> Dict[str, Any]:
    filters = [Notification.user_id == user_id]
    if not include_archived:
            filters.append(Notification.is_archived == False)
    if event_type:
        filters.append(Notification.event_type == event_type)
    if is_read is not None:
        filters.append(Notification.is_read.is_(is_read))
    if date_from:
        filters.append(Notification.created_at >= date_from)
    if date_to:
        filters.append(Notification.created_at <= date_to)

    total = await db.scalar(select(func.count()).select_from(Notification).where(*filters))
    unread_count = await get_unread_count(db, user_id)

    result = await db.execute(
        select(Notification)
        .where(*filters)
        .order_by(desc(Notification.created_at))
        .offset((page - 1) * limit)
        .limit(limit)
    )
    notifications = list(result.scalars().all())
    return {
        "items": [serialize_notification(item) for item in notifications],
        "total": int(total or 0),
        "page": page,
        "limit": limit,
        "unread_count": unread_count,
    }


async def get_recent_notifications(
    db: AsyncSession,
    *,
    user_id: int,
    limit: int = 6,
) -> Dict[str, Any]:
    return await list_notifications(db, user_id=user_id, page=1, limit=limit)


async def mark_notification_read(
    db: AsyncSession,
    *,
    user_id: int,
    notification_id: int,
) -> Optional[Notification]:
    result = await db.execute(
        select(Notification).where(Notification.id == notification_id, Notification.user_id == user_id)
    )
    notification = result.scalar_one_or_none()
    if notification is None:
        return None
    if not notification.is_read:
        notification.is_read = True
        notification.read_at = datetime.utcnow()
        await db.flush()
    return notification


async def mark_notifications_read(
    db: AsyncSession,
    *,
    user_id: int,
    notification_ids: Sequence[int],
) -> int:
    if not notification_ids:
        return 0
    result = await db.execute(
        update(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.id.in_([int(item) for item in notification_ids]),
            Notification.is_read == False,
        )
        .values(is_read=True, read_at=datetime.utcnow())
    )
    await db.flush()
    return int(result.rowcount or 0)


async def mark_all_notifications_read(
    db: AsyncSession,
    *,
    user_id: int,
) -> int:
    result = await db.execute(
        update(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.is_archived == False,
            Notification.is_read == False,
        )
        .values(is_read=True, read_at=datetime.utcnow())
    )
    await db.flush()
    return int(result.rowcount or 0)


async def archive_notification(
    db: AsyncSession,
    *,
    user_id: int,
    notification_id: int,
) -> Optional[Notification]:
    result = await db.execute(
        select(Notification).where(Notification.id == notification_id, Notification.user_id == user_id)
    )
    notification = result.scalar_one_or_none()
    if notification is None:
        return None
    notification.is_archived = True
    if not notification.is_read:
        notification.is_read = True
        notification.read_at = datetime.utcnow()
    await db.flush()
    return notification


def _channel_enabled(settings_row: MonitoringNotificationSetting, channel: str) -> bool:
    channel_map = {
        "site": bool(settings_row.site_enabled),
        "email": bool(settings_row.email_enabled),
        "telegram": bool(settings_row.telegram_enabled),
        "browser_push": bool(settings_row.browser_push_enabled),
    }
    return channel_map.get(channel, False)


def _category_enabled(settings_row: MonitoringNotificationSetting, category: str) -> bool:
    enabled = set(_normalize_enabled_types(settings_row.enabled_event_types))
    return category in enabled or category == "system"


def _is_quiet_hours(settings_row: MonitoringNotificationSetting, current_time: Optional[time] = None) -> bool:
    start = settings_row.quiet_hours_start
    end = settings_row.quiet_hours_end
    if start is None or end is None:
        return False

    current_time = current_time or datetime.now().time().replace(second=0, microsecond=0)
    if start == end:
        return False
    if start < end:
        return start <= current_time < end
    return current_time >= start or current_time < end


def _browser_push_payload(notification: Notification) -> Dict[str, Any]:
    serialized = serialize_notification(notification)
    return {
        "title": serialized["title"],
        "body": serialized["message"],
        "icon": serialized["icon"],
        "color": serialized["color"],
        "url": serialized["action_url"] or "/notifications",
        "notification": serialized,
    }


async def _send_web_push(subscription: PushSubscription, payload: Dict[str, Any]) -> tuple[bool, bool]:
    if not push_supported():
        return False, False

    try:
        await asyncio.to_thread(
            webpush,
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {
                    "p256dh": subscription.p256dh_key,
                    "auth": subscription.auth_key,
                },
            },
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=settings.webpush_vapid_private_key,
            vapid_claims={"sub": settings.webpush_vapid_subject},
        )
        return True, False
    except WebPushException as exc:  # pragma: no cover - depends on browser push service
        status_code = getattr(getattr(exc, "response", None), "status_code", None)
        inactive = status_code in {404, 410}
        logger.warning("Browser push delivery failed for subscription %s: %s", subscription.id, exc)
        return False, inactive
    except Exception as exc:  # pragma: no cover - external network path
        logger.warning("Browser push delivery error for subscription %s: %s", subscription.id, exc)
        return False, False


async def deliver_browser_push(
    db: AsyncSession,
    *,
    user_id: int,
    notification: Notification,
    settings_row: MonitoringNotificationSetting,
) -> int:
    if not _channel_enabled(settings_row, "browser_push"):
        return 0
    if not _category_enabled(settings_row, notification.category):
        return 0
    if _is_quiet_hours(settings_row):
        return 0
    if not push_supported():
        return 0

    result = await db.execute(
        select(PushSubscription).where(
            PushSubscription.user_id == user_id,
            PushSubscription.is_active == True,
        )
    )
    subscriptions = list(result.scalars().all())
    if not subscriptions:
        return 0

    delivered = 0
    payload = _browser_push_payload(notification)
    for subscription in subscriptions:
        success, deactivate = await _send_web_push(subscription, payload)
        if success:
            subscription.last_used_at = datetime.utcnow()
            delivered += 1
        elif deactivate:
            subscription.is_active = False
    await db.flush()
    return delivered


async def dispatch_realtime_notification(
    db: AsyncSession,
    *,
    user_id: int,
    notification: Notification,
    settings_row: MonitoringNotificationSetting,
) -> None:
    if not _channel_enabled(settings_row, "site"):
        return
    if not _category_enabled(settings_row, notification.category):
        return

    unread_count = await get_unread_count(db, user_id)
    payload = {
        "type": "new_notification",
        "notification": serialize_notification(notification),
        "unread_count": unread_count,
    }
    sent = await websocket_manager.send_personal_message(user_id, payload)
    if not sent:
        await websocket_manager.store_pending_notification(user_id, payload)


async def create_notification(
    db: AsyncSession,
    *,
    user_id: int,
    title: str,
    message: str,
    event_type: str = "info",
    category: str = "system",
    priority: NotificationPriority = NotificationPriority.NORMAL,
    delivery_type: NotificationType = NotificationType.PUSH,
    action_url: Optional[str] = None,
    action_data: Optional[Dict[str, Any]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    expires_at: Optional[datetime] = None,
    user: Optional[User] = None,
    dispatch_realtime: bool = True,
    dispatch_browser_push: bool = True,
) -> Notification:
    settings_row = await ensure_notification_settings(db, user_id, user=user)
    notification = Notification(
        user_id=user_id,
        title=title,
        body=message,
        type=delivery_type,
        priority=priority,
        event_type=event_type,
        category=category,
        is_read=False,
        is_archived=False,
        is_sent=True,
        sent_at=datetime.utcnow(),
        action_url=action_url,
        action_data=action_data or {},
        meta=metadata or {},
        expires_at=expires_at,
        created_at=datetime.utcnow(),
    )
    db.add(notification)
    await db.flush()

    if dispatch_realtime:
        await dispatch_realtime_notification(db, user_id=user_id, notification=notification, settings_row=settings_row)
    if dispatch_browser_push:
        await deliver_browser_push(db, user_id=user_id, notification=notification, settings_row=settings_row)
    return notification


async def upsert_push_subscription(
    db: AsyncSession,
    *,
    user_id: int,
    endpoint: str,
    p256dh_key: str,
    auth_key: str,
    user_agent: Optional[str] = None,
) -> PushSubscription:
    result = await db.execute(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    subscription = result.scalar_one_or_none()
    if subscription is None:
        subscription = PushSubscription(
            user_id=user_id,
            endpoint=endpoint,
            p256dh_key=p256dh_key,
            auth_key=auth_key,
            user_agent=user_agent,
            created_at=datetime.utcnow(),
            last_used_at=datetime.utcnow(),
            is_active=True,
        )
        db.add(subscription)
    else:
        subscription.user_id = user_id
        subscription.p256dh_key = p256dh_key
        subscription.auth_key = auth_key
        subscription.user_agent = user_agent
        subscription.is_active = True
        subscription.last_used_at = datetime.utcnow()
    await db.flush()
    return subscription


async def unsubscribe_push_subscriptions(
    db: AsyncSession,
    *,
    user_id: int,
    endpoint: Optional[str] = None,
) -> int:
        filters = [PushSubscription.user_id == user_id, PushSubscription.is_active == True]
    if endpoint:
        filters.append(PushSubscription.endpoint == endpoint)

    result = await db.execute(
        update(PushSubscription)
        .where(*filters)
        .values(is_active=False, last_used_at=datetime.utcnow())
    )
    await db.flush()
    return int(result.rowcount or 0)


async def get_notification_settings_response(
    db: AsyncSession,
    *,
    user: User,
) -> Dict[str, Any]:
    settings_row = await ensure_notification_settings(db, user.id, user=user)
    enabled_types = _normalize_enabled_types(settings_row.enabled_event_types)
    _sync_legacy_user_settings(user, settings_row)
    return {
        "monitoring_enabled": bool(settings_row.monitoring_enabled),
        "site_enabled": bool(settings_row.site_enabled),
        "email_enabled": bool(settings_row.email_enabled),
        "telegram_enabled": bool(settings_row.telegram_enabled),
        "browser_push_enabled": bool(settings_row.browser_push_enabled),
        "telegram_chat_id": settings_row.telegram_chat_id,
        "enabled_event_types": enabled_types,
        "quiet_hours_start": settings_row.quiet_hours_start,
        "quiet_hours_end": settings_row.quiet_hours_end,
        "alert_cooldown_minutes": int(settings_row.alert_cooldown_minutes or settings.monitoring_alert_cooldown_minutes),
        "updated_at": settings_row.updated_at,
        "vapid_public_key": settings.webpush_vapid_public_key or None,
        "push_supported": push_supported(),
    }


async def update_notification_settings(
    db: AsyncSession,
    *,
    user: User,
    payload: Dict[str, Any],
) -> MonitoringNotificationSetting:
    settings_row = await ensure_notification_settings(db, user.id, user=user)
    settings_row.monitoring_enabled = bool(payload.get("monitoring_enabled", settings_row.monitoring_enabled))
    settings_row.site_enabled = bool(payload.get("site_enabled", settings_row.site_enabled))
    settings_row.email_enabled = bool(payload.get("email_enabled", settings_row.email_enabled))
    settings_row.telegram_enabled = bool(payload.get("telegram_enabled", settings_row.telegram_enabled))
    settings_row.browser_push_enabled = bool(
        payload.get("browser_push_enabled", settings_row.browser_push_enabled)
    )
    settings_row.telegram_chat_id = payload.get("telegram_chat_id")
    settings_row.enabled_event_types = _normalize_enabled_types(payload.get("enabled_event_types"))
    settings_row.quiet_hours_start = _normalize_time_value(payload.get("quiet_hours_start"))
    settings_row.quiet_hours_end = _normalize_time_value(payload.get("quiet_hours_end"))
    settings_row.alert_cooldown_minutes = int(
        payload.get("alert_cooldown_minutes", settings_row.alert_cooldown_minutes or settings.monitoring_alert_cooldown_minutes)
    )
    settings_row.updated_at = datetime.utcnow()
    _sync_legacy_user_settings(user, settings_row)
    await db.flush()
    return settings_row


async def cleanup_old_notifications(db: AsyncSession) -> int:
    cutoff = datetime.utcnow() - timedelta(days=settings.notifications_retention_days)
    from sqlalchemy import delete

    result = await db.execute(
        delete(Notification).where(
            or_(
                Notification.created_at < cutoff,
                and_(Notification.expires_at.is_not(None), Notification.expires_at < datetime.utcnow()),
            )
        )
    )
    await db.flush()
    return int(result.rowcount or 0)
