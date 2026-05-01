from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class GponSubscriberBrief(BaseModel):
    id: int
    billing_id: str
    full_name: str
    phone: str
    email: Optional[str] = None


class GponOltResponse(BaseModel):
    id: int
    name: str
    vendor: str
    model: str
    management_ip: str
    location: Optional[str] = None
    status: str
    pon_ports_total: int
    pon_ports_used: int
    uplink_status: str
    created_at: datetime
    updated_at: datetime


class GponOntResponse(BaseModel):
    id: int
    subscriber_id: int
    olt_id: int
    serial_number: str
    mac_address: Optional[str] = None
    pon_port: int
    ont_id_on_port: int
    vlan_id: int
    status: str
    rx_power: Optional[float] = None
    tx_power: Optional[float] = None
    last_seen_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    subscriber: Optional[GponSubscriberBrief] = None
    olt: Optional[GponOltResponse] = None


class GponOltListResponse(BaseModel):
    items: list[GponOltResponse]
    total: int


class GponOntListResponse(BaseModel):
    items: list[GponOntResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class GponOntActionResponse(BaseModel):
    ont: GponOntResponse
    action: str
    result: str
    audit_entity_type: str = "ont"
