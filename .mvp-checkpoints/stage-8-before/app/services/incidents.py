from __future__ import annotations

import math
from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.requests import Request

from app.core.constants import (
    NocAffectedService,
    NocIncidentSeverity,
    NocIncidentSource,
    NocIncidentStatus,
    ZabbixAlarmType,
    ZabbixSeverity,
)
from app.models import AuditLog, IncidentAlarmLink, NocIncident, User, ZabbixAlarm
from app.services.telegram_alerts import TelegramAlertService
from app.services.zabbix_adapter import zabbix_alarm_payload


OPEN_INCIDENT_STATUSES = {
    NocIncidentStatus.NEW.value,
    NocIncidentStatus.ACKNOWLEDGED.value,
    NocIncidentStatus.IN_PROGRESS.value,
}


class IncidentService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_incidents(
        self,
        *,
        status_filter: str = "all",
        severity: str = "all",
        affected_service: str = "all",
        source: str = "all",
        search: str = "",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[NocIncident], int, int]:
        filters = []
        if status_filter != "all":
            self._validate_status(status_filter)
            filters.append(NocIncident.status == status_filter)
        if severity != "all":
            self._validate_severity(severity)
            filters.append(NocIncident.severity == severity)
        if affected_service != "all":
            self._validate_affected_service(affected_service)
            filters.append(NocIncident.affected_service == affected_service)
        if source != "all":
            self._validate_source(source)
            filters.append(NocIncident.source == source)
        if search.strip():
            term = f"%{search.strip()}%"
            filters.append(or_(NocIncident.title.ilike(term), NocIncident.description.ilike(term)))

        base_query = select(NocIncident)
        count_query = select(func.count()).select_from(NocIncident)
        if filters:
            base_query = base_query.where(*filters)
            count_query = count_query.where(*filters)

        total = int(await self.db.scalar(count_query) or 0)
        result = await self.db.execute(
            base_query.options(*self._load_options())
            .order_by(NocIncident.status.asc(), NocIncident.severity.desc(), NocIncident.updated_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size),
        )
        return list(result.scalars().unique().all()), total, max(math.ceil(total / page_size), 1)

    async def get_incident(self, incident_id: int) -> NocIncident:
        result = await self.db.execute(
            select(NocIncident).options(*self._load_options()).where(NocIncident.id == incident_id),
        )
        incident = result.scalars().unique().one_or_none()
        if incident is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="NOC incident not found")
        return incident

    async def create_incident(
        self,
        payload: dict[str, Any],
        *,
        created_by: User,
        request: Request | None = None,
    ) -> NocIncident:
        self._validate_severity(payload["severity"])
        self._validate_affected_service(payload["affected_service"])
        if payload.get("assigned_to") is not None:
            await self._get_user(payload["assigned_to"])

        now = datetime.utcnow()
        incident = NocIncident(
            title=payload["title"],
            description=payload.get("description"),
            severity=payload["severity"],
            status=NocIncidentStatus.NEW.value,
            source=NocIncidentSource.MANUAL.value,
            affected_service=payload["affected_service"],
            affected_subscribers_count=payload.get("affected_subscribers_count", 0),
            assigned_to=payload.get("assigned_to"),
            created_by=created_by.id,
            created_at=now,
            updated_at=now,
        )
        self.db.add(incident)
        await self.db.flush()
        await self._record_audit(incident, "create", None, created_by, request)
        if incident.severity == NocIncidentSeverity.CRITICAL.value:
            await TelegramAlertService(self.db).send_critical_incident(incident.id, performed_by=created_by)
        return await self.get_incident(incident.id)

    async def create_from_alarm(
        self,
        alarm_id: int,
        *,
        created_by: User,
        request: Request | None = None,
    ) -> tuple[NocIncident, bool]:
        alarm = await self._get_alarm(alarm_id)
        existing_result = await self.db.execute(
            select(NocIncident)
            .join(IncidentAlarmLink, IncidentAlarmLink.incident_id == NocIncident.id)
            .options(*self._load_options())
            .where(
                IncidentAlarmLink.zabbix_alarm_id == alarm_id,
                NocIncident.status.in_(OPEN_INCIDENT_STATUSES),
            )
            .order_by(NocIncident.created_at.desc())
            .limit(1),
        )
        existing = existing_result.scalars().unique().one_or_none()
        if existing is not None:
            return existing, False

        now = datetime.utcnow()
        incident = NocIncident(
            title=alarm.title,
            description=alarm.description,
            severity=self._severity_from_alarm(alarm.severity),
            status=NocIncidentStatus.NEW.value,
            source=NocIncidentSource.ZABBIX.value,
            affected_service=self._affected_service_from_alarm(alarm.alarm_type),
            affected_subscribers_count=1 if alarm.source_type == "ont" else 0,
            created_by=created_by.id,
            created_at=now,
            updated_at=now,
        )
        self.db.add(incident)
        await self.db.flush()
        self.db.add(IncidentAlarmLink(incident_id=incident.id, zabbix_alarm_id=alarm.id))
        await self.db.flush()
        await self._record_audit(
            incident,
            "create_from_alarm",
            None,
            created_by,
            request,
            extra={"zabbix_alarm_id": alarm.id},
        )
        if incident.severity == NocIncidentSeverity.CRITICAL.value:
            await TelegramAlertService(self.db).send_critical_incident(incident.id, performed_by=created_by)
        return await self.get_incident(incident.id), True

    async def acknowledge_incident(
        self,
        incident_id: int,
        *,
        user: User,
        request: Request | None = None,
    ) -> NocIncident:
        incident = await self.get_incident(incident_id)
        before = self._snapshot(incident)
        now = datetime.utcnow()
        incident.status = NocIncidentStatus.ACKNOWLEDGED.value
        incident.acknowledged_at = incident.acknowledged_at or now
        incident.acknowledged_by = user.id
        incident.updated_at = now
        await self._record_audit(incident, "ack", before, user, request)
        return await self.get_incident(incident.id)

    async def start_incident(
        self,
        incident_id: int,
        *,
        user: User,
        request: Request | None = None,
    ) -> NocIncident:
        incident = await self.get_incident(incident_id)
        before = self._snapshot(incident)
        now = datetime.utcnow()
        incident.status = NocIncidentStatus.IN_PROGRESS.value
        incident.started_at = incident.started_at or now
        incident.assigned_to = incident.assigned_to or user.id
        incident.updated_at = now
        await self._record_audit(incident, "start", before, user, request)
        return await self.get_incident(incident.id)

    async def resolve_incident(
        self,
        incident_id: int,
        *,
        user: User,
        request: Request | None = None,
    ) -> NocIncident:
        incident = await self.get_incident(incident_id)
        before = self._snapshot(incident)
        now = datetime.utcnow()
        incident.status = NocIncidentStatus.RESOLVED.value
        incident.resolved_at = incident.resolved_at or now
        incident.resolved_by = user.id
        incident.updated_at = now
        await self._record_audit(incident, "resolve", before, user, request)
        return await self.get_incident(incident.id)

    async def close_incident(
        self,
        incident_id: int,
        *,
        user: User,
        request: Request | None = None,
    ) -> NocIncident:
        incident = await self.get_incident(incident_id)
        before = self._snapshot(incident)
        now = datetime.utcnow()
        incident.status = NocIncidentStatus.CLOSED.value
        incident.closed_at = incident.closed_at or now
        incident.closed_by = user.id
        incident.updated_at = now
        await self._record_audit(incident, "close", before, user, request)
        return await self.get_incident(incident.id)

    async def assign_incident(
        self,
        incident_id: int,
        user_id: int,
        *,
        assigned_by: User,
        request: Request | None = None,
    ) -> NocIncident:
        await self._get_user(user_id)
        incident = await self.get_incident(incident_id)
        before = self._snapshot(incident)
        incident.assigned_to = user_id
        incident.updated_at = datetime.utcnow()
        await self._record_audit(
            incident,
            "assign",
            before,
            assigned_by,
            request,
            extra={"assigned_to": user_id},
        )
        return await self.get_incident(incident.id)

    async def _get_alarm(self, alarm_id: int) -> ZabbixAlarm:
        result = await self.db.execute(select(ZabbixAlarm).where(ZabbixAlarm.id == alarm_id))
        alarm = result.scalar_one_or_none()
        if alarm is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zabbix alarm not found")
        return alarm

    async def _get_user(self, user_id: int) -> User:
        result = await self.db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        return user

    async def _record_audit(
        self,
        incident: NocIncident,
        action: str,
        before: dict[str, Any] | None,
        user: User,
        request: Request | None,
        *,
        extra: dict[str, Any] | None = None,
    ) -> None:
        changes = {
            "action": action,
            "before": before,
            "after": self._snapshot(incident),
            "mock": True,
        }
        if extra:
            changes.update(extra)

        audit_log = AuditLog(
            user_id=user.id,
            entity_type="noc_incident",
            entity_id=incident.id,
            operation=f"incident_{action}",
            changes=changes,
            ip_address=self._request_ip(request),
            user_agent=self._request_user_agent(request),
            reason="NOC incident workflow action",
            requires_retention=True,
            created_at=datetime.utcnow(),
        )
        self.db.add(audit_log)
        await self.db.flush()
        await self.db.commit()

    @staticmethod
    def _load_options():
        return (
            selectinload(NocIncident.assigned_user),
            selectinload(NocIncident.created_by_user),
            selectinload(NocIncident.alarm_links).selectinload(IncidentAlarmLink.alarm),
        )

    @staticmethod
    def _snapshot(incident: NocIncident) -> dict[str, Any]:
        return {
            "title": incident.title,
            "severity": incident.severity,
            "status": incident.status,
            "source": incident.source,
            "affected_service": incident.affected_service,
            "affected_subscribers_count": incident.affected_subscribers_count,
            "assigned_to": incident.assigned_to,
            "acknowledged_by": incident.acknowledged_by,
            "resolved_by": incident.resolved_by,
            "closed_by": incident.closed_by,
            "updated_at": incident.updated_at.isoformat() if incident.updated_at else None,
        }

    @staticmethod
    def _validate_status(value: str) -> None:
        try:
            NocIncidentStatus(value)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid incident status") from exc

    @staticmethod
    def _validate_severity(value: str) -> None:
        try:
            NocIncidentSeverity(value)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid incident severity") from exc

    @staticmethod
    def _validate_source(value: str) -> None:
        try:
            NocIncidentSource(value)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid incident source") from exc

    @staticmethod
    def _validate_affected_service(value: str) -> None:
        try:
            NocAffectedService(value)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid affected service") from exc

    @staticmethod
    def _severity_from_alarm(value: str) -> str:
        mapping = {
            ZabbixSeverity.INFO.value: NocIncidentSeverity.LOW.value,
            ZabbixSeverity.WARNING.value: NocIncidentSeverity.MEDIUM.value,
            ZabbixSeverity.HIGH.value: NocIncidentSeverity.HIGH.value,
            ZabbixSeverity.CRITICAL.value: NocIncidentSeverity.CRITICAL.value,
        }
        return mapping.get(value, NocIncidentSeverity.MEDIUM.value)

    @staticmethod
    def _affected_service_from_alarm(value: str) -> str:
        mapping = {
            ZabbixAlarmType.BGP_DOWN.value: NocAffectedService.BGP.value,
            ZabbixAlarmType.VRRP_FAILOVER.value: NocAffectedService.VRRP.value,
            ZabbixAlarmType.ERPS_RING_FAULT.value: NocAffectedService.ERPS.value,
            ZabbixAlarmType.OLT_OFFLINE.value: NocAffectedService.OLT.value,
            ZabbixAlarmType.LOW_OPTICAL_POWER.value: NocAffectedService.ONT.value,
            ZabbixAlarmType.UPS_LOW_BATTERY.value: NocAffectedService.UPS.value,
            ZabbixAlarmType.DDOS_DETECTED.value: NocAffectedService.DDOS.value,
            ZabbixAlarmType.NAT_POOL_HIGH.value: NocAffectedService.CGNAT.value,
        }
        return mapping.get(value, NocAffectedService.OTHER.value)

    @staticmethod
    def _request_ip(request: Request | None) -> str:
        return request.client.host if request and request.client else "127.0.0.1"

    @staticmethod
    def _request_user_agent(request: Request | None) -> str | None:
        return request.headers.get("user-agent") if request else None


def incident_user_payload(user: User | None) -> dict[str, Any] | None:
    if user is None:
        return None
    return {
        "id": user.id,
        "full_name": getattr(user, "full_name", None) or user.phone,
        "role": user.role.value if hasattr(user.role, "value") else str(user.role),
    }


def incident_payload(incident: NocIncident) -> dict[str, Any]:
    return {
        "id": incident.id,
        "title": incident.title,
        "description": incident.description,
        "severity": incident.severity,
        "status": incident.status,
        "source": incident.source,
        "affected_service": incident.affected_service,
        "affected_subscribers_count": incident.affected_subscribers_count,
        "assigned_to": incident.assigned_to,
        "created_by": incident.created_by,
        "acknowledged_by": incident.acknowledged_by,
        "resolved_by": incident.resolved_by,
        "closed_by": incident.closed_by,
        "created_at": incident.created_at,
        "acknowledged_at": incident.acknowledged_at,
        "started_at": incident.started_at,
        "resolved_at": incident.resolved_at,
        "closed_at": incident.closed_at,
        "updated_at": incident.updated_at,
        "assigned_user": incident_user_payload(getattr(incident, "assigned_user", None)),
        "created_by_user": incident_user_payload(getattr(incident, "created_by_user", None)),
        "alarms": [
            zabbix_alarm_payload(link.alarm)
            for link in getattr(incident, "alarm_links", [])
            if getattr(link, "alarm", None) is not None
        ],
    }
