from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.schemas.ids import BigIntID


class ZabbixAlarmResponse(BaseModel):
    id: BigIntID
    alarm_type: str
    severity: str
    status: str
    source_type: str
    source_name: str
    source_id: Optional[BigIntID] = None
    title: str
    description: Optional[str] = None
    metric_name: Optional[str] = None
    metric_value: Optional[float] = None
    threshold: Optional[float] = None
    first_seen_at: datetime
    last_seen_at: datetime
    acknowledged_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    acknowledged_by: Optional[BigIntID] = None
    resolved_by: Optional[BigIntID] = None


class ZabbixAlarmListResponse(BaseModel):
    items: list[ZabbixAlarmResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class ZabbixSummaryResponse(BaseModel):
    active: int
    critical: int
    high: int
    warning: int
    resolved: int
    acknowledged: int
    total: int
    by_type: dict[str, int]
    by_source_type: dict[str, int]


class ZabbixAlarmActionResponse(BaseModel):
    alarm: ZabbixAlarmResponse
    action: str
    result: str
    audit_entity_type: str = "zabbix_alarm"


class ZabbixRefreshResponse(BaseModel):
    refreshed: int
    created: int
    result: str
