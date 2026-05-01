from datetime import datetime

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Numeric, Text
from sqlalchemy.orm import relationship

from app.database import Base
from app.db_compat import IpAddressType, JsonType


class SpeedtestResult(Base):
    __tablename__ = "speedtest_results"
    __table_args__ = (
        Index("idx_speedtest_results_user_id", "user_id"),
        Index("idx_speedtest_results_created_at", "created_at"),
        {"comment": "Saved user speedtest measurements"},
    )

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    download_mbps = Column(Numeric(10, 2), nullable=False)
    upload_mbps = Column(Numeric(10, 2), nullable=False)
    ping_ms = Column(Numeric(10, 2), nullable=False)
    ip_address = Column(IpAddressType, nullable=True)
    user_agent = Column(Text, nullable=True)
    server_meta = Column(JsonType, nullable=True, default=dict)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)

    user = relationship("User", back_populates="speedtest_results")

    def __repr__(self):
        return (
            f"<SpeedtestResult(id={self.id}, user_id={self.user_id}, "
            f"download={self.download_mbps}, upload={self.upload_mbps}, ping={self.ping_ms})>"
        )
