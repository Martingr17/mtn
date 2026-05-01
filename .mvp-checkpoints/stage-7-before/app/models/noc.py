from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.constants import NocAffectedService, NocIncidentSeverity, NocIncidentSource, NocIncidentStatus
from app.database import Base


class NocIncident(Base):
    __tablename__ = "noc_incidents"
    __table_args__ = (
        Index("idx_noc_incidents_status", "status"),
        Index("idx_noc_incidents_severity", "severity"),
        Index("idx_noc_incidents_service", "affected_service"),
        Index("idx_noc_incidents_source", "source"),
        Index("idx_noc_incidents_assigned", "assigned_to"),
        Index("idx_noc_incidents_created_at", "created_at"),
        {"comment": "NOC operational incidents"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    severity = Column(String(24), nullable=False, default=NocIncidentSeverity.MEDIUM.value)
    status = Column(String(24), nullable=False, default=NocIncidentStatus.NEW.value)
    source = Column(String(24), nullable=False, default=NocIncidentSource.MANUAL.value)
    affected_service = Column(String(32), nullable=False, default=NocAffectedService.OTHER.value)
    affected_subscribers_count = Column(Integer, nullable=False, default=0)
    assigned_to = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    acknowledged_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    closed_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    assigned_user = relationship("User", foreign_keys=[assigned_to], lazy="selectin")
    created_by_user = relationship("User", foreign_keys=[created_by], lazy="selectin")
    acknowledged_by_user = relationship("User", foreign_keys=[acknowledged_by], lazy="selectin")
    resolved_by_user = relationship("User", foreign_keys=[resolved_by], lazy="selectin")
    closed_by_user = relationship("User", foreign_keys=[closed_by], lazy="selectin")
    alarm_links = relationship(
        "IncidentAlarmLink",
        back_populates="incident",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<NocIncident(id={self.id}, status={self.status}, severity={self.severity})>"


class IncidentAlarmLink(Base):
    __tablename__ = "incident_alarm_links"
    __table_args__ = (
        Index("idx_incident_alarm_links_incident", "incident_id"),
        Index("idx_incident_alarm_links_alarm", "zabbix_alarm_id"),
        {"comment": "Links NOC incidents to Zabbix alarms"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    incident_id = Column(BigInteger, ForeignKey("noc_incidents.id", ondelete="CASCADE"), nullable=False)
    zabbix_alarm_id = Column(BigInteger, ForeignKey("zabbix_alarms.id", ondelete="CASCADE"), nullable=False)

    incident = relationship("NocIncident", back_populates="alarm_links", lazy="selectin")
    alarm = relationship("ZabbixAlarm", lazy="selectin")

    def __repr__(self) -> str:
        return f"<IncidentAlarmLink(incident_id={self.incident_id}, alarm_id={self.zabbix_alarm_id})>"
