from sqlalchemy import Boolean, Column, BigInteger, DateTime, Enum, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base
from app.core.constants import NotificationType, NotificationPriority

class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        Index("idx_notifications_user_id", "user_id"),
        Index("idx_notifications_read", "is_read"),
        Index("idx_notifications_archived", "is_archived"),
        Index("idx_notifications_created_at", "created_at"),
        Index("idx_notifications_event_type", "event_type"),
        Index("idx_notifications_category", "category"),
        Index("idx_notifications_type_priority", "type", "priority"),
        {"comment": "User notifications"}
    )
    
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    title = Column(String(255), nullable=False, comment="Notification title")
    body = Column(Text, nullable=False, comment="Notification body")

    type = Column(Enum(NotificationType), default=NotificationType.EMAIL, nullable=False)
    priority = Column(Enum(NotificationPriority), default=NotificationPriority.NORMAL, nullable=False)
    event_type = Column(String(50), default="info", nullable=False, comment="Semantic event type")
    category = Column(String(50), default="system", nullable=False, comment="Subscription category")

    is_read = Column(Boolean, default=False, comment="Read flag")
    is_archived = Column(Boolean, default=False, nullable=False, comment="Archived flag")
    is_sent = Column(Boolean, default=False, comment="Sent flag")
    sent_at = Column(DateTime(timezone=True), nullable=True, comment="Delivery timestamp")
    read_at = Column(DateTime(timezone=True), nullable=True, comment="Read timestamp")
    expires_at = Column(DateTime(timezone=True), nullable=True, comment="Notification expiration time")

    action_url = Column(String(500), nullable=True, comment="URL to navigate on click")
    action_data = Column(JSONB, nullable=True, comment="Additional action data")
    
    meta = Column("metadata", JSONB, default={}, comment="Additional metadata")
    
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    
    user = relationship("User", back_populates="notifications")
    
    def __repr__(self):
        return f"<Notification(id={self.id}, user_id={self.user_id}, title={self.title[:50]})>"

class NotificationTemplate(Base):
    __tablename__ = "notification_templates"
    
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False, comment="Template name")
    type = Column(Enum(NotificationType), nullable=False, comment="Notification type")
    
    subject_template = Column(String(255), nullable=True, comment="Email subject template")
    body_template = Column(Text, nullable=False, comment="Message body template (Jinja2)")
    
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), onupdate=datetime.utcnow)


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    __table_args__ = (
        Index("idx_push_subscriptions_user_active", "user_id", "is_active"),
        {"comment": "Browser push subscriptions"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    endpoint = Column(String(500), unique=True, nullable=False)
    p256dh_key = Column(String(200), nullable=False)
    auth_key = Column(String(100), nullable=False)
    user_agent = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    last_used_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    user = relationship("User", back_populates="push_subscriptions")
