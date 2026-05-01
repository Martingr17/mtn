from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import MvpRole
from app.database import get_db
from app.dependencies import require_mvp_roles
from app.models import User
from app.schemas.zabbix import (
    ZabbixAlarmActionResponse,
    ZabbixAlarmListResponse,
    ZabbixAlarmResponse,
    ZabbixRefreshResponse,
    ZabbixSummaryResponse,
)
from app.services.zabbix_adapter import ZabbixMockAdapter, zabbix_alarm_payload


router = APIRouter(prefix="/zabbix", tags=["zabbix"])

ZABBIX_READ_ROLES = (MvpRole.SUPPORT, MvpRole.NOC_ENGINEER, MvpRole.ADMIN)
ZABBIX_ACTION_ROLES = (MvpRole.NOC_ENGINEER, MvpRole.ADMIN)


def _adapter(db: AsyncSession) -> ZabbixMockAdapter:
    return ZabbixMockAdapter(db)


def _action_response(alarm, action: str) -> ZabbixAlarmActionResponse:
    return ZabbixAlarmActionResponse(
        alarm=ZabbixAlarmResponse(**zabbix_alarm_payload(alarm)),
        action=action,
        result="mock_success",
    )


@router.get("/alarms", response_model=ZabbixAlarmListResponse)
async def get_zabbix_alarms(
    severity: str = Query("all", max_length=24),
    status_filter: str = Query("all", alias="status", max_length=24),
    alarm_type: str = Query("all", max_length=48),
    source_type: str = Query("all", max_length=48),
    source_id: int | None = Query(None, ge=1),
    search: str = Query("", max_length=120),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_mvp_roles(ZABBIX_READ_ROLES)),
) -> ZabbixAlarmListResponse:
    alarms, total, total_pages = await _adapter(db).get_alarms(
        severity=severity,
        status_filter=status_filter,
        alarm_type=alarm_type,
        source_type=source_type,
        source_id=source_id,
        search=search,
        page=page,
        page_size=page_size,
    )
    return ZabbixAlarmListResponse(
        items=[ZabbixAlarmResponse(**zabbix_alarm_payload(item)) for item in alarms],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/alarms/{alarm_id}", response_model=ZabbixAlarmResponse)
async def get_zabbix_alarm(
    alarm_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_mvp_roles(ZABBIX_READ_ROLES)),
) -> ZabbixAlarmResponse:
    alarm = await _adapter(db).get_alarm(alarm_id)
    return ZabbixAlarmResponse(**zabbix_alarm_payload(alarm))


@router.get("/summary", response_model=ZabbixSummaryResponse)
async def get_zabbix_summary(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_mvp_roles(ZABBIX_READ_ROLES)),
) -> ZabbixSummaryResponse:
    return ZabbixSummaryResponse(**await _adapter(db).get_summary())


@router.post("/alarms/{alarm_id}/ack", response_model=ZabbixAlarmActionResponse)
async def acknowledge_zabbix_alarm(
    alarm_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(ZABBIX_ACTION_ROLES)),
) -> ZabbixAlarmActionResponse:
    alarm = await _adapter(db).acknowledge_alarm(alarm_id, current_user, request=request)
    return _action_response(alarm, "ack")


@router.post("/alarms/{alarm_id}/resolve", response_model=ZabbixAlarmActionResponse)
async def resolve_zabbix_alarm(
    alarm_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(ZABBIX_ACTION_ROLES)),
) -> ZabbixAlarmActionResponse:
    alarm = await _adapter(db).resolve_alarm(alarm_id, current_user, request=request)
    return _action_response(alarm, "resolve")


@router.post("/refresh", response_model=ZabbixRefreshResponse)
async def refresh_zabbix_mock_alarms(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(ZABBIX_ACTION_ROLES)),
) -> ZabbixRefreshResponse:
    return ZabbixRefreshResponse(**await _adapter(db).refresh_mock_alarms(current_user, request=request))
