from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.zabbix import ZabbixAlarmResponse


class IncidentUserBrief(BaseModel):
    id: int
    full_name: str
    role: str


class IncidentCreateRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=255)
    description: Optional[str] = Field(None, max_length=4000)
    severity: str = Field("medium", max_length=24)
    affected_service: str = Field("other", max_length=32)
    affected_subscribers_count: int = Field(0, ge=0)
    assigned_to: Optional[int] = Field(None, ge=1)


class IncidentAssignRequest(BaseModel):
    user_id: int = Field(..., ge=1)


class IncidentResponse(BaseModel):
    id: int
    title: str
    description: Optional[str] = None
    severity: str
    status: str
    source: str
    affected_service: str
    affected_subscribers_count: int
    assigned_to: Optional[int] = None
    created_by: Optional[int] = None
    acknowledged_by: Optional[int] = None
    resolved_by: Optional[int] = None
    closed_by: Optional[int] = None
    created_at: datetime
    acknowledged_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    updated_at: datetime
    assigned_user: Optional[IncidentUserBrief] = None
    created_by_user: Optional[IncidentUserBrief] = None
    alarms: list[ZabbixAlarmResponse] = []


class IncidentListResponse(BaseModel):
    items: list[IncidentResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class IncidentSummaryResponse(BaseModel):
    new: int
    in_progress: int
    critical: int
    resolved: int
    total: int


class IncidentActionResponse(BaseModel):
    incident: IncidentResponse
    action: str
    result: str
    audit_entity_type: str = "noc_incident"
