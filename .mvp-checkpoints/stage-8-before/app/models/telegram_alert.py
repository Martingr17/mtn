from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, Index, String, Text

from app.database import Base


class TelegramAlertLog(Base):
    __tablename__ = "telegram_alert_log"
    __table_args__ = (
        Index("idx_telegram_alert_entity", "entity_type", "entity_id"),
        Index("idx_telegram_alert_status", "status"),
        Index("idx_telegram_alert_created_at", "created_at"),
        {"comment": "Telegram critical alert delivery log"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    entity_type = Column(String(32), nullable=False)
    entity_id = Column(BigInteger, nullable=False)
    severity = Column(String(24), nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    chat_id = Column(String(128), nullable=False)
    status = Column(String(24), nullable=False)
    error = Column(Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    def __repr__(self) -> str:
        return f"<TelegramAlertLog(id={self.id}, entity_type={self.entity_type}, status={self.status})>"
