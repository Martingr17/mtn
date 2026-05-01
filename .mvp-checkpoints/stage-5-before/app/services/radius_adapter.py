from __future__ import annotations

import math
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.requests import Request

from app.core.constants import RadiusAction, RadiusSessionStatus, UserRole
from app.models import AuditLog, RadiusActionLog, RadiusSession, User


class RadiusMockAdapter:
    """Stateful mock adapter for RADIUS/CoA commands.

    No network calls are made here. The adapter only updates mock session rows
    and writes the operational and audit logs required by the MVP.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_sessions(
        self,
        *,
        status_filter: str = "all",
        search: str = "",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[RadiusSession], int, int]:
        filters = []
        if status_filter != "all":
            self._validate_status(status_filter)
            filters.append(RadiusSession.status == status_filter)

        if search.strip():
            term = f"%{search.strip()}%"
            filters.append(
                or_(
                    RadiusSession.username.ilike(term),
                    cast(RadiusSession.framed_ip_address, String).ilike(term),
                    cast(RadiusSession.nas_ip_address, String).ilike(term),
                    RadiusSession.mac_address.ilike(term),
                    RadiusSession.session_id.ilike(term),
                    User.billing_id.ilike(term),
                    User.phone.ilike(term),
                    User.email.ilike(term),
                    User.first_name.ilike(term),
                    User.last_name.ilike(term),
                    User.middle_name.ilike(term),
                ),
            )

        base_query = select(RadiusSession).join(User, RadiusSession.subscriber_id == User.id)
        count_query = select(func.count()).select_from(RadiusSession).join(
            User,
            RadiusSession.subscriber_id == User.id,
        )
        if filters:
            base_query = base_query.where(*filters)
            count_query = count_query.where(*filters)

        total = int(await self.db.scalar(count_query) or 0)
        result = await self.db.execute(
            base_query.options(selectinload(RadiusSession.subscriber))
            .order_by(RadiusSession.updated_at.desc(), RadiusSession.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size),
        )
        return list(result.scalars().all()), total, max(math.ceil(total / page_size), 1)

    async def get_subscriber_session(self, subscriber_id: int) -> Optional[RadiusSession]:
        result = await self.db.execute(
            select(RadiusSession)
            .options(selectinload(RadiusSession.subscriber))
            .where(RadiusSession.subscriber_id == subscriber_id)
            .order_by(RadiusSession.updated_at.desc(), RadiusSession.id.desc())
            .limit(1),
        )
        return result.scalar_one_or_none()

    async def get_actions(
        self,
        *,
        action_filter: str = "all",
        search: str = "",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[RadiusActionLog], int, int]:
        filters = []
        if action_filter != "all":
            self._validate_action(action_filter)
            filters.append(RadiusActionLog.action == action_filter)

        if search.strip():
            term = f"%{search.strip()}%"
            filters.append(
                or_(
                    User.billing_id.ilike(term),
                    User.phone.ilike(term),
                    User.email.ilike(term),
                    User.first_name.ilike(term),
                    User.last_name.ilike(term),
                    User.middle_name.ilike(term),
                ),
            )

        base_query = select(RadiusActionLog).join(User, RadiusActionLog.subscriber_id == User.id)
        count_query = select(func.count()).select_from(RadiusActionLog).join(
            User,
            RadiusActionLog.subscriber_id == User.id,
        )
        if filters:
            base_query = base_query.where(*filters)
            count_query = count_query.where(*filters)

        total = int(await self.db.scalar(count_query) or 0)
        result = await self.db.execute(
            base_query.options(
                selectinload(RadiusActionLog.subscriber),
                selectinload(RadiusActionLog.performer),
            )
            .order_by(RadiusActionLog.created_at.desc(), RadiusActionLog.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size),
        )
        return list(result.scalars().all()), total, max(math.ceil(total / page_size), 1)

    async def block_subscriber(
        self,
        subscriber_id: int,
        *,
        performed_by: User,
        request: Request | None = None,
    ) -> tuple[RadiusSession, RadiusActionLog]:
        return await self._apply_action(
            subscriber_id,
            action=RadiusAction.BLOCK,
            new_status=RadiusSessionStatus.BLOCKED.value,
            performed_by=performed_by,
            request=request,
        )

    async def unblock_subscriber(
        self,
        subscriber_id: int,
        *,
        performed_by: User,
        request: Request | None = None,
    ) -> tuple[RadiusSession, RadiusActionLog]:
        return await self._apply_action(
            subscriber_id,
            action=RadiusAction.UNBLOCK,
            new_status=RadiusSessionStatus.ACTIVE.value,
            performed_by=performed_by,
            request=request,
        )

    async def disconnect_subscriber(
        self,
        subscriber_id: int,
        *,
        performed_by: User,
        request: Request | None = None,
    ) -> tuple[RadiusSession, RadiusActionLog]:
        return await self._apply_action(
            subscriber_id,
            action=RadiusAction.DISCONNECT,
            new_status=RadiusSessionStatus.DISCONNECTED.value,
            performed_by=performed_by,
            request=request,
        )

    async def change_speed(
        self,
        subscriber_id: int,
        speed_down: int,
        speed_up: int,
        *,
        performed_by: User,
        request: Request | None = None,
    ) -> tuple[RadiusSession, RadiusActionLog]:
        if speed_down <= 0 or speed_up <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Speed must be positive")

        session = await self._get_or_create_session(subscriber_id)
        return await self._record_change(
            session,
            action=RadiusAction.CHANGE_SPEED,
            performed_by=performed_by,
            request=request,
            new_status=session.status,
            new_speed_down=speed_down,
            new_speed_up=speed_up,
        )

    async def _apply_action(
        self,
        subscriber_id: int,
        *,
        action: RadiusAction,
        new_status: str,
        performed_by: User,
        request: Request | None,
    ) -> tuple[RadiusSession, RadiusActionLog]:
        session = await self._get_or_create_session(subscriber_id)
        return await self._record_change(
            session,
            action=action,
            performed_by=performed_by,
            request=request,
            new_status=new_status,
            new_speed_down=session.speed_down,
            new_speed_up=session.speed_up,
        )

    async def _record_change(
        self,
        session: RadiusSession,
        *,
        action: RadiusAction,
        performed_by: User,
        request: Request | None,
        new_status: str,
        new_speed_down: int,
        new_speed_up: int,
    ) -> tuple[RadiusSession, RadiusActionLog]:
        now = datetime.utcnow()
        old_status = session.status
        old_speed_down = session.speed_down
        old_speed_up = session.speed_up

        session.status = new_status
        session.speed_down = new_speed_down
        session.speed_up = new_speed_up
        session.updated_at = now

        action_log = RadiusActionLog(
            subscriber_id=session.subscriber_id,
            action=action.value,
            old_status=old_status,
            new_status=new_status,
            old_speed_down=old_speed_down,
            new_speed_down=new_speed_down,
            old_speed_up=old_speed_up,
            new_speed_up=new_speed_up,
            performed_by=performed_by.id,
            result="mock_success",
            created_at=now,
        )
        action_log.subscriber = getattr(session, "subscriber", None)
        action_log.performer = performed_by
        audit_log = AuditLog(
            user_id=performed_by.id,
            entity_type="radius_session",
            entity_id=session.id,
            operation=action.value,
            changes={
                "subscriber_id": session.subscriber_id,
                "old_status": old_status,
                "new_status": new_status,
                "old_speed_down": old_speed_down,
                "new_speed_down": new_speed_down,
                "old_speed_up": old_speed_up,
                "new_speed_up": new_speed_up,
                "mock": True,
            },
            ip_address=self._request_ip(request),
            user_agent=self._request_user_agent(request),
            reason="RADIUS/CoA mock action",
            requires_retention=True,
            created_at=now,
        )
        self.db.add(action_log)
        self.db.add(audit_log)
        await self.db.flush()
        await self.db.commit()
        return session, action_log

    async def _get_or_create_session(self, subscriber_id: int) -> RadiusSession:
        subscriber = await self._load_subscriber(subscriber_id)
        session = await self.get_subscriber_session(subscriber_id)
        if session is not None:
            return session

        now = datetime.utcnow()
        session = RadiusSession(
            subscriber_id=subscriber.id,
            subscriber=subscriber,
            username=subscriber.billing_id,
            framed_ip_address=self._mock_ip(subscriber.id),
            mac_address=self._mock_mac(subscriber.id),
            nas_ip_address="10.255.0.1",
            nas_port=f"mock-pon-{subscriber.id % 16 + 1}",
            session_id=f"mock-radius-{subscriber.id}",
            status=RadiusSessionStatus.ACTIVE.value,
            tariff_profile="MVP-DEFAULT",
            speed_down=100,
            speed_up=50,
            started_at=now,
            updated_at=now,
        )
        self.db.add(session)
        await self.db.flush()
        return session

    async def _load_subscriber(self, subscriber_id: int) -> User:
        result = await self.db.execute(
            select(User).where(User.id == subscriber_id, User.role == UserRole.USER),
        )
        subscriber = result.scalar_one_or_none()
        if subscriber is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subscriber not found")
        return subscriber

    @staticmethod
    def _validate_status(value: str) -> None:
        try:
            RadiusSessionStatus(value)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid RADIUS status") from exc

    @staticmethod
    def _validate_action(value: str) -> None:
        try:
            RadiusAction(value)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid RADIUS action") from exc

    @staticmethod
    def _request_ip(request: Request | None) -> str:
        return request.client.host if request and request.client else "127.0.0.1"

    @staticmethod
    def _request_user_agent(request: Request | None) -> str | None:
        return request.headers.get("user-agent") if request else None

    @staticmethod
    def _mock_ip(subscriber_id: int) -> str:
        return f"10.64.{subscriber_id % 250}.{subscriber_id % 200 + 20}"

    @staticmethod
    def _mock_mac(subscriber_id: int) -> str:
        value = f"{subscriber_id:012x}"[-12:]
        return ":".join(value[index : index + 2] for index in range(0, 12, 2))


def subscriber_brief_payload(user: User | None) -> dict[str, Any] | None:
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


def radius_session_payload(session: RadiusSession) -> dict[str, Any]:
    return {
        "id": session.id,
        "subscriber_id": session.subscriber_id,
        "username": session.username,
        "framed_ip_address": session.framed_ip_address,
        "mac_address": session.mac_address,
        "nas_ip_address": session.nas_ip_address,
        "nas_port": session.nas_port,
        "session_id": session.session_id,
        "status": session.status,
        "tariff_profile": session.tariff_profile,
        "speed_down": session.speed_down,
        "speed_up": session.speed_up,
        "started_at": session.started_at,
        "updated_at": session.updated_at,
        "subscriber": subscriber_brief_payload(getattr(session, "subscriber", None)),
    }


def radius_action_payload(action_log: RadiusActionLog) -> dict[str, Any]:
    performer = getattr(action_log, "performer", None)
    return {
        "id": action_log.id,
        "subscriber_id": action_log.subscriber_id,
        "action": action_log.action,
        "old_status": action_log.old_status,
        "new_status": action_log.new_status,
        "old_speed_down": action_log.old_speed_down,
        "new_speed_down": action_log.new_speed_down,
        "old_speed_up": action_log.old_speed_up,
        "new_speed_up": action_log.new_speed_up,
        "performed_by": action_log.performed_by,
        "performed_by_name": subscriber_brief_payload(performer)["full_name"] if performer else None,
        "result": action_log.result,
        "created_at": action_log.created_at,
        "subscriber": subscriber_brief_payload(getattr(action_log, "subscriber", None)),
    }
