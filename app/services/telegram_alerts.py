from __future__ import annotations

import math
from datetime import datetime
from typing import Any

import httpx
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.constants import NocIncidentStatus, ZabbixAlarmStatus
from app.models import AuditLog, NocIncident, TelegramAlertLog, User, ZabbixAlarm


class TelegramAlertService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_logs(
        self,
        *,
        entity_type: str = "all",
        status_filter: str = "all",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[TelegramAlertLog], int, int]:
        filters = []
        if entity_type != "all":
            filters.append(TelegramAlertLog.entity_type == entity_type)
        if status_filter != "all":
            filters.append(TelegramAlertLog.status == status_filter)

        base_query = select(TelegramAlertLog)
        count_query = select(func.count()).select_from(TelegramAlertLog)
        if filters:
            base_query = base_query.where(*filters)
            count_query = count_query.where(*filters)

        total = int(await self.db.scalar(count_query) or 0)
        result = await self.db.execute(
            base_query.order_by(TelegramAlertLog.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size),
        )
        return list(result.scalars().all()), total, max(math.ceil(total / page_size), 1)

    async def send_critical_alarm(
        self,
        alarm_id: int,
        *,
        performed_by: User | None = None,
    ) -> TelegramAlertLog:
        alarm = await self._get_alarm(alarm_id)
        message = self._alarm_message(alarm)
        return await self._send_entity_alert(
            entity_type="zabbix_alarm",
            entity_id=alarm.id,
            severity=alarm.severity,
            title=alarm.title,
            message=message,
            eligible=self.should_send(alarm),
            skip_reason="Only critical active Zabbix alarms are sent to Telegram",
            performed_by=performed_by,
        )

    async def send_critical_incident(
        self,
        incident_id: int,
        *,
        performed_by: User | None = None,
    ) -> TelegramAlertLog:
        incident = await self._get_incident(incident_id)
        message = self._incident_message(incident)
        return await self._send_entity_alert(
            entity_type="noc_incident",
            entity_id=incident.id,
            severity=incident.severity,
            title=incident.title,
            message=message,
            eligible=self.should_send(incident),
            skip_reason="Only critical new/in_progress NOC incidents are sent to Telegram",
            performed_by=performed_by,
        )

    async def send_message(self, message: str, chat_id: str) -> tuple[str, str | None]:
        if settings.telegram_mock_mode:
            return "sent", None

        if not settings.telegram_bot_token:
            return "failed", "TELEGRAM_BOT_TOKEN is not configured"

        url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    url,
                    json={"chat_id": chat_id, "text": message, "parse_mode": "HTML"},
                )
                response.raise_for_status()
        except httpx.HTTPError as exc:
            return "failed", str(exc)
        return "sent", None

    def should_send(self, entity: ZabbixAlarm | NocIncident) -> bool:
        if isinstance(entity, ZabbixAlarm):
            return entity.severity == "critical" and entity.status == ZabbixAlarmStatus.ACTIVE.value
        return entity.severity == "critical" and entity.status in {
            NocIncidentStatus.NEW.value,
            NocIncidentStatus.IN_PROGRESS.value,
        }

    async def _send_entity_alert(
        self,
        *,
        entity_type: str,
        entity_id: int,
        severity: str,
        title: str,
        message: str,
        eligible: bool,
        skip_reason: str,
        performed_by: User | None,
    ) -> TelegramAlertLog:
        duplicate = await self._has_sent(entity_type, entity_id)
        chat_id = settings.telegram_noc_chat_id or "mock-noc-chat"
        now = datetime.utcnow()

        if duplicate:
            return await self._record_log(
                entity_type=entity_type,
                entity_id=entity_id,
                severity=severity,
                title=title,
                message=message,
                chat_id=chat_id,
                status_value="skipped",
                error="Telegram alert already sent for this entity",
                sent_at=None,
                performed_by=performed_by,
            )

        if not eligible:
            return await self._record_log(
                entity_type=entity_type,
                entity_id=entity_id,
                severity=severity,
                title=title,
                message=message,
                chat_id=chat_id,
                status_value="skipped",
                error=skip_reason,
                sent_at=None,
                performed_by=performed_by,
            )

        if not settings.telegram_alerts_enabled:
            return await self._record_log(
                entity_type=entity_type,
                entity_id=entity_id,
                severity=severity,
                title=title,
                message=message,
                chat_id=chat_id,
                status_value="skipped",
                error="Telegram alerts are disabled",
                sent_at=None,
                performed_by=performed_by,
            )

        if not settings.telegram_noc_chat_id:
            return await self._record_log(
                entity_type=entity_type,
                entity_id=entity_id,
                severity=severity,
                title=title,
                message=message,
                chat_id=chat_id,
                status_value="failed",
                error="TELEGRAM_NOC_CHAT_ID is not configured",
                sent_at=None,
                performed_by=performed_by,
            )

        status_value, error = await self.send_message(message, settings.telegram_noc_chat_id)
        return await self._record_log(
            entity_type=entity_type,
            entity_id=entity_id,
            severity=severity,
            title=title,
            message=message,
            chat_id=settings.telegram_noc_chat_id,
            status_value=status_value,
            error=error,
            sent_at=now if status_value == "sent" else None,
            performed_by=performed_by,
        )

    async def _record_log(
        self,
        *,
        entity_type: str,
        entity_id: int,
        severity: str,
        title: str,
        message: str,
        chat_id: str,
        status_value: str,
        error: str | None,
        sent_at: datetime | None,
        performed_by: User | None,
    ) -> TelegramAlertLog:
        now = datetime.utcnow()
        log = TelegramAlertLog(
            entity_type=entity_type,
            entity_id=entity_id,
            severity=severity,
            title=title,
            message=message,
            chat_id=chat_id,
            status=status_value,
            error=error,
            sent_at=sent_at,
            created_at=now,
        )
        self.db.add(log)
        await self.db.flush()

        audit_log = AuditLog(
            user_id=getattr(performed_by, "id", None),
            entity_type="telegram_alert",
            entity_id=log.id,
            operation=f"telegram_{status_value}",
            changes={
                "entity_type": entity_type,
                "entity_id": entity_id,
                "severity": severity,
                "title": title,
                "status": status_value,
                "error": error,
                "mock": settings.telegram_mock_mode,
            },
            ip_address="127.0.0.1",
            user_agent=None,
            reason="Telegram critical alert delivery fact",
            requires_retention=True,
            created_at=now,
        )
        self.db.add(audit_log)
        await self.db.commit()
        return log

    async def _has_sent(self, entity_type: str, entity_id: int) -> bool:
        result = await self.db.execute(
            select(TelegramAlertLog.id)
            .where(
                TelegramAlertLog.entity_type == entity_type,
                TelegramAlertLog.entity_id == entity_id,
                TelegramAlertLog.status == "sent",
            )
            .limit(1),
        )
        return result.scalar_one_or_none() is not None

    async def _get_alarm(self, alarm_id: int) -> ZabbixAlarm:
        result = await self.db.execute(select(ZabbixAlarm).where(ZabbixAlarm.id == alarm_id))
        alarm = result.scalar_one_or_none()
        if alarm is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zabbix alarm not found")
        return alarm

    async def _get_incident(self, incident_id: int) -> NocIncident:
        result = await self.db.execute(select(NocIncident).where(NocIncident.id == incident_id))
        incident = result.scalar_one_or_none()
        if incident is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="NOC incident not found")
        return incident

    @staticmethod
    def _alarm_message(alarm: ZabbixAlarm) -> str:
        return (
            f"CRITICAL Zabbix alarm\n"
            f"{alarm.title}\n"
            f"Source: {alarm.source_name}\n"
            f"Metric: {alarm.metric_name or 'n/a'}={alarm.metric_value if alarm.metric_value is not None else 'n/a'}"
        )

    @staticmethod
    def _incident_message(incident: NocIncident) -> str:
        return (
            f"CRITICAL NOC incident #{incident.id}\n"
            f"{incident.title}\n"
            f"Service: {incident.affected_service}\n"
            f"Status: {incident.status}\n"
            f"Affected subscribers: {incident.affected_subscribers_count}"
        )


def telegram_alert_payload(log: TelegramAlertLog) -> dict[str, Any]:
    return {
        "id": log.id,
        "entity_type": log.entity_type,
        "entity_id": log.entity_id,
        "severity": log.severity,
        "title": log.title,
        "message": log.message,
        "chat_id": log.chat_id,
        "status": log.status,
        "error": log.error,
        "sent_at": log.sent_at,
        "created_at": log.created_at,
    }
