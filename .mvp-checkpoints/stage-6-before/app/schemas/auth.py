from pydantic import AliasChoices, BaseModel, Field, field_validator, ConfigDict
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

class LoginRequest(BaseModel):
    email: str
    password: Optional[str] = None
    email_code: Optional[str] = Field(
        None,
        min_length=4,
        max_length=8,
        validation_alias=AliasChoices("email_code", "sms_code"),
    )
    totp_code: Optional[str] = Field(None, min_length=6, max_length=6)

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("password", "email_code", "totp_code", mode="before")
    @classmethod
    def normalize_optional_auth_fields(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        normalized = Validators.normalize_email(v)
        valid, error = Validators.validate_email(normalized)
        if not valid:
            raise ValueError(error)
        return normalized

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
    verification_channel: Optional[str] = None
    verification_target: Optional[str] = None
    verification_expires_in: Optional[int] = None
    resend_available_in: Optional[int] = None
    demo_email_code: Optional[str] = None
    demo_email_address: Optional[str] = None
    demo_email_ttl: Optional[int] = None
    demo_sms_code: Optional[str] = None
    demo_sms_phone: Optional[str] = None
    demo_sms_ttl: Optional[int] = None

class RefreshRequest(BaseModel):
    refresh_token: Optional[str] = None

class RegisterRequest(BaseModel):
    billing_id: str = Field(..., min_length=4, max_length=32)
    phone: str
    email: str
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
    def validate_email(cls, v: str) -> str:
        normalized = Validators.normalize_email(v)
        valid, error = Validators.validate_email(normalized)
        if not valid:
            raise ValueError(error)
        return normalized

class RegisterConfirmRequest(PhoneNumber):
    email: Optional[str] = None
    email_code: str = Field(
        ...,
        min_length=4,
        max_length=8,
        validation_alias=AliasChoices("email_code", "sms_code"),
    )
    password: Optional[str] = Field(None, min_length=8, max_length=100)

    model_config = ConfigDict(populate_by_name=True)

    @field_validator("email", "password", mode="before")
    @classmethod
    def normalize_confirm_fields(cls, v):
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("email_code", mode="before")
    @classmethod
    def normalize_email_code(cls, v):
        if isinstance(v, str):
            return v.strip()
        return v

    @field_validator("email")
    @classmethod
    def validate_confirm_email(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        normalized = Validators.normalize_email(v)
        valid, error = Validators.validate_email(normalized)
        if not valid:
            raise ValueError(error)
        return normalized

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
