from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class AuditActorResponse(BaseModel):
    id: int
    full_name: str
    role: str


class AuditLogResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    entity_type: str
    entity_id: int
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
