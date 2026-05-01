from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel

from app.schemas.ids import BigIntID


class AuditActorResponse(BaseModel):
    id: BigIntID
    full_name: str
    role: str


class AuditLogResponse(BaseModel):
    id: BigIntID
    user_id: Optional[BigIntID] = None
    entity_type: str
    entity_id: BigIntID
    action: str
    operation: str
    changes: Optional[dict[str, Any]] = None
    ip_address: str
    user_agent: Optional[str] = None
    reason: Optional[str] = None
    requires_retention: bool
    created_at: datetime
    actor: Optional[AuditActorResponse] = None


class AuditLogListResponse(BaseModel):
    items: list[AuditLogResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
