from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import PaymentStatus


class PaymentCreateRequest(BaseModel):
    amount: Decimal = Field(..., gt=0)
    payment_method: str = Field(..., min_length=2, max_length=64)


class PaymentResponse(BaseModel):
    id: int
    user_id: int
    amount: Decimal
    fee_amount: Decimal | int | float = 0
    net_amount: Optional[Decimal] = None
    payment_method: Optional[str] = None
    payment_type: str
    status: PaymentStatus
    external_id: Optional[str] = None
    payment_url: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    provider: Optional[str] = None
    can_retry: bool = False
    billing_applied: bool = False

    model_config = ConfigDict(from_attributes=True)


class PaymentMethodCreateRequest(BaseModel):
    method_type: str
    token: str
    masked_pan: Optional[str] = None
    card_type: Optional[str] = None
    expiry_month: Optional[str] = None
    expiry_year: Optional[str] = None
    is_default: bool = False


class PaymentMethodResponse(BaseModel):
    id: int
    user_id: int
    method_type: str
    masked_pan: Optional[str] = None
    card_type: Optional[str] = None
    expiry_month: Optional[str] = None
    expiry_year: Optional[str] = None
    is_default: bool
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RefundRequest(BaseModel):
    payment_id: int = Field(..., gt=0)
    amount: Decimal = Field(..., gt=0)
    reason: str = Field(..., min_length=3, max_length=255)
