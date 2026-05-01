from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import MvpRole, user_role_has_mvp_access
from app.database import get_db
from app.dependencies import require_mvp_roles
from app.models import User
from app.schemas.incidents import (
    IncidentActionResponse,
    IncidentAssignRequest,
    IncidentCreateRequest,
    IncidentListResponse,
    IncidentResponse,
)
from app.services.incidents import IncidentService, incident_payload


router = APIRouter(prefix="/incidents", tags=["incidents"])

INCIDENT_READ_ROLES = (MvpRole.SUPPORT, MvpRole.NOC_ENGINEER, MvpRole.ADMIN)
INCIDENT_NOC_ROLES = (MvpRole.NOC_ENGINEER, MvpRole.ADMIN)
INCIDENT_ADMIN_ROLES = (MvpRole.ADMIN,)


def _service(db: AsyncSession) -> IncidentService:
    return IncidentService(db)


def _action_response(incident, action: str, result: str = "success") -> IncidentActionResponse:
    return IncidentActionResponse(
        incident=IncidentResponse(**incident_payload(incident)),
        action=action,
        result=result,
    )


def _is_admin(user: User) -> bool:
    return user_role_has_mvp_access(user.role, [MvpRole.ADMIN])


@router.get("", response_model=IncidentListResponse)
async def list_incidents(
    status_filter: str = Query("all", alias="status", max_length=24),
    severity: str = Query("all", max_length=24),
    affected_service: str = Query("all", max_length=32),
    source: str = Query("all", max_length=24),
    search: str = Query("", max_length=120),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_mvp_roles(INCIDENT_READ_ROLES)),
) -> IncidentListResponse:
    incidents, total, total_pages = await _service(db).list_incidents(
        status_filter=status_filter,
        severity=severity,
        affected_service=affected_service,
        source=source,
        search=search,
        page=page,
        page_size=page_size,
    )
    return IncidentListResponse(
        items=[IncidentResponse(**incident_payload(item)) for item in incidents],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/{incident_id}", response_model=IncidentResponse)
async def get_incident(
    incident_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_mvp_roles(INCIDENT_READ_ROLES)),
) -> IncidentResponse:
    incident = await _service(db).get_incident(incident_id)
    return IncidentResponse(**incident_payload(incident))


@router.post("", response_model=IncidentActionResponse)
async def create_incident(
    payload: IncidentCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(INCIDENT_NOC_ROLES)),
) -> IncidentActionResponse:
    if payload.assigned_to is not None and not _is_admin(current_user) and payload.assigned_to != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="NOC engineer can assign incidents only to self",
        )
    incident = await _service(db).create_incident(
        payload.model_dump(),
        created_by=current_user,
        request=request,
    )
    return _action_response(incident, "create")


@router.post("/from-alarm/{alarm_id}", response_model=IncidentActionResponse)
async def create_incident_from_alarm(
    alarm_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(INCIDENT_NOC_ROLES)),
) -> IncidentActionResponse:
    incident, created = await _service(db).create_from_alarm(alarm_id, created_by=current_user, request=request)
    return _action_response(
        incident,
        "create_from_alarm",
        "created" if created else "existing",
    )


@router.post("/{incident_id}/ack", response_model=IncidentActionResponse)
async def acknowledge_incident(
    incident_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(INCIDENT_NOC_ROLES)),
) -> IncidentActionResponse:
    incident = await _service(db).acknowledge_incident(incident_id, user=current_user, request=request)
    return _action_response(incident, "ack")


@router.post("/{incident_id}/start", response_model=IncidentActionResponse)
async def start_incident(
    incident_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(INCIDENT_NOC_ROLES)),
) -> IncidentActionResponse:
    incident = await _service(db).start_incident(incident_id, user=current_user, request=request)
    return _action_response(incident, "start")


@router.post("/{incident_id}/resolve", response_model=IncidentActionResponse)
async def resolve_incident(
    incident_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(INCIDENT_NOC_ROLES)),
) -> IncidentActionResponse:
    incident = await _service(db).resolve_incident(incident_id, user=current_user, request=request)
    return _action_response(incident, "resolve")


@router.post("/{incident_id}/close", response_model=IncidentActionResponse)
async def close_incident(
    incident_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(INCIDENT_ADMIN_ROLES)),
) -> IncidentActionResponse:
    incident = await _service(db).close_incident(incident_id, user=current_user, request=request)
    return _action_response(incident, "close")


@router.post("/{incident_id}/assign", response_model=IncidentActionResponse)
async def assign_incident(
    incident_id: int,
    payload: IncidentAssignRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_mvp_roles(INCIDENT_NOC_ROLES)),
) -> IncidentActionResponse:
    if not _is_admin(current_user) and payload.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="NOC engineer can assign incidents only to self",
        )
    incident = await _service(db).assign_incident(
        incident_id,
        payload.user_id,
        assigned_by=current_user,
        request=request,
    )
    return _action_response(incident, "assign")
