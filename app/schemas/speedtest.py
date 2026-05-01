from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from app.schemas.ids import BigIntID


class SpeedtestSessionResponse(BaseModel):
    session_id: str
    expires_in: int
    download_size_mb: int
    upload_size_mb: int
    max_tests_per_hour: int
    network_check_enabled: bool


class SpeedtestRunRequest(BaseModel):
    session_id: str
    download_mbps: float = Field(..., ge=0, le=100000)
    upload_mbps: float = Field(..., ge=0, le=100000)
    ping_ms: float = Field(..., ge=0, le=10000)


class SpeedtestResultResponse(BaseModel):
    id: BigIntID
    download_mbps: float
    upload_mbps: float
    ping_ms: float
    created_at: datetime

    model_config = {"from_attributes": True}


class SpeedtestStatsResponse(BaseModel):
    avg_download: float
    avg_upload: float
    min_ping: float
    total_tests: int
    last_test_at: Optional[datetime] = None
