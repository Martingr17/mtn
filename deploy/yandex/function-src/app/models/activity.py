from sqlalchemy import Column, BigInteger, String, DateTime, Enum, ForeignKey, Index, Text, Boolean
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base
from app.core.constants import ActionType

class ActivityLog(Base):
    __tablename__ = "activity_log"
    __table_args__ = (
        Index("idx_activity_user_id", "user_id"),
        Index("idx_activity_action", "action"),
        Index("idx_activity_created_at", "created_at"),
        Index("idx_activity_user_action_date", "user_id", "action", "created_at"),
        {"comment": "User activity audit log"}
    )
    
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    
    action = Column(String(128), nullable=False, comment="Action code")
    action_type = Column(Enum(ActionType), nullable=True, comment="Action type enum")
    
    ip_address = Column(INET, nullable=False, comment="Client IP address")
    user_agent = Column(Text, nullable=True, comment="Browser user agent")
    
    resource_type = Column(String(50), nullable=True, comment="Resource type (ticket, user, etc)")
    resource_id = Column(BigInteger, nullable=True, comment="Resource identifier")
    
    old_value = Column(JSONB, nullable=True, comment="Previous state (for updates)")
    new_value = Column(JSONB, nullable=True, comment="New state (for updates)")
    
    status = Column(String(20), default="success", comment="success/failure")
    error_message = Column(Text, nullable=True, comment="Error details if failed")
    
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    
    user = relationship("User", back_populates="activity_logs")
    
    def __repr__(self):
        return f"<ActivityLog(id={self.id}, user_id={self.user_id}, action={self.action}, created_at={self.created_at})>"

class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (
        Index("idx_audit_user_id", "user_id"),
        Index("idx_audit_entity", "entity_type", "entity_id"),
        Index("idx_audit_created_at", "created_at"),
        {"comment": "Sensitive operations audit (GDPR compliant)"}
    )
    
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    
    entity_type = Column(String(50), nullable=False, comment="Entity type (user, payment, etc)")
    entity_id = Column(BigInteger, nullable=False, comment="Entity identifier")
    
    operation = Column(String(50), nullable=False, comment="CREATE, READ, UPDATE, DELETE, EXPORT")
    changes = Column(JSONB, nullable=True, comment="Changes made (before/after)")
    
    ip_address = Column(INET, nullable=False)
    user_agent = Column(Text, nullable=True)
    
    reason = Column(Text, nullable=True, comment="Reason for operation (for data access)")
    requires_retention = Column(Boolean, default=True, comment="Subject to retention policy")
    
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    
    user = relationship("User")
