from sqlalchemy import Column, BigInteger, String, Boolean, DateTime, Text, Enum, Integer, ForeignKey, Index
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base
from app.core.constants import TicketStatus, TicketPriority
from app.db_compat import JsonType


def _coerce_comparable_datetime(value: datetime | None, reference: datetime | None = None) -> datetime | None:
    if value is None:
        return None
    if reference is None or reference.tzinfo is None:
        return value.replace(tzinfo=None) if value.tzinfo else value
    if value.tzinfo is None:
        return value.replace(tzinfo=reference.tzinfo)
    return value.astimezone(reference.tzinfo)


class Ticket(Base):
    __tablename__ = "tickets"
    __table_args__ = (
        Index("idx_tickets_user_status", "user_id", "status"),
        Index("idx_tickets_status_priority", "status", "priority"),
        Index("idx_tickets_assigned_to", "assigned_to"),
        Index("idx_tickets_created_at", "created_at"),
        Index("idx_tickets_sla_deadline", "sla_deadline"),
        {"comment": "Support tickets"}
    )
    
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    assigned_to = Column(BigInteger, ForeignKey("users.id"), nullable=True, comment="Assigned operator/admin")
    
    subject = Column(String(255), nullable=False, comment="Ticket subject")
    category = Column(String(50), nullable=True, comment="Category: internet, tv, payment, other")
    
    status = Column(Enum(TicketStatus), default=TicketStatus.NEW, nullable=False)
    priority = Column(Enum(TicketPriority), default=TicketPriority.MEDIUM, nullable=False)
    
    # SLA tracking
    sla_deadline = Column(DateTime(timezone=True), nullable=True, comment="SLA response deadline")
    escalated_at = Column(DateTime(timezone=True), nullable=True, comment="Escalation timestamp")
    first_response_at = Column(DateTime(timezone=True), nullable=True, comment="First operator response time")
    resolved_at = Column(DateTime(timezone=True), nullable=True, comment="Resolution timestamp")
    closed_at = Column(DateTime(timezone=True), nullable=True, comment="Closure timestamp")
    
    # Resolution info
    resolution_summary = Column(Text, nullable=True, comment="Resolution summary")
    satisfaction_rating = Column(Integer, nullable=True, comment="Customer satisfaction rating 1-5")
    
    # Metadata
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=datetime.utcnow)
    last_activity_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Additional data
    meta = Column("metadata", JsonType, default={}, comment="Additional metadata")
    tags = Column(JsonType, default=[], comment="Ticket tags")
    
    # Relationships
    user = relationship("User", foreign_keys=[user_id], back_populates="tickets")
    assignee = relationship("User", foreign_keys=[assigned_to], lazy="selectin")
    messages = relationship("Message", back_populates="ticket", cascade="all, delete-orphan", lazy="selectin")
    
    def __repr__(self):
        return f"<Ticket(id={self.id}, subject={self.subject[:50]}, status={self.status})>"
    
    @property
    def is_overdue(self) -> bool:
        """Check if ticket is overdue based on SLA"""
        if not self.sla_deadline:
            return False
        current_time = datetime.now(self.sla_deadline.tzinfo) if self.sla_deadline.tzinfo else datetime.utcnow()
        deadline = _coerce_comparable_datetime(self.sla_deadline, current_time)
        return bool(deadline and current_time > deadline and self.status not in [TicketStatus.RESOLVED, TicketStatus.CLOSED])
    
    @property
    def response_time_seconds(self) -> int | None:
        """Calculate first response time in seconds"""
        if self.first_response_at and self.created_at:
            created_at = _coerce_comparable_datetime(self.created_at, self.first_response_at)
            first_response_at = _coerce_comparable_datetime(self.first_response_at, created_at)
            if created_at and first_response_at:
                return int((first_response_at - created_at).total_seconds())
        return None
    
    @property
    def resolution_time_seconds(self) -> int | None:
        """Calculate resolution time in seconds"""
        if self.resolved_at and self.created_at:
            created_at = _coerce_comparable_datetime(self.created_at, self.resolved_at)
            resolved_at = _coerce_comparable_datetime(self.resolved_at, created_at)
            if created_at and resolved_at:
                return int((resolved_at - created_at).total_seconds())
        return None

class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        Index("idx_messages_ticket_id", "ticket_id"),
        Index("idx_messages_user_id", "user_id"),
        Index("idx_messages_created_at", "created_at"),
        {"comment": "Ticket messages"}
    )
    
    id = Column(BigInteger, primary_key=True, autoincrement=True)
    ticket_id = Column(BigInteger, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(BigInteger, ForeignKey("users.id"), nullable=False)
    
    body = Column(Text, nullable=False, comment="Message body")
    is_internal = Column(Boolean, default=False, comment="Internal note (not visible to customer)")
    
    attachment_path = Column(String(512), nullable=True, comment="Path to attached file")
    attachment_name = Column(String(255), nullable=True, comment="Original filename")
    attachment_size = Column(Integer, nullable=True, comment="File size in bytes")
    attachment_mime = Column(String(100), nullable=True, comment="MIME type")
    
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)
    edited_at = Column(DateTime(timezone=True), nullable=True, comment="Last edit timestamp")
    
    # Relationships
    ticket = relationship("Ticket", back_populates="messages")
    user = relationship("User", back_populates="messages")
    
    def __repr__(self):
        return f"<Message(id={self.id}, ticket_id={self.ticket_id}, user_id={self.user_id})>"
