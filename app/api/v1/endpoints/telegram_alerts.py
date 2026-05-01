from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import MvpRole
from app.database import get_db
from app.dependencies import require_mvp_roles
from app.models import User
from app.schemas.telegram_alerts import (
    TelegramAlertActionResponse,
    TelegramAlertLogListResponse,
    TelegramAlertLogResponse,
)
from app.services.telegram_alerts import TelegramAlertService, telegram_alert_payload


router = APIRouter(prefix="/telegram-alerts", tags=["telegram-alerts"])

TELEGRAM_ALERT_ROLES = (MvpRole.NOC_ENGINEER, MvpRole.ADMIN)


def _service(db: AsyncSession) -> TelegramAlertService:
    return TelegramAlertService(db)


def _action_response(log) -> TelegramAlertActionResponse:
    return TelegramAlertActionResponse(
        alert=TelegramAlertLogResponse(**telegram_alert_payload(log)),
        result=log.status,
    )


@router.get("", response_model=TelegramAlertLogListResponse)
async def list_telegram_alerts(
    entity_type: str = Query("all", max_length=32),
    status_filter: str = Query("all", alias="status", max_length=24),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_mvp_roles(TELEGRAM_ALERT_ROLES)),
) -> TelegramAlertLogListResponse:
    logs, total, total_pages = await _service(db).list_logs(
        entity_type=entity_type,
        status_filter=status_filter,
        page=page,
        page_size=page_size,
    )
    return TelegramAlertLogListResponse(
        items=[TelegramAlertLogResponse(**telegram_alert_payload(item)) for item in logs],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.post("/zabbix/{alarm_id}/send", response_model=TelegramAlertActionResponse)
async def send_zabbix_telegram_alert(
    alarm_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(TELEGRAM_ALERT_ROLES)),
) -> TelegramAlertActionResponse:
    log = await _service(db).send_critical_alarm(alarm_id, performed_by=current_user)
    return _action_response(log)


@router.post("/incidents/{incident_id}/send", response_model=TelegramAlertActionResponse)
async def send_incident_telegram_alert(
    incident_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(TELEGRAM_ALERT_ROLES)),
) -> TelegramAlertActionResponse:
    log = await _service(db).send_critical_incident(incident_id, performed_by=current_user)
    return _action_response(log)
