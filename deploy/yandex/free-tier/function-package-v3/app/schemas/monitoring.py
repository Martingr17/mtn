from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


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
    labels: List[str]
    timestamps: List[datetime]
    ping_ms: List[Optional[float]]
    packet_loss_pct: List[Optional[float]]
    jitter_ms: List[Optional[float]]
    download_mbps: List[Optional[float]]
    upload_mbps: List[Optional[float]]
    quality_score: List[int]
    quality_state: List[str]


class MonitoringMetricsResponse(BaseModel):
    date_from: datetime
    date_to: datetime
    interval: str
    points: List[MonitoringMetricPoint]
    charts: MonitoringChartSeries
    totals: Dict[str, Any]


class MonitoringAlertResponse(BaseModel):
    id: int
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
    details: Optional[Dict[str, Any]] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MonitoringAlertListResponse(BaseModel):
    total: int
    items: List[MonitoringAlertResponse]
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
    recent_alerts: List[MonitoringAlertResponse]
    monitoring_enabled: bool = True
    notification_channels: Dict[str, bool]


class AlertThresholdResponse(BaseModel):
    id: int
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
    items: List[AlertThresholdUpdateItem]
