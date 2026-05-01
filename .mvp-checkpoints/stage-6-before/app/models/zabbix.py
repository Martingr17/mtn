from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Numeric, String, Text
from sqlalchemy.orm import relationship

from app.core.constants import ZabbixAlarmStatus, ZabbixSeverity
from app.database import Base


class ZabbixAlarm(Base):
    __tablename__ = "zabbix_alarms"
    __table_args__ = (
        Index("idx_zabbix_alarms_type_status", "alarm_type", "status"),
        Index("idx_zabbix_alarms_severity_status", "severity", "status"),
        Index("idx_zabbix_alarms_source", "source_type", "source_id"),
        Index("idx_zabbix_alarms_last_seen", "last_seen_at"),
        {"comment": "Mock Zabbix alarms for network monitoring MVP"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    alarm_type = Column(String(48), nullable=False)
    severity = Column(String(24), nullable=False, default=ZabbixSeverity.WARNING.value)
    status = Column(String(24), nullable=False, default=ZabbixAlarmStatus.ACTIVE.value)
    source_type = Column(String(48), nullable=False)
    source_name = Column(String(255), nullable=False)
    source_id = Column(BigInteger, nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    metric_name = Column(String(128), nullable=True)
    metric_value = Column(Numeric(12, 2), nullable=True)
    threshold = Column(Numeric(12, 2), nullable=True)
    first_seen_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    last_seen_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    acknowledged_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    acknowledged_by_user = relationship("User", foreign_keys=[acknowledged_by], lazy="selectin")
    resolved_by_user = relationship("User", foreign_keys=[resolved_by], lazy="selectin")

    def __repr__(self) -> str:
        return (
            f"<ZabbixAlarm(id={self.id}, alarm_type={self.alarm_type}, "
            f"severity={self.severity}, status={self.status})>"
        )
