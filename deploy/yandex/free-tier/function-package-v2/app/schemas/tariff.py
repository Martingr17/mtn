from typing import Any, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class TariffResponse(BaseModel):
    id: int
    billing_tariff_id: str
    name: str
    name_en: Optional[str] = None
    speed_mbps: int
    upload_speed_mbps: Optional[int] = None
    price: float
    setup_fee: float = 0
    description: Optional[str] = None
    description_en: Optional[str] = None
    features: List[Any] = Field(default_factory=list)
    is_active: bool = True
    is_popular: bool = False
    sort_order: int = 0
    is_unlimited: bool = True
    traffic_limit_gb: Optional[int] = None
    contract_term_months: int = 12

    model_config = ConfigDict(from_attributes=True)


class TariffChangeRequest(BaseModel):
    tariff_id: int = Field(..., gt=0)
    effective_from: Optional[str] = Field("next_month", pattern="^(today|next_month)$")


class TariffCompareResponse(TariffResponse):
    pass


class TariffAdminUpsertRequest(BaseModel):
    billing_tariff_id: str = Field(..., min_length=2, max_length=64)
    name: str = Field(..., min_length=2, max_length=128)
    speed_mbps: int = Field(..., ge=1, le=10000)
    upload_speed_mbps: Optional[int] = Field(None, ge=1, le=10000)
    price: float = Field(..., ge=0)
    setup_fee: float = Field(0, ge=0)
    description: Optional[str] = None
    features: List[Any] = Field(default_factory=list)
    is_active: bool = True
    is_popular: bool = False
    sort_order: int = Field(0, ge=0, le=1000)
    is_unlimited: bool = True
    traffic_limit_gb: Optional[int] = Field(None, ge=1, le=100000)
    contract_term_months: int = Field(12, ge=1, le=60)


class TariffAdminUpdateRequest(BaseModel):
    billing_tariff_id: Optional[str] = Field(None, min_length=2, max_length=64)
    name: Optional[str] = Field(None, min_length=2, max_length=128)
    speed_mbps: Optional[int] = Field(None, ge=1, le=10000)
    upload_speed_mbps: Optional[int] = Field(None, ge=1, le=10000)
    price: Optional[float] = Field(None, ge=0)
    setup_fee: Optional[float] = Field(None, ge=0)
    description: Optional[str] = None
    features: Optional[List[Any]] = None
    is_active: Optional[bool] = None
    is_popular: Optional[bool] = None
    sort_order: Optional[int] = Field(None, ge=0, le=1000)
    is_unlimited: Optional[bool] = None
    traffic_limit_gb: Optional[int] = Field(None, ge=1, le=100000)
    contract_term_months: Optional[int] = Field(None, ge=1, le=60)
