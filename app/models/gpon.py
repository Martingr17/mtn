from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Integer, Numeric, String
from sqlalchemy.orm import relationship

from app.core.constants import GponOltStatus, GponOntStatus
from app.database import Base
from app.db_compat import IpAddressType


class Olt(Base):
    __tablename__ = "olts"
    __table_args__ = (
        Index("idx_olts_status", "status"),
        Index("idx_olts_management_ip", "management_ip"),
        {"comment": "Mock GPON OLT inventory"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(128), nullable=False)
    vendor = Column(String(64), nullable=False, default="Eltex")
    model = Column(String(64), nullable=False, default="LTP-16X")
    management_ip = Column(IpAddressType, nullable=False, unique=True)
    location = Column(String(255), nullable=True)
    status = Column(String(24), nullable=False, default=GponOltStatus.ONLINE.value)
    pon_ports_total = Column(Integer, nullable=False, default=16)
    pon_ports_used = Column(Integer, nullable=False, default=0)
    uplink_status = Column(String(24), nullable=False, default="up")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    onts = relationship("Ont", back_populates="olt", lazy="selectin")

    def __repr__(self) -> str:
        return f"<Olt(id={self.id}, name={self.name}, status={self.status})>"


class Ont(Base):
    __tablename__ = "onts"
    __table_args__ = (
        Index("idx_onts_subscriber", "subscriber_id"),
        Index("idx_onts_olt", "olt_id"),
        Index("idx_onts_status", "status"),
        Index("idx_onts_vlan", "vlan_id"),
        Index("idx_onts_pon_port", "pon_port"),
        Index("idx_onts_rx_power", "rx_power"),
        {"comment": "Mock GPON ONT inventory"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    subscriber_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    olt_id = Column(BigInteger, ForeignKey("olts.id", ondelete="CASCADE"), nullable=False)
    serial_number = Column(String(64), nullable=False, unique=True)
    mac_address = Column(String(32), nullable=True)
    pon_port = Column(Integer, nullable=False)
    ont_id_on_port = Column(Integer, nullable=False)
    vlan_id = Column(Integer, nullable=False)
    status = Column(String(32), nullable=False, default=GponOntStatus.ONLINE.value)
    rx_power = Column(Numeric(6, 2), nullable=True)
    tx_power = Column(Numeric(6, 2), nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    subscriber = relationship("User", foreign_keys=[subscriber_id], lazy="selectin")
    olt = relationship("Olt", back_populates="onts", lazy="selectin")

    def __repr__(self) -> str:
        return f"<Ont(id={self.id}, serial={self.serial_number}, status={self.status})>"
