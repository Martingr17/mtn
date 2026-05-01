from __future__ import annotations

from datetime import datetime, time
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import NotificationPriority, NotificationType
from app.schemas.ids import BigIntID


class NotificationResponse(BaseModel):
    id: BigIntID
    title: str
    message: str
    body: str
    type: NotificationType
    priority: NotificationPriority
    event_type: str
    category: str
    is_read: bool
    is_archived: bool
    is_sent: bool
    action_url: Optional[str] = None
    action_data: Optional[dict[str, Any]] = None
    metadata: Optional[dict[str, Any]] = None
    created_at: datetime
    sent_at: Optional[datetime] = None
    read_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    priority_label: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    total: int
    page: int
    limit: int
    unread_count: int


class NotificationMarkReadRequest(BaseModel):
    notification_ids: list[int] = Field(default_factory=list)


class NotificationArchiveRequest(BaseModel):
    notification_ids: list[int] = Field(default_factory=list)


class NotificationCreateRequest(BaseModel):
    user_id: Optional[int] = None
    user_ids: list[int] = Field(default_factory=list)
    all_users: bool = False
    title: str = Field(..., max_length=255)
    message: str = Field(..., max_length=5000)
    event_type: str = Field(default="info", max_length=50)
    category: str = Field(default="system", max_length=50)
    priority: NotificationPriority = NotificationPriority.NORMAL
    delivery_type: NotificationType = NotificationType.PUSH
    action_url: Optional[str] = Field(default=None, max_length=500)
    data: Optional[dict[str, Any]] = None
    expires_at: Optional[datetime] = None


class NotificationEventTypeResponse(BaseModel):
    key: str
    label: str
    description: str
    icon: str
    color: str
    default_enabled: bool = True


class NotificationSettingsUpdateRequest(BaseModel):
    monitoring_enabled: bool = True
    site_enabled: bool = True
    email_enabled: bool = False
    telegram_enabled: bool = False
    browser_push_enabled: bool = False
    telegram_chat_id: Optional[str] = Field(default=None, max_length=100)
    enabled_event_types: list[str] = Field(default_factory=list)
    quiet_hours_start: Optional[time] = None
    quiet_hours_end: Optional[time] = None
    alert_cooldown_minutes: int = Field(default=30, ge=5, le=1440)


class NotificationSettingsResponse(NotificationSettingsUpdateRequest):
    updated_at: datetime
    vapid_public_key: Optional[str] = None
    push_supported: bool = False

    model_config = ConfigDict(from_attributes=True)


class PushSubscriptionKeys(BaseModel):
    p256dh: str = Field(..., max_length=200)
    auth: str = Field(..., max_length=100)


class PushSubscriptionCreateRequest(BaseModel):
    endpoint: str = Field(..., max_length=500)
    keys: PushSubscriptionKeys
    expirationTime: Optional[int] = None


class PushSubscriptionResponse(BaseModel):
    id: BigIntID
    endpoint: str
    is_active: bool
    created_at: datetime
    last_used_at: datetime

    model_config = ConfigDict(from_attributes=True)
