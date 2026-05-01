from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import MvpRole
from app.database import get_db
from app.dependencies import require_mvp_roles
from app.models import User
from app.schemas.radius import (
    RadiusActionListResponse,
    RadiusActionLogResponse,
    RadiusActionResultResponse,
    RadiusChangeSpeedRequest,
    RadiusSessionListResponse,
    RadiusSessionResponse,
)
from app.services.radius_adapter import (
    RadiusMockAdapter,
    radius_action_payload,
    radius_session_payload,
)


router = APIRouter(prefix="/radius", tags=["radius"])

RADIUS_VIEW_ROLES = (MvpRole.SUPPORT, MvpRole.BILLING, MvpRole.NOC_ENGINEER, MvpRole.ADMIN)
RADIUS_DISCONNECT_ROLES = (MvpRole.SUPPORT, MvpRole.NOC_ENGINEER, MvpRole.ADMIN)
RADIUS_BILLING_ROLES = (MvpRole.BILLING, MvpRole.ADMIN)
RADIUS_SPEED_ROLES = (MvpRole.NOC_ENGINEER, MvpRole.ADMIN)


def _adapter(db: AsyncSession) -> RadiusMockAdapter:
    return RadiusMockAdapter(db)


def _action_response(session, action_log) -> RadiusActionResultResponse:
    return RadiusActionResultResponse(
        session=RadiusSessionResponse(**radius_session_payload(session)),
        action=RadiusActionLogResponse(**radius_action_payload(action_log)),
    )


@router.get("/sessions", response_model=RadiusSessionListResponse)
async def get_radius_sessions(
    status_filter: str = Query("all", alias="status", max_length=24),
    search: str = Query("", max_length=120),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_mvp_roles(RADIUS_VIEW_ROLES)),
) -> RadiusSessionListResponse:
    sessions, total, total_pages = await _adapter(db).get_sessions(
        status_filter=status_filter,
        search=search,
        page=page,
        page_size=page_size,
    )
    return RadiusSessionListResponse(
        items=[RadiusSessionResponse(**radius_session_payload(item)) for item in sessions],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/subscribers/{subscriber_id}/session", response_model=RadiusSessionResponse)
async def get_radius_subscriber_session(
    subscriber_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_mvp_roles(RADIUS_VIEW_ROLES)),
) -> RadiusSessionResponse:
    session = await _adapter(db).get_subscriber_session(subscriber_id)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="RADIUS session not found",
        )
    return RadiusSessionResponse(**radius_session_payload(session))


@router.post("/subscribers/{subscriber_id}/block", response_model=RadiusActionResultResponse)
async def block_radius_subscriber(
    subscriber_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(RADIUS_BILLING_ROLES)),
) -> RadiusActionResultResponse:
    session, action_log = await _adapter(db).block_subscriber(
        subscriber_id,
        performed_by=current_user,
        request=request,
    )
    return _action_response(session, action_log)


@router.post("/subscribers/{subscriber_id}/unblock", response_model=RadiusActionResultResponse)
async def unblock_radius_subscriber(
    subscriber_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(RADIUS_BILLING_ROLES)),
) -> RadiusActionResultResponse:
    session, action_log = await _adapter(db).unblock_subscriber(
        subscriber_id,
        performed_by=current_user,
        request=request,
    )
    return _action_response(session, action_log)


@router.post("/subscribers/{subscriber_id}/disconnect", response_model=RadiusActionResultResponse)
async def disconnect_radius_subscriber(
    subscriber_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(RADIUS_DISCONNECT_ROLES)),
) -> RadiusActionResultResponse:
    session, action_log = await _adapter(db).disconnect_subscriber(
        subscriber_id,
        performed_by=current_user,
        request=request,
    )
    return _action_response(session, action_log)


@router.post("/subscribers/{subscriber_id}/change-speed", response_model=RadiusActionResultResponse)
async def change_radius_subscriber_speed(
    subscriber_id: int,
    payload: RadiusChangeSpeedRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(RADIUS_SPEED_ROLES)),
) -> RadiusActionResultResponse:
    session, action_log = await _adapter(db).change_speed(
        subscriber_id,
        payload.speed_down,
        payload.speed_up,
        performed_by=current_user,
        request=request,
    )
    return _action_response(session, action_log)


@router.get("/actions", response_model=RadiusActionListResponse)
async def get_radius_actions(
    action: str = Query("all", max_length=32),
    search: str = Query("", max_length=120),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_mvp_roles(RADIUS_VIEW_ROLES)),
) -> RadiusActionListResponse:
    actions, total, total_pages = await _adapter(db).get_actions(
        action_filter=action,
        search=search,
        page=page,
        page_size=page_size,
    )
    return RadiusActionListResponse(
        items=[RadiusActionLogResponse(**radius_action_payload(item)) for item in actions],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )
