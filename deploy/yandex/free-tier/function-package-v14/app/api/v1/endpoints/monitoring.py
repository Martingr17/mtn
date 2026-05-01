from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import UserRole
from app.database import get_db
from app.dependencies import get_current_admin, get_current_user, require_roles
from app.models import User
from app.schemas.monitoring import (
    AlertThresholdResponse,
    AlertThresholdUpdateRequest,
    MonitoringAlertListResponse,
    MonitoringAlertResponse,
    MonitoringMetricsResponse,
    MonitoringSubscriptionRequest,
    MonitoringSubscriptionResponse,
    MonitoringSummaryResponse,
    MonitoringToggleRequest,
)
from app.services.monitoring import (
    get_alerts_response,
    get_metrics_response,
    get_monitoring_summary,
    get_or_create_subscription,
    get_thresholds,
    mark_alert_read,
    replace_thresholds,
    update_subscription_settings,
)

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


def _default_period(days: int = 1) -> tuple[datetime, datetime]:
    date_to = datetime.utcnow().replace(second=0, microsecond=0)
    date_from = date_to - timedelta(days=days)
    return date_from, date_to


@router.get("/metrics", response_model=MonitoringMetricsResponse)
async def get_monitoring_metrics(
    date_from: Optional[datetime] = Query(default=None, alias="from"),
    date_to: Optional[datetime] = Query(default=None, alias="to"),
    interval: str = Query(default="1h"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if date_from is None or date_to is None:
        date_from, date_to = _default_period(1)
    if date_from >= date_to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Некорректный период мониторинга")

    payload = await get_metrics_response(
        db,
        current_user,
        date_from=date_from,
        date_to=date_to,
        interval=interval,
    )
    return MonitoringMetricsResponse(**payload)


@router.get("/alerts", response_model=MonitoringAlertListResponse)
async def get_monitoring_alerts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    alert_type: Optional[str] = Query(default=None, alias="type"),
    severity: Optional[str] = Query(default=None),
    status_value: Optional[str] = Query(default=None, alias="status"),
    date_from: Optional[datetime] = Query(default=None, alias="from"),
    date_to: Optional[datetime] = Query(default=None, alias="to"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    payload = await get_alerts_response(
        db,
        current_user.id,
        page=page,
        page_size=page_size,
        alert_type=alert_type,
        severity=severity,
        status_value=status_value,
        date_from=date_from,
        date_to=date_to,
    )
    return MonitoringAlertListResponse(**payload)


@router.post("/alerts/{alert_id}/read", response_model=MonitoringAlertResponse)
async def read_monitoring_alert(
    alert_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    alert = await mark_alert_read(db, user_id=current_user.id, alert_id=alert_id)
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Алерт не найден")
    await db.commit()
    await db.refresh(alert)
    return MonitoringAlertResponse.model_validate(alert)


@router.get("/summary", response_model=MonitoringSummaryResponse)
async def get_monitoring_summary_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    payload = await get_monitoring_summary(db, current_user)
    return MonitoringSummaryResponse(**payload)


@router.get("/subscribe", response_model=MonitoringSubscriptionResponse)
async def get_monitoring_subscription(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    settings_row = await get_or_create_subscription(db, current_user.id)
    return MonitoringSubscriptionResponse.model_validate(settings_row)


@router.post("/subscribe", response_model=MonitoringSubscriptionResponse)
async def subscribe_monitoring_alerts(
    payload: MonitoringSubscriptionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    settings_row = await update_subscription_settings(db, current_user.id, payload.model_dump())
    await db.commit()
    await db.refresh(settings_row)
    return MonitoringSubscriptionResponse.model_validate(settings_row)


@router.get("/admin/thresholds", response_model=List[AlertThresholdResponse])
async def get_monitoring_thresholds(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    rows = await get_thresholds(db)
    return [AlertThresholdResponse.model_validate(item) for item in rows]


@router.put("/admin/thresholds", response_model=List[AlertThresholdResponse])
async def update_monitoring_thresholds(
    payload: AlertThresholdUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_roles([UserRole.ADMIN, UserRole.SUPER_ADMIN])),
):
    rows = await replace_thresholds(db, [item.model_dump() for item in payload.items])
    await db.commit()
    return [AlertThresholdResponse.model_validate(item) for item in rows]


@router.get("/admin/users/{user_id}", response_model=MonitoringSubscriptionResponse)
async def get_user_monitoring_settings(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    settings_row = await get_or_create_subscription(db, user_id)
    return MonitoringSubscriptionResponse.model_validate(settings_row)


@router.post("/admin/users/{user_id}/toggle")
async def toggle_user_monitoring(
    user_id: int,
    payload: MonitoringToggleRequest,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(get_current_admin),
):
    settings_row = await get_or_create_subscription(db, user_id)
    settings_row.monitoring_enabled = payload.monitoring_enabled
    settings_row.updated_at = datetime.utcnow()
    await db.commit()
    return {
        "message": "Настройка мониторинга обновлена",
        "user_id": user_id,
        "monitoring_enabled": settings_row.monitoring_enabled,
    }
