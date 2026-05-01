from sqlalchemy import Column, BigInteger, String, Numeric, DateTime, Enum, ForeignKey, Index, Text, Integer, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base
from app.core.constants import PaymentStatus
from app.db_compat import IpAddressType, JsonType

class PaymentLog(Base):
    __tablename__ = "payments_log"
    __table_args__ = (
        Index("idx_payments_user_id", "user_id"),
        Index("idx_payments_status", "status"),
        Index("idx_payments_external_id", "external_id"),
        Index("idx_payments_created_at", "created_at"),
        {"comment": "Payment transactions log"}
    )
    
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    
    amount = Column(Numeric(10, 2), nullable=False, comment="Payment amount in RUB")
    fee_amount = Column(Numeric(10, 2), default=0, comment="Processing fee")
    net_amount = Column(Numeric(10, 2), nullable=True, comment="Amount after fee")
    
    payment_method = Column(String(64), nullable=True, comment="bank_card, sbp, apple_pay, google_pay")
    payment_type = Column(String(32), default="topup", comment="topup, subscription, fine")
    
    status = Column(Enum(PaymentStatus), default=PaymentStatus.PENDING, nullable=False)
    
    external_id = Column(String(128), unique=True, nullable=True, comment="Payment gateway transaction ID")
    payment_url = Column(String(512), nullable=True, comment="Checkout URL for повторной оплаты")
    gateway_response = Column(JsonType, nullable=True, comment="Raw gateway response")
    
    description = Column(String(255), nullable=True, comment="Payment description")
    
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True, comment="Completion timestamp")
    
    ip_address = Column(IpAddressType, nullable=True)
    user_agent = Column(Text, nullable=True)
    
    # Relationships
    user = relationship("User", back_populates="payments")
    
    def __repr__(self):
        return f"<PaymentLog(id={self.id}, user_id={self.user_id}, amount={self.amount}, status={self.status})>"

class PaymentMethod(Base):
    __tablename__ = "payment_methods"
    __table_args__ = (
        Index("idx_payment_methods_user_id", "user_id"),
        Index("idx_payment_methods_is_default", "is_default"),
        {"comment": "Saved payment methods for users"}
    )
    
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    method_type = Column(String(32), nullable=False, comment="card, sbp, etc")
    token = Column(String(255), nullable=False, comment="Gateway token")
    
    masked_pan = Column(String(20), nullable=True, comment="Masked card number (e.g., ****1234)")
    card_type = Column(String(20), nullable=True, comment="Visa, Mastercard, Mir")
    expiry_month = Column(String(2), nullable=True)
    expiry_year = Column(String(4), nullable=True)
    
    is_default = Column(Boolean, default=False, comment="Default payment method")
    is_active = Column(Boolean, default=True, comment="Active flag")
    
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    
    user = relationship("User")
