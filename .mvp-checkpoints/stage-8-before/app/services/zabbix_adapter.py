from __future__ import annotations

import math
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.core.constants import (
    ZabbixAlarmStatus,
    ZabbixAlarmType,
    ZabbixSeverity,
    ZabbixSourceType,
)
from app.models import AuditLog, Olt, Ont, User, ZabbixAlarm
from app.services.telegram_alerts import TelegramAlertService


class ZabbixMockAdapter:
    """Mock monitoring adapter shaped for a future Zabbix API implementation."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_alarms(
        self,
        *,
        severity: str = "all",
        status_filter: str = "all",
        alarm_type: str = "all",
        source_type: str = "all",
        source_id: Optional[int] = None,
        search: str = "",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[ZabbixAlarm], int, int]:
        filters = []
        if severity != "all":
            self._validate_severity(severity)
            filters.append(ZabbixAlarm.severity == severity)
        if status_filter != "all":
            self._validate_status(status_filter)
            filters.append(ZabbixAlarm.status == status_filter)
        if alarm_type != "all":
            self._validate_alarm_type(alarm_type)
            filters.append(ZabbixAlarm.alarm_type == alarm_type)
        if source_type != "all":
            self._validate_source_type(source_type)
            filters.append(ZabbixAlarm.source_type == source_type)
        if source_id is not None:
            filters.append(ZabbixAlarm.source_id == source_id)
        if search.strip():
            term = f"%{search.strip()}%"
            filters.append(
                or_(
                    ZabbixAlarm.source_name.ilike(term),
                    ZabbixAlarm.title.ilike(term),
                    ZabbixAlarm.description.ilike(term),
                    ZabbixAlarm.metric_name.ilike(term),
                ),
            )

        base_query = select(ZabbixAlarm)
        count_query = select(func.count()).select_from(ZabbixAlarm)
        if filters:
            base_query = base_query.where(*filters)
            count_query = count_query.where(*filters)

        total = int(await self.db.scalar(count_query) or 0)
        result = await self.db.execute(
            base_query.order_by(
                ZabbixAlarm.status.asc(),
                ZabbixAlarm.severity.desc(),
                ZabbixAlarm.last_seen_at.desc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size),
        )
        return list(result.scalars().all()), total, max(math.ceil(total / page_size), 1)

    async def get_alarm(self, alarm_id: int) -> ZabbixAlarm:
        result = await self.db.execute(select(ZabbixAlarm).where(ZabbixAlarm.id == alarm_id))
        alarm = result.scalar_one_or_none()
        if alarm is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zabbix alarm not found")
        return alarm

    async def get_summary(self) -> dict[str, Any]:
        status_rows = await self.db.execute(
            select(ZabbixAlarm.status, func.count()).group_by(ZabbixAlarm.status),
        )
        severity_rows = await self.db.execute(
            select(ZabbixAlarm.severity, func.count())
            .where(ZabbixAlarm.status != ZabbixAlarmStatus.RESOLVED.value)
            .group_by(ZabbixAlarm.severity),
        )
        type_rows = await self.db.execute(
            select(ZabbixAlarm.alarm_type, func.count())
            .where(ZabbixAlarm.status != ZabbixAlarmStatus.RESOLVED.value)
            .group_by(ZabbixAlarm.alarm_type),
        )
        source_rows = await self.db.execute(
            select(ZabbixAlarm.source_type, func.count())
            .where(ZabbixAlarm.status != ZabbixAlarmStatus.RESOLVED.value)
            .group_by(ZabbixAlarm.source_type),
        )

        by_status = {str(key): int(value) for key, value in status_rows.all()}
        by_severity = {str(key): int(value) for key, value in severity_rows.all()}
        by_type = {str(key): int(value) for key, value in type_rows.all()}
        by_source_type = {str(key): int(value) for key, value in source_rows.all()}
        total = int(await self.db.scalar(select(func.count()).select_from(ZabbixAlarm)) or 0)

        return {
            "active": by_status.get(ZabbixAlarmStatus.ACTIVE.value, 0),
            "critical": by_severity.get(ZabbixSeverity.CRITICAL.value, 0),
            "high": by_severity.get(ZabbixSeverity.HIGH.value, 0),
            "warning": by_severity.get(ZabbixSeverity.WARNING.value, 0),
            "resolved": by_status.get(ZabbixAlarmStatus.RESOLVED.value, 0),
            "acknowledged": by_status.get(ZabbixAlarmStatus.ACKNOWLEDGED.value, 0),
            "total": total,
            "by_type": by_type,
            "by_source_type": by_source_type,
        }

    async def acknowledge_alarm(
        self,
        alarm_id: int,
        user: User,
        request: Request | None = None,
    ) -> ZabbixAlarm:
        alarm = await self.get_alarm(alarm_id)
        if alarm.status == ZabbixAlarmStatus.RESOLVED.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Resolved alarm cannot be acknowledged")

        before = self._snapshot(alarm)
        now = datetime.utcnow()
        alarm.status = ZabbixAlarmStatus.ACKNOWLEDGED.value
        alarm.acknowledged_at = alarm.acknowledged_at or now
        alarm.acknowledged_by = user.id
        alarm.last_seen_at = now
        await self._record_audit(alarm, "ack", before, user, request)
        return alarm

    async def resolve_alarm(
        self,
        alarm_id: int,
        user: User,
        request: Request | None = None,
    ) -> ZabbixAlarm:
        alarm = await self.get_alarm(alarm_id)
        before = self._snapshot(alarm)
        now = datetime.utcnow()
        alarm.status = ZabbixAlarmStatus.RESOLVED.value
        alarm.resolved_at = alarm.resolved_at or now
        alarm.resolved_by = user.id
        alarm.last_seen_at = now
        await self._record_audit(alarm, "resolve", before, user, request)
        return alarm

    async def refresh_mock_alarms(
        self,
        user: User,
        request: Request | None = None,
    ) -> dict[str, int | str]:
        now = datetime.utcnow()
        active_result = await self.db.execute(
            select(ZabbixAlarm).where(ZabbixAlarm.status != ZabbixAlarmStatus.RESOLVED.value),
        )
        active_alarms = list(active_result.scalars().all())
        for alarm in active_alarms:
            alarm.last_seen_at = now

        existing_result = await self.db.execute(select(ZabbixAlarm))
        existing_keys = {
            self._alarm_key(alarm.alarm_type, alarm.source_type, alarm.source_name)
            for alarm in existing_result.scalars().all()
        }
        created = 0
        for payload in await build_demo_zabbix_alarm_payloads(self.db, now=now):
            key = self._alarm_key(payload["alarm_type"], payload["source_type"], payload["source_name"])
            if key in existing_keys:
                continue
            db_alarm = ZabbixAlarm(**payload)
            self.db.add(db_alarm)
            created += 1

        await self.db.flush()
        audit_log = AuditLog(
            user_id=user.id,
            entity_type="zabbix_alarm",
            entity_id=0,
            operation="zabbix_refresh",
            changes={
                "refreshed": len(active_alarms),
                "created": created,
                "mock": True,
            },
            ip_address=self._request_ip(request),
            user_agent=self._request_user_agent(request),
            reason="Zabbix mock refresh",
            requires_retention=True,
            created_at=now,
        )
        self.db.add(audit_log)
        await self.db.commit()
        critical_result = await self.db.execute(
            select(ZabbixAlarm).where(
                ZabbixAlarm.severity == ZabbixSeverity.CRITICAL.value,
                ZabbixAlarm.status == ZabbixAlarmStatus.ACTIVE.value,
            ),
        )
        telegram_service = TelegramAlertService(self.db)
        for alarm in critical_result.scalars().all():
            await telegram_service.send_critical_alarm(alarm.id, performed_by=user)
        return {"refreshed": len(active_alarms), "created": created, "result": "mock_success"}

    async def _record_audit(
        self,
        alarm: ZabbixAlarm,
        action: str,
        before: dict[str, Any],
        user: User,
        request: Request | None,
    ) -> None:
        after = self._snapshot(alarm)
        audit_log = AuditLog(
            user_id=user.id,
            entity_type="zabbix_alarm",
            entity_id=alarm.id,
            operation=f"zabbix_{action}",
            changes={
                "action": action,
                "before": before,
                "after": after,
                "mock": True,
            },
            ip_address=self._request_ip(request),
            user_agent=self._request_user_agent(request),
            reason="Zabbix mock alarm action",
            requires_retention=True,
            created_at=datetime.utcnow(),
        )
        self.db.add(audit_log)
        await self.db.flush()
        await self.db.commit()

    @staticmethod
    def _validate_alarm_type(value: str) -> None:
        try:
            ZabbixAlarmType(value)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid alarm type") from exc

    @staticmethod
    def _validate_severity(value: str) -> None:
        try:
            ZabbixSeverity(value)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid severity") from exc

    @staticmethod
    def _validate_status(value: str) -> None:
        try:
            ZabbixAlarmStatus(value)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid alarm status") from exc

    @staticmethod
    def _validate_source_type(value: str) -> None:
        try:
            ZabbixSourceType(value)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid source type") from exc

    @staticmethod
    def _snapshot(alarm: ZabbixAlarm) -> dict[str, Any]:
        return {
            "status": alarm.status,
            "severity": alarm.severity,
            "metric_value": float(alarm.metric_value) if alarm.metric_value is not None else None,
            "last_seen_at": alarm.last_seen_at.isoformat() if alarm.last_seen_at else None,
            "acknowledged_at": alarm.acknowledged_at.isoformat() if alarm.acknowledged_at else None,
            "resolved_at": alarm.resolved_at.isoformat() if alarm.resolved_at else None,
            "acknowledged_by": alarm.acknowledged_by,
            "resolved_by": alarm.resolved_by,
        }

    @staticmethod
    def _alarm_key(alarm_type: str, source_type: str, source_name: str) -> tuple[str, str, str]:
        return alarm_type, source_type, source_name

    @staticmethod
    def _request_ip(request: Request | None) -> str:
        return request.client.host if request and request.client else "127.0.0.1"

    @staticmethod
    def _request_user_agent(request: Request | None) -> str | None:
        return request.headers.get("user-agent") if request else None


async def build_demo_zabbix_alarm_payloads(
    db: AsyncSession,
    *,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    current_time = now or datetime.utcnow()
    olt_result = await db.execute(select(Olt).order_by(Olt.id.asc()).limit(5))
    olts = list(olt_result.scalars().all())
    ont_result = await db.execute(
        select(Ont)
        .where(Ont.rx_power <= Decimal("-25.00"))
        .order_by(Ont.rx_power.asc(), Ont.id.asc())
        .limit(1),
    )
    low_power_ont = ont_result.scalar_one_or_none()
    degraded_olt = next((item for item in olts if item.status in {"degraded", "offline"}), olts[0] if olts else None)

    return [
        {
            "alarm_type": ZabbixAlarmType.BGP_DOWN.value,
            "severity": ZabbixSeverity.WARNING.value,
            "status": ZabbixAlarmStatus.ACTIVE.value,
            "source_type": ZabbixSourceType.CORE_ROUTER.value,
            "source_name": "CR-01 edge bgp peer 10.255.255.1",
            "source_id": None,
            "title": "BGP peer state changed",
            "description": "Mock warning: upstream BGP peer is flapping.",
            "metric_name": "bgp.peer.state",
            "metric_value": Decimal("0"),
            "threshold": Decimal("1"),
            "first_seen_at": current_time - timedelta(minutes=34),
            "last_seen_at": current_time - timedelta(minutes=2),
        },
        {
            "alarm_type": ZabbixAlarmType.VRRP_FAILOVER.value,
            "severity": ZabbixSeverity.HIGH.value,
            "status": ZabbixAlarmStatus.ACTIVE.value,
            "source_type": ZabbixSourceType.AGGREGATION_SWITCH.value,
            "source_name": "AGG-SW-02 vrrp vlan 300",
            "source_id": None,
            "title": "VRRP failover on subscriber gateway",
            "description": "Mock high alarm: backup router became master for VLAN 300.",
            "metric_name": "vrrp.role",
            "metric_value": Decimal("2"),
            "threshold": Decimal("1"),
            "first_seen_at": current_time - timedelta(minutes=55),
            "last_seen_at": current_time - timedelta(minutes=3),
        },
        {
            "alarm_type": ZabbixAlarmType.ERPS_RING_FAULT.value,
            "severity": ZabbixSeverity.HIGH.value,
            "status": ZabbixAlarmStatus.ACTIVE.value,
            "source_type": ZabbixSourceType.AGGREGATION_SWITCH.value,
            "source_name": "ERPS-RING-ZHK-3",
            "source_id": None,
            "title": "ERPS ring fault",
            "description": "Mock high alarm: protection ring has open segment.",
            "metric_name": "erps.ring.state",
            "metric_value": Decimal("0"),
            "threshold": Decimal("1"),
            "first_seen_at": current_time - timedelta(minutes=21),
            "last_seen_at": current_time - timedelta(minutes=1),
        },
        {
            "alarm_type": ZabbixAlarmType.OLT_OFFLINE.value,
            "severity": ZabbixSeverity.CRITICAL.value,
            "status": ZabbixAlarmStatus.ACTIVE.value,
            "source_type": ZabbixSourceType.OLT.value,
            "source_name": degraded_olt.name if degraded_olt else "OLT-ZHK-5",
            "source_id": degraded_olt.id if degraded_olt else None,
            "title": "OLT unavailable or degraded",
            "description": "Mock critical alarm: Eltex LTP-16X did not respond to polling.",
            "metric_name": "icmpping",
            "metric_value": Decimal("0"),
            "threshold": Decimal("1"),
            "first_seen_at": current_time - timedelta(minutes=16),
            "last_seen_at": current_time - timedelta(minutes=1),
        },
        {
            "alarm_type": ZabbixAlarmType.LOW_OPTICAL_POWER.value,
            "severity": ZabbixSeverity.WARNING.value,
            "status": ZabbixAlarmStatus.ACTIVE.value,
            "source_type": ZabbixSourceType.ONT.value,
            "source_name": low_power_ont.serial_number if low_power_ont else "ELTX00000002",
            "source_id": low_power_ont.id if low_power_ont else None,
            "title": "ONT low optical power",
            "description": "Mock warning: ONT RX optical level is below acceptable threshold.",
            "metric_name": "ont.rx_power",
            "metric_value": Decimal(str(low_power_ont.rx_power)) if low_power_ont and low_power_ont.rx_power else Decimal("-26.80"),
            "threshold": Decimal("-25.00"),
            "first_seen_at": current_time - timedelta(hours=2),
            "last_seen_at": current_time - timedelta(minutes=4),
        },
        {
            "alarm_type": ZabbixAlarmType.UPS_LOW_BATTERY.value,
            "severity": ZabbixSeverity.WARNING.value,
            "status": ZabbixAlarmStatus.ACTIVE.value,
            "source_type": ZabbixSourceType.UPS.value,
            "source_name": "UPS-ZHK-2-node",
            "source_id": None,
            "title": "UPS low battery",
            "description": "Mock warning: battery capacity is below threshold.",
            "metric_name": "ups.battery.charge",
            "metric_value": Decimal("18"),
            "threshold": Decimal("20"),
            "first_seen_at": current_time - timedelta(minutes=44),
            "last_seen_at": current_time - timedelta(minutes=8),
        },
        {
            "alarm_type": ZabbixAlarmType.NAT_POOL_HIGH.value,
            "severity": ZabbixSeverity.HIGH.value,
            "status": ZabbixAlarmStatus.ACTIVE.value,
            "source_type": ZabbixSourceType.CORE_ROUTER.value,
            "source_name": "CGNAT-01 pool 10.64.0.0/16",
            "source_id": None,
            "title": "NAT pool utilization high",
            "description": "Mock high alarm: CGNAT address pool utilization is above threshold.",
            "metric_name": "nat.pool.used_pct",
            "metric_value": Decimal("91"),
            "threshold": Decimal("85"),
            "first_seen_at": current_time - timedelta(minutes=27),
            "last_seen_at": current_time - timedelta(minutes=2),
        },
        {
            "alarm_type": ZabbixAlarmType.DDOS_DETECTED.value,
            "severity": ZabbixSeverity.CRITICAL.value,
            "status": ZabbixAlarmStatus.ACTIVE.value,
            "source_type": ZabbixSourceType.EXTERNAL.value,
            "source_name": "DDoS guard upstream",
            "source_id": None,
            "title": "DDoS detected on external edge",
            "description": "Mock critical alarm: mitigation profile is active for edge prefix.",
            "metric_name": "ddos.pps",
            "metric_value": Decimal("1800000"),
            "threshold": Decimal("1000000"),
            "first_seen_at": current_time - timedelta(minutes=12),
            "last_seen_at": current_time - timedelta(minutes=1),
        },
    ]


def zabbix_alarm_payload(alarm: ZabbixAlarm) -> dict[str, Any]:
    return {
        "id": alarm.id,
        "alarm_type": alarm.alarm_type,
        "severity": alarm.severity,
        "status": alarm.status,
        "source_type": alarm.source_type,
        "source_name": alarm.source_name,
        "source_id": alarm.source_id,
        "title": alarm.title,
        "description": alarm.description,
        "metric_name": alarm.metric_name,
        "metric_value": float(alarm.metric_value) if alarm.metric_value is not None else None,
        "threshold": float(alarm.threshold) if alarm.threshold is not None else None,
        "first_seen_at": alarm.first_seen_at,
        "last_seen_at": alarm.last_seen_at,
        "acknowledged_at": alarm.acknowledged_at,
        "resolved_at": alarm.resolved_at,
        "acknowledged_by": alarm.acknowledged_by,
        "resolved_by": alarm.resolved_by,
    }
