from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.ids import BigIntID


class RadiusSubscriberBrief(BaseModel):
    id: BigIntID
    billing_id: str
    full_name: str
    phone: str
    email: Optional[str] = None


class RadiusSessionResponse(BaseModel):
    id: BigIntID
    subscriber_id: BigIntID
    username: str
    framed_ip_address: Optional[str] = None
    mac_address: Optional[str] = None
    nas_ip_address: Optional[str] = None
    nas_port: Optional[str] = None
    session_id: str
    status: str
    tariff_profile: Optional[str] = None
    speed_down: int
    speed_up: int
    started_at: datetime
    updated_at: datetime
    subscriber: Optional[RadiusSubscriberBrief] = None


class RadiusActionLogResponse(BaseModel):
    id: BigIntID
    subscriber_id: BigIntID
    action: str
    old_status: Optional[str] = None
    new_status: Optional[str] = None
    old_speed_down: Optional[int] = None
    new_speed_down: Optional[int] = None
    old_speed_up: Optional[int] = None
    new_speed_up: Optional[int] = None
    performed_by: Optional[BigIntID] = None
    performed_by_name: Optional[str] = None
    result: str
    created_at: datetime
    subscriber: Optional[RadiusSubscriberBrief] = None


class RadiusSessionListResponse(BaseModel):
    items: list[RadiusSessionResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class RadiusActionListResponse(BaseModel):
    items: list[RadiusActionLogResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class RadiusChangeSpeedRequest(BaseModel):
    speed_down: int = Field(..., ge=1, le=10000)
    speed_up: int = Field(..., ge=1, le=10000)


class RadiusActionResultResponse(BaseModel):
    session: RadiusSessionResponse
    action: RadiusActionLogResponse
