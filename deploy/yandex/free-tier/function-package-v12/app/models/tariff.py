from sqlalchemy import Column, BigInteger, String, Numeric, Boolean, Text, DateTime, Integer, ForeignKey, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base
from app.db_compat import IpAddressType, JsonType

class Tariff(Base):
    __tablename__ = "tariffs"
    __table_args__ = (
        Index("idx_tariffs_billing_id", "billing_tariff_id"),
        Index("idx_tariffs_active", "is_active"),
        Index("idx_tariffs_price", "price"),
        {"comment": "Tariff plans catalog"}
    )
    
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    billing_tariff_id = Column(String(64), unique=True, nullable=False, comment="ID in billing system")
    name = Column(String(128), nullable=False, comment="Tariff name")
    name_en = Column(String(128), nullable=True, comment="English name")
    
    # Technical parameters
    speed_mbps = Column(Integer, nullable=False, comment="Download speed in Mbps")
    upload_speed_mbps = Column(Integer, nullable=True, comment="Upload speed in Mbps")
    price = Column(Numeric(10, 2), nullable=False, comment="Monthly price in RUB")
    setup_fee = Column(Numeric(10, 2), default=0, comment="One-time setup fee")
    
    # Features
    is_unlimited = Column(Boolean, default=True, comment="Unlimited traffic flag")
    traffic_limit_gb = Column(Integer, nullable=True, comment="Traffic limit in GB (if limited)")
    contract_term_months = Column(Integer, default=12, comment="Minimum contract term")
    
    # Additional info
    description = Column(Text, nullable=True, comment="Russian description")
    description_en = Column(Text, nullable=True, comment="English description")
    features = Column(JsonType, default=[], comment="List of features")
    is_active = Column(Boolean, default=True, nullable=False, comment="Available for selection")
    is_popular = Column(Boolean, default=False, comment="Popular tariff flag")
    sort_order = Column(Integer, default=0, comment="Display order")
    
    # Metadata
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=datetime.utcnow)
    created_by = Column(BigInteger, nullable=True, comment="Admin user ID who created")
    
    # Relationships
    change_requests = relationship(
        "TariffChangeRequest",
        back_populates="tariff",
        lazy="selectin",
        foreign_keys="TariffChangeRequest.new_tariff_id",
    )
    
    def __repr__(self):
        return f"<Tariff(id={self.id}, name={self.name}, price={self.price})>"

class TariffChangeRequest(Base):
    __tablename__ = "tariff_change_requests"
    __table_args__ = (
        Index("idx_tariff_requests_user", "user_id"),
        Index("idx_tariff_requests_status", "status"),
        Index("idx_tariff_requests_created", "requested_at"),
        {"comment": "Tariff change requests history"}
    )
    
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    old_tariff_id = Column(BigInteger, ForeignKey("tariffs.id"), nullable=True)
    new_tariff_id = Column(BigInteger, ForeignKey("tariffs.id"), nullable=False)
    
    status = Column(String(20), default="pending", comment="pending/completed/failed/rejected")
    error_message = Column(Text, nullable=True, comment="Error if failed")
    
    requested_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    processed_at = Column(DateTime(timezone=True), nullable=True)
    effective_from = Column(DateTime(timezone=True), nullable=True, comment="Date when tariff becomes active")
    
    ip_address = Column(IpAddressType, nullable=True)
    user_agent = Column(Text, nullable=True)
    
    # Relationships
    user = relationship("User")
    tariff = relationship("Tariff", foreign_keys=[new_tariff_id], back_populates="change_requests")
    old_tariff = relationship("Tariff", foreign_keys=[old_tariff_id])
    new_tariff = relationship("Tariff", foreign_keys=[new_tariff_id], overlaps="tariff,change_requests")
