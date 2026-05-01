from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.core.constants import UserRole
from app.schemas.ids import BigIntID


class UserResponse(BaseModel):
    id: BigIntID
    billing_id: Optional[str] = None
    phone: str
    email: Optional[str] = None
    avatar_url: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    middle_name: Optional[str] = None
    role: UserRole
    is_active: bool
    is_verified: bool = False
    is_2fa_enabled: bool = False
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None
    language: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class UserUpdateRequest(BaseModel):
    email: Optional[str] = None
    first_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    middle_name: Optional[str] = Field(None, max_length=100)
    language: Optional[str] = Field(None, max_length=8)
    notification_settings: Optional[Dict[str, Any]] = None


class UserProfileResponse(UserResponse):
    balance: Optional[float] = None
    current_tariff: Optional[Dict[str, Any]] = None
    active_sessions_count: int = 0
    recent_activity: List[Dict[str, Any]] = Field(default_factory=list)
