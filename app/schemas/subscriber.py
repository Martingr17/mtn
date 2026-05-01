from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, Field

from app.schemas.ids import BigIntID


class SubscriberTariffResponse(BaseModel):
    tariff_id: Optional[str] = None
    name: Optional[str] = None
    speed_mbps: Optional[int] = None
    upload_speed_mbps: Optional[int] = None
    price: Optional[float] = None
    is_unlimited: Optional[bool] = None
    traffic_limit_gb: Optional[int] = None


class SubscriberBalanceResponse(BaseModel):
    subscriber_id: BigIntID
    billing_id: str
    balance: float
    currency: str = "RUB"
    has_debt: bool
    updated_at: datetime


class SubscriberPaymentResponse(BaseModel):
    id: BigIntID
    amount: float
    fee_amount: float = 0
    net_amount: Optional[float] = None
    payment_method: Optional[str] = None
    payment_type: str
    status: str
    external_id: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None


class SubscriberTicketResponse(BaseModel):
    id: BigIntID
    subject: str
    category: Optional[str] = None
    status: str
    priority: str
    assigned_to: Optional[BigIntID] = None
    assignee_name: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    last_activity_at: Optional[datetime] = None
    is_overdue: bool = False


class SubscriberSummaryResponse(BaseModel):
    id: BigIntID
    billing_id: str
    full_name: str
    connection_address: Optional[str] = None
    phone: str
    email: Optional[str] = None
    current_tariff: Optional[SubscriberTariffResponse] = None
    balance: Optional[float] = None
    service_status: str
    service_status_label: str
    is_active: bool
    is_blocked: bool
    open_tickets: int = 0
    total_tickets: int = 0
    last_payment_at: Optional[datetime] = None
    ont: dict[str, Any] = Field(default_factory=dict)


class SubscriberDetailResponse(SubscriberSummaryResponse):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    middle_name: Optional[str] = None
    account_info: dict[str, Any] = Field(default_factory=dict)
    recent_payments: List[SubscriberPaymentResponse] = Field(default_factory=list)
    recent_tickets: List[SubscriberTicketResponse] = Field(default_factory=list)


class SubscriberListResponse(BaseModel):
    items: List[SubscriberSummaryResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class SubscriberPaymentsResponse(BaseModel):
    items: List[SubscriberPaymentResponse]
    total: int
    limit: int
    offset: int


class SubscriberTicketsResponse(BaseModel):
    items: List[SubscriberTicketResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
