from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import relationship

from app.core.constants import RadiusAction, RadiusSessionStatus
from app.database import Base
from app.db_compat import IpAddressType


class RadiusSession(Base):
    __tablename__ = "radius_sessions"
    __table_args__ = (
        Index("idx_radius_sessions_subscriber", "subscriber_id"),
        Index("idx_radius_sessions_status", "status"),
        Index("idx_radius_sessions_framed_ip", "framed_ip_address"),
        Index("idx_radius_sessions_mac", "mac_address"),
        {"comment": "Mock RADIUS subscriber sessions"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    subscriber_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    username = Column(String(128), nullable=False)
    framed_ip_address = Column(IpAddressType, nullable=True)
    mac_address = Column(String(32), nullable=True)
    nas_ip_address = Column(IpAddressType, nullable=True)
    nas_port = Column(String(64), nullable=True)
    session_id = Column(String(128), nullable=False, unique=True)
    status = Column(String(24), nullable=False, default=RadiusSessionStatus.ACTIVE.value)
    tariff_profile = Column(String(128), nullable=True)
    speed_down = Column(Integer, nullable=False, default=100)
    speed_up = Column(Integer, nullable=False, default=50)
    started_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    subscriber = relationship("User", foreign_keys=[subscriber_id], lazy="selectin")

    def __repr__(self) -> str:
        return f"<RadiusSession(id={self.id}, subscriber_id={self.subscriber_id}, status={self.status})>"


class RadiusActionLog(Base):
    __tablename__ = "radius_action_log"
    __table_args__ = (
        Index("idx_radius_actions_subscriber", "subscriber_id"),
        Index("idx_radius_actions_action", "action"),
        Index("idx_radius_actions_created", "created_at"),
        {"comment": "Mock RADIUS/CoA action log"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    subscriber_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    action = Column(String(32), nullable=False, default=RadiusAction.DISCONNECT.value)
    old_status = Column(String(24), nullable=True)
    new_status = Column(String(24), nullable=True)
    old_speed_down = Column(Integer, nullable=True)
    new_speed_down = Column(Integer, nullable=True)
    old_speed_up = Column(Integer, nullable=True)
    new_speed_up = Column(Integer, nullable=True)
    performed_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    result = Column(String(32), nullable=False, default="mock_success")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    subscriber = relationship("User", foreign_keys=[subscriber_id], lazy="selectin")
    performer = relationship("User", foreign_keys=[performed_by], lazy="selectin")

    def __repr__(self) -> str:
        return f"<RadiusActionLog(id={self.id}, subscriber_id={self.subscriber_id}, action={self.action})>"
