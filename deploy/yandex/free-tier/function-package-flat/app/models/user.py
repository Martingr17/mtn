from sqlalchemy import Column, BigInteger, String, Boolean, Text, Enum, ForeignKey, Index
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from app.database import Base
from app.core.constants import UserRole
from app.db_compat import AwareTimestamp, IpAddressType, JsonType
import bcrypt

class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("idx_users_phone", "phone"),
        Index("idx_users_billing_id", "billing_id"),
        Index("idx_users_email", "email"),
        Index("idx_users_role_active", "role", "is_active"),
        {"comment": "User accounts table"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True, comment="Primary key")
    billing_id = Column(String(64), unique=True, nullable=False, index=True, comment="Billing system identifier")
    phone = Column(String(20), unique=True, nullable=False, index=True, comment="Phone number in E.164 format")
    email = Column(String(255), nullable=True, index=True, comment="Email address")
    password_hash = Column(String(255), nullable=True, comment="Bcrypt password hash (for staff)")
    avatar_url = Column(String(512), nullable=True, comment="Profile avatar URL")

    # User metadata
    first_name = Column(String(100), nullable=True, comment="First name")
    last_name = Column(String(100), nullable=True, comment="Last name")
    middle_name = Column(String(100), nullable=True, comment="Middle name")
    passport_number = Column(String(20), nullable=True, comment="Passport number (encrypted)")

    # Account status
    role = Column(Enum(UserRole), default=UserRole.USER, nullable=False, comment="User role")
    is_active = Column(Boolean, default=True, nullable=False, comment="Account active flag")
    is_verified = Column(Boolean, default=False, nullable=False, comment="Email/phone verified")
    is_blocked = Column(Boolean, default=False, nullable=False, comment="Admin block flag")
    block_reason = Column(Text, nullable=True, comment="Block reason")

    # 2FA
    totp_secret = Column(String(32), nullable=True, comment="TOTP secret for 2FA")
    is_2fa_enabled = Column(Boolean, default=False, comment="2FA enabled flag")

    # Timestamps
    created_at = Column(AwareTimestamp, default=datetime.utcnow, nullable=False, comment="Creation timestamp")
    updated_at = Column(AwareTimestamp, onupdate=datetime.utcnow, comment="Last update timestamp")
    last_login_at = Column(AwareTimestamp, nullable=True, comment="Last login timestamp")
    last_login_ip = Column(IpAddressType, nullable=True, comment="Last login IP address")

    # Preferences
    language = Column(String(2), default="ru", comment="User language preference")
    notification_settings = Column(JsonType, default={}, comment="JSON notification preferences")

    # Relationships
    tickets = relationship(
        "Ticket",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
        foreign_keys="Ticket.user_id",
    )
    messages = relationship("Message", back_populates="user", lazy="selectin")
    payments = relationship("PaymentLog", back_populates="user", lazy="selectin")
    activity_logs = relationship("ActivityLog", back_populates="user", lazy="selectin")
    notifications = relationship("Notification", back_populates="user", lazy="selectin")
    push_subscriptions = relationship(
        "PushSubscription",
        back_populates="user",
        lazy="selectin",
        cascade="all, delete-orphan",
    )
    sessions = relationship("UserSession", back_populates="user", cascade="all, delete-orphan", lazy="selectin")
    speedtest_results = relationship(
        "SpeedtestResult",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    monitoring_metrics = relationship(
        "MonitoringMetric",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    monitoring_alerts = relationship(
        "MonitoringAlert",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    monitoring_notification_setting = relationship(
        "MonitoringNotificationSetting",
        back_populates="user",
        lazy="selectin",
        uselist=False,
        cascade="all, delete-orphan",
    )

    def __repr__(self):
        return f"<User(id={self.id}, phone={self.phone}, role={self.role})>"

    def set_password(self, password: str):
        """Hash and set password"""
        salt = bcrypt.gensalt(rounds=12)
        self.password_hash = bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

    def check_password(self, password: str) -> bool:
        """Verify password"""
        if not self.password_hash:
            return False
        return bcrypt.checkpw(password.encode("utf-8"), self.password_hash.encode("utf-8"))

    @property
    def full_name(self) -> str:
        """Return full name"""
        parts = [self.last_name, self.first_name, self.middle_name]
        return " ".join(p for p in parts if p) or self.phone

    @property
    def display_name(self) -> str:
        """Return display name"""
        if self.first_name and self.last_name:
            return f"{self.first_name} {self.last_name[0]}."
        return self.phone

class UserSession(Base):
    __tablename__ = "user_sessions"
    __table_args__ = (
        Index("idx_sessions_user_id", "user_id"),
        Index("idx_sessions_token", "token"),
        Index("idx_sessions_expires_at", "expires_at"),
        {"comment": "Active user sessions"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token = Column(String(500), unique=True, nullable=False, comment="Session token")
    refresh_token = Column(String(500), unique=True, nullable=True, comment="Refresh token")
    ip_address = Column(IpAddressType, nullable=False, comment="Client IP address")
    user_agent = Column(Text, nullable=True, comment="Browser user agent")
    device_info = Column(JsonType, default={}, comment="Device information")
    created_at = Column(AwareTimestamp, default=datetime.utcnow, nullable=False)
    expires_at = Column(AwareTimestamp, nullable=False, comment="Token expiration")
    last_activity_at = Column(AwareTimestamp, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_revoked = Column(Boolean, default=False, comment="Revoked flag")

    user = relationship("User", back_populates="sessions")

    @property
    def is_expired(self) -> bool:
        """Check if session is expired"""
        if self.expires_at.tzinfo is not None:
            return datetime.now(timezone.utc) > self.expires_at.astimezone(timezone.utc)
        return datetime.utcnow() > self.expires_at

    @property
    def is_valid(self) -> bool:
        """Check if session is valid"""
        return not self.is_revoked and not self.is_expired

class TokenBlacklist(Base):
    __tablename__ = "token_blacklist"
    __table_args__ = (
        Index("idx_blacklist_token", "token"),
        Index("idx_blacklist_expires_at", "expires_at"),
        {"comment": "Blacklisted JWT tokens"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    token = Column(String(500), unique=True, nullable=False, comment="Blacklisted token")
    token_type = Column(String(20), nullable=False, comment="access/refresh")
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    revoked_at = Column(AwareTimestamp, default=datetime.utcnow, nullable=False)
    expires_at = Column(AwareTimestamp, nullable=False, comment="Token expiration")
    reason = Column(String(255), nullable=True, comment="Revocation reason")
