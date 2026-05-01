from pydantic import BaseModel, Field, field_validator, ConfigDict
from typing import Optional
from datetime import datetime
from app.core.validators import Validators

class PhoneNumber(BaseModel):
    phone: str = Field(..., min_length=10, max_length=15)
    
    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        valid, error = Validators.validate_phone(v)
        if not valid:
            raise ValueError(error)
        return v

class LoginRequest(PhoneNumber):
    password: Optional[str] = None
    sms_code: Optional[str] = Field(None, min_length=6, max_length=6)
    totp_code: Optional[str] = Field(None, min_length=6, max_length=6)

    @field_validator("password", "sms_code", "totp_code", mode="before")
    @classmethod
    def normalize_optional_auth_fields(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v

class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user_id: int
    role: str
    requires_2fa: bool = False
    two_factor_token: Optional[str] = None
    message: Optional[str] = None
    demo_sms_code: Optional[str] = None
    demo_sms_phone: Optional[str] = None
    demo_sms_ttl: Optional[int] = None

class RefreshRequest(BaseModel):
    refresh_token: str

class RegisterRequest(BaseModel):
    billing_id: str = Field(..., min_length=4, max_length=32)
    phone: str
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    
    @field_validator("billing_id")
    @classmethod
    def validate_billing_id(cls, v: str) -> str:
        valid, error = Validators.validate_billing_id(v)
        if not valid:
            raise ValueError(error)
        return v.upper()
    
    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        valid, error = Validators.validate_phone(v)
        if not valid:
            raise ValueError(error)
        return v
    
    @field_validator("email")
    @classmethod
    def validate_email(cls, v: Optional[str]) -> Optional[str]:
        if v:
            valid, error = Validators.validate_email(v)
            if not valid:
                raise ValueError(error)
        return v

class RegisterConfirmRequest(PhoneNumber):
    sms_code: str = Field(..., min_length=6, max_length=6)
    password: Optional[str] = Field(None, min_length=8, max_length=100)

    @field_validator("password", mode="before")
    @classmethod
    def normalize_confirm_password(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v
    
    @field_validator("password")
    @classmethod
    def validate_password(cls, v: Optional[str]) -> Optional[str]:
        if v:
            valid, error = Validators.validate_password(v)
            if not valid:
                raise ValueError(error)
        return v

class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=8, max_length=100)
    
    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        valid, error = Validators.validate_password(v)
        if not valid:
            raise ValueError(error)
        return v

class ResetPasswordRequest(PhoneNumber):
    sms_code: Optional[str] = Field(None, min_length=6, max_length=6)
    new_password: Optional[str] = Field(None, min_length=8, max_length=100)

    @field_validator("sms_code", "new_password", mode="before")
    @classmethod
    def normalize_reset_fields(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("new_password")
    @classmethod
    def validate_reset_password(cls, v: Optional[str]) -> Optional[str]:
        if v:
            valid, error = Validators.validate_password(v)
            if not valid:
                raise ValueError(error)
        return v

class TwoFactorSetupResponse(BaseModel):
    secret: str
    otpauth_url: str
    qr_code: str

class TwoFactorVerifyRequest(BaseModel):
    code: str = Field(..., min_length=6, max_length=6)

class TwoFactorEnableRequest(TwoFactorVerifyRequest):
    pass


class TwoFactorLoginRequest(BaseModel):
    two_factor_token: str = Field(..., min_length=8, max_length=128)
    code: str = Field(..., min_length=6, max_length=6)

class TokenPayload(BaseModel):
    sub: str
    exp: datetime
    iat: datetime
    jti: str
    role: str
    type: str = "access"
    
    model_config = ConfigDict(from_attributes=True)
