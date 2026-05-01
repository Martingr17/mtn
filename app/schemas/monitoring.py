from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.ids import BigIntID


class MonitoringMetricPoint(BaseModel):
    timestamp: datetime
    ping_ms: Optional[float] = None
    packet_loss_pct: Optional[float] = None
    jitter_ms: Optional[float] = None
    download_mbps: Optional[float] = None
    upload_mbps: Optional[float] = None
    quality_score: int = 0
    quality_state: str = "no_data"


class MonitoringChartSeries(BaseModel):
    labels: list[str]
    timestamps: list[datetime]
    ping_ms: list[Optional[float]]
    packet_loss_pct: list[Optional[float]]
    jitter_ms: list[Optional[float]]
    download_mbps: list[Optional[float]]
    upload_mbps: list[Optional[float]]
    quality_score: list[int]
    quality_state: list[str]


class MonitoringMetricsResponse(BaseModel):
    date_from: datetime
    date_to: datetime
    interval: str
    points: list[MonitoringMetricPoint]
    charts: MonitoringChartSeries
    totals: dict[str, Any]


class MonitoringAlertResponse(BaseModel):
    id: BigIntID
    type: str
    severity: str
    status: str
    metric_name: Optional[str] = None
    message: str
    start_time: datetime
    end_time: Optional[datetime] = None
    is_read: bool
    current_value: Optional[float] = None
    threshold_value: Optional[float] = None
    duration_minutes: Optional[int] = None
    details: Optional[dict[str, Any]] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MonitoringAlertListResponse(BaseModel):
    total: int
    items: list[MonitoringAlertResponse]
    page: int
    page_size: int
    unread_count: int


class MonitoringSubscriptionRequest(BaseModel):
    monitoring_enabled: bool = True
    email_enabled: bool = True
    telegram_enabled: bool = False
    browser_push_enabled: bool = True
    telegram_chat_id: Optional[str] = Field(default=None, max_length=100)
    alert_cooldown_minutes: int = Field(default=30, ge=5, le=1440)


class MonitoringSubscriptionResponse(MonitoringSubscriptionRequest):
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MonitoringToggleRequest(BaseModel):
    monitoring_enabled: bool


class MonitoringSummaryResponse(BaseModel):
    quality_state: str
    quality_label: str
    quality_score: int
    alerts_last_24h: int
    unread_alerts: int
    active_alerts: int
    last_collected_at: Optional[datetime] = None
    current_metrics: Optional[MonitoringMetricPoint] = None
    recent_alerts: list[MonitoringAlertResponse]
    monitoring_enabled: bool = True
    notification_channels: dict[str, bool]


class AlertThresholdResponse(BaseModel):
    id: BigIntID
    metric_name: str
    condition: str
    warning_value: Optional[float] = None
    critical_value: Optional[float] = None
    warning_duration_minutes: int
    critical_duration_minutes: int
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class AlertThresholdUpdateItem(BaseModel):
    metric_name: str = Field(..., max_length=50)
    condition: str = Field(..., max_length=10)
    warning_value: Optional[float] = Field(default=None, ge=0)
    critical_value: Optional[float] = Field(default=None, ge=0)
    warning_duration_minutes: int = Field(default=5, ge=1, le=1440)
    critical_duration_minutes: int = Field(default=2, ge=1, le=1440)
    is_active: bool = True


class AlertThresholdUpdateRequest(BaseModel):
    items: list[AlertThresholdUpdateItem]
