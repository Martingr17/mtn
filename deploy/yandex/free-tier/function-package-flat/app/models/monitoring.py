from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.database import Base
from app.db_compat import JsonType, TimeOfDayType


class MonitoringMetric(Base):
    __tablename__ = "metrics"
    __table_args__ = (
        Index("idx_metrics_user_time", "user_id", "collected_at"),
        Index("idx_metrics_collected_at", "collected_at"),
        {"comment": "Connection quality metrics collected for subscribers"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    ping_ms = Column(Numeric(8, 2), nullable=True)
    packet_loss_pct = Column(Numeric(5, 2), nullable=True)
    jitter_ms = Column(Numeric(8, 2), nullable=True)
    download_mbps = Column(Numeric(10, 2), nullable=True)
    upload_mbps = Column(Numeric(10, 2), nullable=True)
    source = Column(String(32), nullable=False, default="synthetic")
    route_snapshot = Column(JsonType, nullable=True, default=dict)
    collected_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="monitoring_metrics")

    def __repr__(self) -> str:
        return (
            f"<MonitoringMetric(id={self.id}, user_id={self.user_id}, "
            f"ping_ms={self.ping_ms}, packet_loss_pct={self.packet_loss_pct})>"
        )


class MonitoringAlert(Base):
    __tablename__ = "alerts"
    __table_args__ = (
        Index("idx_alerts_user_start", "user_id", "start_time"),
        Index("idx_alerts_type_status", "type", "status"),
        Index("idx_alerts_read", "is_read"),
        {"comment": "Monitoring alerts triggered for subscribers"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(50), nullable=False)
    severity = Column(String(20), nullable=False)
    status = Column(String(20), nullable=False, default="active")
    metric_name = Column(String(50), nullable=True)
    message = Column(Text, nullable=False)
    start_time = Column(DateTime(timezone=True), nullable=False)
    end_time = Column(DateTime(timezone=True), nullable=True)
    is_read = Column(Boolean, default=False, nullable=False)
    current_value = Column(Numeric(10, 2), nullable=True)
    threshold_value = Column(Numeric(10, 2), nullable=True)
    duration_minutes = Column(Integer, nullable=True)
    details = Column(JsonType, nullable=True, default=dict)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="monitoring_alerts")

    def __repr__(self) -> str:
        return (
            f"<MonitoringAlert(id={self.id}, user_id={self.user_id}, type={self.type}, "
            f"severity={self.severity}, status={self.status})>"
        )


class MonitoringNotificationSetting(Base):
    __tablename__ = "notification_settings"

    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    monitoring_enabled = Column(Boolean, default=True, nullable=False)
    site_enabled = Column(Boolean, default=True, nullable=False)
    email_enabled = Column(Boolean, default=True, nullable=False)
    telegram_enabled = Column(Boolean, default=False, nullable=False)
    browser_push_enabled = Column(Boolean, default=True, nullable=False)
    enabled_event_types = Column(JsonType, nullable=False, default=list)
    quiet_hours_start = Column(TimeOfDayType(), nullable=True)
    quiet_hours_end = Column(TimeOfDayType(), nullable=True)
    telegram_chat_id = Column(String(100), nullable=True)
    alert_cooldown_minutes = Column(Integer, default=30, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="monitoring_notification_setting")


class AlertThreshold(Base):
    __tablename__ = "alert_thresholds"
    __table_args__ = (
        Index("idx_alert_thresholds_metric", "metric_name"),
        {"comment": "Rules for connection quality alerting"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    metric_name = Column(String(50), nullable=False, unique=True)
    condition = Column(String(10), nullable=False, default=">")
    warning_value = Column(Numeric(10, 2), nullable=True)
    critical_value = Column(Numeric(10, 2), nullable=True)
    warning_duration_minutes = Column(Integer, default=5, nullable=False)
    critical_duration_minutes = Column(Integer, default=2, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self) -> str:
        return f"<AlertThreshold(metric_name={self.metric_name}, condition={self.condition})>"
