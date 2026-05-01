from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.constants import TicketPriority, TicketStatus, UserRole


def _strip_optional(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


class UserAdminResponse(BaseModel):
    id: int
    phone: str
    email: Optional[str]
    billing_id: str
    role: UserRole
    is_active: bool
    is_blocked: bool
    created_at: datetime
    last_login_at: Optional[datetime]

    model_config = ConfigDict(from_attributes=True)


class UserAdminDetailResponse(UserAdminResponse):
    first_name: Optional[str]
    last_name: Optional[str]
    is_verified: bool
    is_2fa_enabled: bool
    balance: Optional[float]
    current_tariff: Optional[Dict]
    total_payments: float
    total_tickets: int


class AdminStaffResponse(BaseModel):
    id: int
    phone: str
    email: Optional[str]
    billing_id: str
    role: UserRole
    role_label: str
    full_name: str
    display_name: str
    is_active: bool
    is_blocked: bool
    is_2fa_enabled: bool
    created_at: datetime
    last_login_at: Optional[datetime]


class AdminActivityItem(BaseModel):
    id: int
    action: str
    status: Optional[str] = None
    created_at: datetime
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    ip_address: Optional[str] = None


class AdminMetricBreakdownItem(BaseModel):
    key: str
    label: str
    value: int


class AdminMetricSeriesPoint(BaseModel):
    date: str
    amount: float = 0
    count: int = 0


class AdminStaffCreateRequest(BaseModel):
    phone: str = Field(..., min_length=5, max_length=20)
    password: str = Field(..., min_length=8, max_length=128)
    role: UserRole = UserRole.OPERATOR
    billing_id: Optional[str] = Field(default=None, max_length=64)
    email: Optional[str] = Field(default=None, max_length=255)
    first_name: Optional[str] = Field(default=None, max_length=100)
    last_name: Optional[str] = Field(default=None, max_length=100)
    middle_name: Optional[str] = Field(default=None, max_length=100)
    is_active: bool = True
    notification_settings: Dict = Field(default_factory=dict)

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value: str) -> str:
        return value.strip()

    @field_validator("billing_id", "email", "first_name", "last_name", "middle_name")
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        return _strip_optional(value)


class AdminStaffUpdateRequest(BaseModel):
    phone: Optional[str] = Field(default=None, min_length=5, max_length=20)
    password: Optional[str] = Field(default=None, min_length=8, max_length=128)
    role: Optional[UserRole] = None
    billing_id: Optional[str] = Field(default=None, max_length=64)
    email: Optional[str] = Field(default=None, max_length=255)
    first_name: Optional[str] = Field(default=None, max_length=100)
    last_name: Optional[str] = Field(default=None, max_length=100)
    middle_name: Optional[str] = Field(default=None, max_length=100)
    is_active: Optional[bool] = None
    is_blocked: Optional[bool] = None
    block_reason: Optional[str] = Field(default=None, max_length=500)
    reset_2fa: bool = False
    notification_settings: Optional[Dict] = None

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value: Optional[str]) -> Optional[str]:
        return _strip_optional(value)

    @field_validator("billing_id", "email", "first_name", "last_name", "middle_name", "block_reason")
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        return _strip_optional(value)


class AdminUserBulkStatusRequest(BaseModel):
    user_ids: List[int] = Field(..., min_length=1, max_length=200)
    action: Literal["block", "unblock"]
    reason: Optional[str] = Field(default=None, max_length=500)

    @field_validator("user_ids")
    @classmethod
    def validate_user_ids(cls, value: List[int]) -> List[int]:
        cleaned = [int(item) for item in value if int(item) > 0]
        if not cleaned:
            raise ValueError("Список абонентов не должен быть пустым")
        return list(dict.fromkeys(cleaned))

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: Optional[str]) -> Optional[str]:
        return _strip_optional(value)


class AdminUserCreateRequest(BaseModel):
    phone: str = Field(..., min_length=5, max_length=20)
    billing_id: Optional[str] = Field(default=None, max_length=64)
    email: Optional[str] = Field(default=None, max_length=255)
    first_name: Optional[str] = Field(default=None, max_length=100)
    last_name: Optional[str] = Field(default=None, max_length=100)
    middle_name: Optional[str] = Field(default=None, max_length=100)
    tariff_id: Optional[int] = Field(default=None, ge=1)

    @field_validator("phone")
    @classmethod
    def normalize_phone(cls, value: str) -> str:
        return value.strip()

    @field_validator("billing_id", "email", "first_name", "last_name", "middle_name")
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        return _strip_optional(value)


class AdminUserUpdateRequest(BaseModel):
    email: Optional[str] = Field(default=None, max_length=255)
    first_name: Optional[str] = Field(default=None, max_length=100)
    last_name: Optional[str] = Field(default=None, max_length=100)
    middle_name: Optional[str] = Field(default=None, max_length=100)

    @field_validator("email", "first_name", "last_name", "middle_name")
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        return _strip_optional(value)


class AdminManualPaymentRequest(BaseModel):
    amount: float = Field(..., gt=0, le=100000)
    comment: Optional[str] = Field(default=None, max_length=255)

    @field_validator("comment")
    @classmethod
    def normalize_comment(cls, value: Optional[str]) -> Optional[str]:
        return _strip_optional(value)


class TicketAdminResponse(BaseModel):
    id: int
    user_id: int
    user_phone: str
    subject: str
    status: TicketStatus
    priority: TicketPriority
    created_at: datetime
    assigned_to: Optional[int]
    assigned_to_name: Optional[str]

    model_config = ConfigDict(from_attributes=True)


class AdminStatsResponse(BaseModel):
    total_users: int
    new_users_today: int
    blocked_users: int
    total_tickets: int
    open_tickets: int
    overdue_tickets: int = 0
    resolved_tickets_today: int = 0
    revenue_month: float
    revenue_today: float = 0
    active_users_last_24h: int
    active_users_today: int = 0
    total_staff: int = 0
    active_staff: int = 0
    tickets_by_status: List[AdminMetricBreakdownItem] = Field(default_factory=list)
    tickets_by_priority: List[AdminMetricBreakdownItem] = Field(default_factory=list)
    payments_last_7_days: List[AdminMetricSeriesPoint] = Field(default_factory=list)
    recent_activity: List[AdminActivityItem] = Field(default_factory=list)
    monitoring_monitored_users: int = 0
    monitoring_disabled_users: int = 0
    monitoring_users_with_active_alerts: int = 0
    monitoring_critical_alerts_24h: int = 0
    monitoring_average_quality_score: float = 0
    monitoring_quality_breakdown: List[AdminMetricBreakdownItem] = Field(default_factory=list)
    monitoring_alert_types: List[AdminMetricBreakdownItem] = Field(default_factory=list)
    monitoring_latest_alerts: List[Dict] = Field(default_factory=list)
    monitoring_worst_users: List[Dict] = Field(default_factory=list)
    system_health: Dict


class AdminStaffDetailResponse(AdminStaffResponse):
    block_reason: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    middle_name: Optional[str] = None
    notification_settings: Dict = Field(default_factory=dict)
    last_login_ip: Optional[str] = None
    active_sessions: int = 0
    assigned_open_tickets: int = 0
    assigned_total_tickets: int = 0
    resolved_tickets_7d: int = 0
    recent_activity: List[AdminActivityItem] = Field(default_factory=list)
    recent_assignments: List[Dict] = Field(default_factory=list)


class SystemSettingsUpdate(BaseModel):
    maintenance_mode: bool = False
    registration_enabled: bool = True
    payment_enabled: bool = True
    ticket_system_enabled: bool = True
    min_payment_amount: int = 100
    max_payment_amount: int = 100000
    ticket_auto_close_days: int = 7
    maintenance_message: str = "Сервис временно обновляется. Мы уже чиним. Загляните через 10 минут."


class SystemSettingsResponse(SystemSettingsUpdate):
    model_config = ConfigDict(from_attributes=True)
