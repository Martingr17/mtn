from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.constants import TicketPriority, TicketStatus


class TicketCreate(BaseModel):
    subject: str = Field(..., min_length=3, max_length=255)
    body: str = Field(..., min_length=1, max_length=10000)
    category: Optional[str] = Field(None, max_length=50)
    priority: TicketPriority = TicketPriority.MEDIUM

    @field_validator("subject")
    @classmethod
    def validate_subject(cls, value: str) -> str:
        import html

        return html.escape(value.strip())

    @field_validator("body")
    @classmethod
    def validate_body(cls, value: str) -> str:
        import html

        return html.escape(value.strip())


class MessageCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=10000)
    is_internal: bool = False


class MessageResponse(BaseModel):
    id: int
    user_id: int
    body: str
    is_internal: bool
    attachment_path: Optional[str] = None
    attachment_name: Optional[str] = None
    attachment_size: Optional[int] = None
    attachment_mime: Optional[str] = None
    created_at: datetime
    user_display_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class TicketResponse(BaseModel):
    id: int
    subject: str
    status: TicketStatus
    priority: TicketPriority
    category: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    last_activity_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    sla_deadline: Optional[datetime] = None
    escalated_at: Optional[datetime] = None
    user_id: int
    assigned_to: Optional[int] = None
    assignee_name: Optional[str] = None
    user_display_name: Optional[str] = None
    is_overdue: bool = False

    model_config = ConfigDict(from_attributes=True)


class TicketDetailResponse(TicketResponse):
    messages: List[MessageResponse]
    resolution_summary: Optional[str] = None
    satisfaction_rating: Optional[int] = None
    first_response_at: Optional[datetime] = None
    response_time_seconds: Optional[int] = None
    resolution_time_seconds: Optional[int] = None


class TicketListResponse(BaseModel):
    total: int
    items: List[TicketResponse]
    page: int
    page_size: int
    total_pages: int


class TicketAssignRequest(BaseModel):
    assignee_id: int


class TicketResolveRequest(BaseModel):
    resolution_summary: str = Field(..., min_length=10, max_length=1000)


class TicketRateRequest(BaseModel):
    rating: int = Field(..., ge=1, le=5)


TicketDetailResponse.model_rebuild()
