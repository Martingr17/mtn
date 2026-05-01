from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.schemas.ids import BigIntID


class TelegramAlertLogResponse(BaseModel):
    id: BigIntID
    entity_type: str
    entity_id: BigIntID
    severity: str
    title: str
    message: str
    chat_id: str
    status: str
    error: Optional[str] = None
    sent_at: Optional[datetime] = None
    created_at: datetime


class TelegramAlertLogListResponse(BaseModel):
    items: list[TelegramAlertLogResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class TelegramAlertActionResponse(BaseModel):
    alert: TelegramAlertLogResponse
    result: str
    audit_entity_type: str = "telegram_alert"
