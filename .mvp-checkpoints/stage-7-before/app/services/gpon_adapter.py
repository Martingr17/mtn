from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.requests import Request

from app.core.constants import GponOntAction, GponOntStatus
from app.models import AuditLog, Olt, Ont, User


class GponMockAdapter:
    """Mock GPON adapter shaped for a future Eltex LTP API implementation."""

    LOW_RX_POWER_THRESHOLD = -25.0

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_olts(self) -> list[Olt]:
        result = await self.db.execute(select(Olt).order_by(Olt.name.asc(), Olt.id.asc()))
        return list(result.scalars().all())

    async def get_olt(self, olt_id: int) -> Olt:
        result = await self.db.execute(select(Olt).where(Olt.id == olt_id))
        olt = result.scalar_one_or_none()
        if olt is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OLT not found")
        return olt

    async def get_onts(
        self,
        *,
        olt_id: Optional[int] = None,
        status_filter: str = "all",
        vlan_id: Optional[int] = None,
        pon_port: Optional[int] = None,
        rx_power_min: Optional[float] = None,
        rx_power_max: Optional[float] = None,
        search: str = "",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[Ont], int, int]:
        filters = []
        if olt_id is not None:
            filters.append(Ont.olt_id == olt_id)
        if status_filter != "all":
            self._validate_ont_status(status_filter)
            filters.append(Ont.status == status_filter)
        if vlan_id is not None:
            filters.append(Ont.vlan_id == vlan_id)
        if pon_port is not None:
            filters.append(Ont.pon_port == pon_port)
        if rx_power_min is not None:
            filters.append(Ont.rx_power >= rx_power_min)
        if rx_power_max is not None:
            filters.append(Ont.rx_power <= rx_power_max)

        if search.strip():
            term = f"%{search.strip()}%"
            filters.append(
                or_(
                    Ont.serial_number.ilike(term),
                    Ont.mac_address.ilike(term),
                    cast(Olt.management_ip, String).ilike(term),
                    Olt.name.ilike(term),
                    User.billing_id.ilike(term),
                    User.phone.ilike(term),
                    User.email.ilike(term),
                    User.first_name.ilike(term),
                    User.last_name.ilike(term),
                    User.middle_name.ilike(term),
                ),
            )

        base_query = select(Ont).join(Olt, Ont.olt_id == Olt.id).join(User, Ont.subscriber_id == User.id)
        count_query = select(func.count()).select_from(Ont).join(Olt, Ont.olt_id == Olt.id).join(
            User,
            Ont.subscriber_id == User.id,
        )
        if filters:
            base_query = base_query.where(*filters)
            count_query = count_query.where(*filters)

        total = int(await self.db.scalar(count_query) or 0)
        result = await self.db.execute(
            base_query.options(selectinload(Ont.subscriber), selectinload(Ont.olt))
            .order_by(Olt.name.asc(), Ont.pon_port.asc(), Ont.ont_id_on_port.asc())
            .offset((page - 1) * page_size)
            .limit(page_size),
        )
        return list(result.scalars().all()), total, max(math.ceil(total / page_size), 1)

    async def get_ont(self, ont_id: int) -> Ont:
        return await self._load_ont(ont_id)

    async def get_subscriber_ont(self, subscriber_id: int) -> Optional[Ont]:
        result = await self.db.execute(
            select(Ont)
            .options(selectinload(Ont.subscriber), selectinload(Ont.olt))
            .where(Ont.subscriber_id == subscriber_id)
            .order_by(Ont.updated_at.desc(), Ont.id.desc())
            .limit(1),
        )
        return result.scalar_one_or_none()

    async def reboot_ont(
        self,
        ont_id: int,
        *,
        performed_by: User,
        request: Request | None = None,
    ) -> Ont:
        ont = await self._load_ont(ont_id)
        now = datetime.utcnow()
        before = self._snapshot(ont)
        ont.status = GponOntStatus.ONLINE.value
        ont.last_seen_at = now
        ont.updated_at = now
        await self._record_audit(ont, GponOntAction.REBOOT, before, performed_by, request)
        return ont

    async def block_ont(
        self,
        ont_id: int,
        *,
        performed_by: User,
        request: Request | None = None,
    ) -> Ont:
        ont = await self._load_ont(ont_id)
        before = self._snapshot(ont)
        ont.status = GponOntStatus.BLOCKED.value
        ont.updated_at = datetime.utcnow()
        await self._record_audit(ont, GponOntAction.BLOCK, before, performed_by, request)
        return ont

    async def unblock_ont(
        self,
        ont_id: int,
        *,
        performed_by: User,
        request: Request | None = None,
    ) -> Ont:
        ont = await self._load_ont(ont_id)
        now = datetime.utcnow()
        before = self._snapshot(ont)
        ont.status = GponOntStatus.ONLINE.value
        ont.last_seen_at = now
        ont.updated_at = now
        await self._record_audit(ont, GponOntAction.UNBLOCK, before, performed_by, request)
        return ont

    async def mark_rogue_suspected(
        self,
        ont_id: int,
        *,
        performed_by: User,
        request: Request | None = None,
    ) -> Ont:
        ont = await self._load_ont(ont_id)
        before = self._snapshot(ont)
        ont.status = GponOntStatus.ROGUE_SUSPECTED.value
        ont.updated_at = datetime.utcnow()
        await self._record_audit(ont, GponOntAction.MARK_ROGUE_SUSPECTED, before, performed_by, request)
        return ont

    async def refresh_ont_status(
        self,
        ont_id: int,
        *,
        performed_by: User,
        request: Request | None = None,
    ) -> Ont:
        ont = await self._load_ont(ont_id)
        now = datetime.utcnow()
        before = self._snapshot(ont)
        ont.rx_power = self._bounded_power(float(ont.rx_power or -18.0) + self._mock_power_delta(ont.id))
        ont.tx_power = self._bounded_power(float(ont.tx_power or 2.4) + 0.05, minimum=-3.0, maximum=5.0)
        if ont.status == GponOntStatus.OFFLINE.value and float(ont.rx_power or -28.0) > -27.5:
            ont.status = GponOntStatus.ONLINE.value
        ont.last_seen_at = now
        ont.updated_at = now
        await self._record_audit(ont, GponOntAction.REFRESH_STATUS, before, performed_by, request)
        return ont

    async def _load_ont(self, ont_id: int) -> Ont:
        result = await self.db.execute(
            select(Ont)
            .options(selectinload(Ont.subscriber), selectinload(Ont.olt))
            .where(Ont.id == ont_id),
        )
        ont = result.scalar_one_or_none()
        if ont is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ONT not found")
        return ont

    async def _record_audit(
        self,
        ont: Ont,
        action: GponOntAction,
        before: dict[str, Any],
        performed_by: User,
        request: Request | None,
    ) -> None:
        after = self._snapshot(ont)
        audit_log = AuditLog(
            user_id=performed_by.id,
            entity_type="ont",
            entity_id=ont.id,
            operation=f"gpon_{action.value}",
            changes={
                "action": action.value,
                "subscriber_id": ont.subscriber_id,
                "olt_id": ont.olt_id,
                "before": before,
                "after": after,
                "mock": True,
            },
            ip_address=self._request_ip(request),
            user_agent=self._request_user_agent(request),
            reason="GPON/ONT mock action",
            requires_retention=True,
            created_at=datetime.utcnow(),
        )
        self.db.add(audit_log)
        await self.db.flush()
        await self.db.commit()

    @staticmethod
    def _validate_ont_status(value: str) -> None:
        try:
            GponOntStatus(value)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid ONT status") from exc

    @staticmethod
    def _snapshot(ont: Ont) -> dict[str, Any]:
        return {
            "status": ont.status,
            "rx_power": float(ont.rx_power) if ont.rx_power is not None else None,
            "tx_power": float(ont.tx_power) if ont.tx_power is not None else None,
            "last_seen_at": ont.last_seen_at.isoformat() if ont.last_seen_at else None,
        }

    @staticmethod
    def _bounded_power(value: float, *, minimum: float = -28.0, maximum: float = -3.0) -> float:
        return round(max(minimum, min(maximum, value)), 2)

    @staticmethod
    def _mock_power_delta(ont_id: int) -> float:
        return ((ont_id % 5) - 2) * 0.15

    @staticmethod
    def _request_ip(request: Request | None) -> str:
        return request.client.host if request and request.client else "127.0.0.1"

    @staticmethod
    def _request_user_agent(request: Request | None) -> str | None:
        return request.headers.get("user-agent") if request else None


def gpon_subscriber_payload(user: User | None) -> dict[str, Any] | None:
    if user is None:
        return None
    return {
        "id": user.id,
        "billing_id": user.billing_id,
        "full_name": getattr(user, "full_name", None)
        or " ".join(part for part in [user.last_name, user.first_name, user.middle_name] if part)
        or user.phone,
        "phone": user.phone,
        "email": user.email,
    }


def olt_payload(olt: Olt | None) -> dict[str, Any] | None:
    if olt is None:
        return None
    return {
        "id": olt.id,
        "name": olt.name,
        "vendor": olt.vendor,
        "model": olt.model,
        "management_ip": olt.management_ip,
        "location": olt.location,
        "status": olt.status,
        "pon_ports_total": olt.pon_ports_total,
        "pon_ports_used": olt.pon_ports_used,
        "uplink_status": olt.uplink_status,
        "created_at": olt.created_at,
        "updated_at": olt.updated_at,
    }


def ont_payload(ont: Ont) -> dict[str, Any]:
    return {
        "id": ont.id,
        "subscriber_id": ont.subscriber_id,
        "olt_id": ont.olt_id,
        "serial_number": ont.serial_number,
        "mac_address": ont.mac_address,
        "pon_port": ont.pon_port,
        "ont_id_on_port": ont.ont_id_on_port,
        "vlan_id": ont.vlan_id,
        "status": ont.status,
        "rx_power": float(ont.rx_power) if ont.rx_power is not None else None,
        "tx_power": float(ont.tx_power) if ont.tx_power is not None else None,
        "last_seen_at": ont.last_seen_at,
        "created_at": ont.created_at,
        "updated_at": ont.updated_at,
        "subscriber": gpon_subscriber_payload(getattr(ont, "subscriber", None)),
        "olt": olt_payload(getattr(ont, "olt", None)),
    }
