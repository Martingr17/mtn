from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import MvpRole, user_role_has_mvp_access
from app.database import get_db
from app.dependencies import get_current_user, require_mvp_roles
from app.models import User
from app.schemas.gpon import (
    GponOltListResponse,
    GponOltResponse,
    GponOntActionResponse,
    GponOntListResponse,
    GponOntResponse,
)
from app.services.gpon_adapter import GponMockAdapter, olt_payload, ont_payload


router = APIRouter(prefix="/gpon", tags=["gpon"])

GPON_READ_ROLES = (MvpRole.SUPPORT, MvpRole.NOC_ENGINEER, MvpRole.ADMIN)
GPON_SUMMARY_ROLES = (
    MvpRole.SUBSCRIBER,
    MvpRole.SUPPORT,
    MvpRole.BILLING,
    MvpRole.NOC_ENGINEER,
    MvpRole.ADMIN,
)
GPON_NOC_ACTION_ROLES = (MvpRole.NOC_ENGINEER, MvpRole.ADMIN)
GPON_ADMIN_ACTION_ROLES = (MvpRole.ADMIN,)


def _adapter(db: AsyncSession) -> GponMockAdapter:
    return GponMockAdapter(db)


def _ont_action_response(ont, action: str) -> GponOntActionResponse:
    return GponOntActionResponse(
        ont=GponOntResponse(**ont_payload(ont)),
        action=action,
        result="mock_success",
    )


def _ensure_can_read_subscriber_ont(current_user: User, subscriber_id: int) -> None:
    if user_role_has_mvp_access(current_user.role, [MvpRole.SUBSCRIBER]) and current_user.id != subscriber_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Subscriber can read only own ONT summary",
        )
    if not user_role_has_mvp_access(current_user.role, GPON_SUMMARY_ROLES):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient GPON permissions")


@router.get("/olts", response_model=GponOltListResponse)
async def get_gpon_olts(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_mvp_roles(GPON_READ_ROLES)),
) -> GponOltListResponse:
    olts = await _adapter(db).get_olts()
    return GponOltListResponse(
        items=[GponOltResponse(**olt_payload(item)) for item in olts],
        total=len(olts),
    )


@router.get("/olts/{olt_id}", response_model=GponOltResponse)
async def get_gpon_olt(
    olt_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_mvp_roles(GPON_READ_ROLES)),
) -> GponOltResponse:
    olt = await _adapter(db).get_olt(olt_id)
    return GponOltResponse(**olt_payload(olt))


@router.get("/onts", response_model=GponOntListResponse)
async def get_gpon_onts(
    olt_id: int | None = Query(None, ge=1),
    status_filter: str = Query("all", alias="status", max_length=32),
    vlan_id: int | None = Query(None, ge=1),
    pon_port: int | None = Query(None, ge=1, le=128),
    rx_power_min: float | None = Query(None),
    rx_power_max: float | None = Query(None),
    search: str = Query("", max_length=120),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_mvp_roles(GPON_READ_ROLES)),
) -> GponOntListResponse:
    onts, total, total_pages = await _adapter(db).get_onts(
        olt_id=olt_id,
        status_filter=status_filter,
        vlan_id=vlan_id,
        pon_port=pon_port,
        rx_power_min=rx_power_min,
        rx_power_max=rx_power_max,
        search=search,
        page=page,
        page_size=page_size,
    )
    return GponOntListResponse(
        items=[GponOntResponse(**ont_payload(item)) for item in onts],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/onts/{ont_id}", response_model=GponOntResponse)
async def get_gpon_ont(
    ont_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_mvp_roles(GPON_READ_ROLES)),
) -> GponOntResponse:
    ont = await _adapter(db).get_ont(ont_id)
    return GponOntResponse(**ont_payload(ont))


@router.get("/subscribers/{subscriber_id}/ont", response_model=GponOntResponse)
async def get_gpon_subscriber_ont(
    subscriber_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> GponOntResponse:
    _ensure_can_read_subscriber_ont(current_user, subscriber_id)
    ont = await _adapter(db).get_subscriber_ont(subscriber_id)
    if ont is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ONT not found")
    return GponOntResponse(**ont_payload(ont))


@router.post("/onts/{ont_id}/reboot", response_model=GponOntActionResponse)
async def reboot_gpon_ont(
    ont_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(GPON_NOC_ACTION_ROLES)),
) -> GponOntActionResponse:
    ont = await _adapter(db).reboot_ont(ont_id, performed_by=current_user, request=request)
    return _ont_action_response(ont, "reboot")


@router.post("/onts/{ont_id}/block", response_model=GponOntActionResponse)
async def block_gpon_ont(
    ont_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(GPON_ADMIN_ACTION_ROLES)),
) -> GponOntActionResponse:
    ont = await _adapter(db).block_ont(ont_id, performed_by=current_user, request=request)
    return _ont_action_response(ont, "block")


@router.post("/onts/{ont_id}/unblock", response_model=GponOntActionResponse)
async def unblock_gpon_ont(
    ont_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(GPON_ADMIN_ACTION_ROLES)),
) -> GponOntActionResponse:
    ont = await _adapter(db).unblock_ont(ont_id, performed_by=current_user, request=request)
    return _ont_action_response(ont, "unblock")


@router.post("/onts/{ont_id}/mark-rogue-suspected", response_model=GponOntActionResponse)
async def mark_gpon_ont_rogue_suspected(
    ont_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(GPON_NOC_ACTION_ROLES)),
) -> GponOntActionResponse:
    ont = await _adapter(db).mark_rogue_suspected(ont_id, performed_by=current_user, request=request)
    return _ont_action_response(ont, "mark_rogue_suspected")


@router.post("/onts/{ont_id}/refresh-status", response_model=GponOntActionResponse)
async def refresh_gpon_ont_status(
    ont_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(GPON_NOC_ACTION_ROLES)),
) -> GponOntActionResponse:
    ont = await _adapter(db).refresh_ont_status(ont_id, performed_by=current_user, request=request)
    return _ont_action_response(ont, "refresh_status")
