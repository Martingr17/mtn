from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import select

from app.config import settings
from app.core.constants import UserRole
from app.database import AsyncSessionLocal
from app.models import Ticket, User
from app.services.email import send_email
from app.services.sms import send_sms_notification
from app.services.websocket_manager import websocket_manager

logger = logging.getLogger(__name__)

STAFF_ROLE_VALUES = {
    UserRole.OPERATOR.value,
    UserRole.ADMIN.value,
    UserRole.SUPER_ADMIN.value,
}


def _role_value(role: object) -> str:
    return role.value if hasattr(role, "value") else str(role or "")


def _priority_value(priority: object) -> str:
    return priority.value if hasattr(priority, "value") else str(priority or "")


def _app_url(path: str) -> str:
    return f"{settings.public_app_url.rstrip('/')}{path}"


async def _get_ticket_and_user(ticket_id: int, user_id: int | None = None) -> tuple[Ticket | None, User | None]:
    async with AsyncSessionLocal() as db:
        ticket_result = await db.execute(select(Ticket).where(Ticket.id == ticket_id))
        ticket = ticket_result.scalar_one_or_none()

        user = None
        if user_id is not None:
            user_result = await db.execute(select(User).where(User.id == user_id))
            user = user_result.scalar_one_or_none()
        elif ticket:
            user_result = await db.execute(select(User).where(User.id == ticket.user_id))
            user = user_result.scalar_one_or_none()

        return ticket, user


async def _get_staff_users() -> list[User]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User).where(User.role.in_([UserRole.OPERATOR, UserRole.ADMIN, UserRole.SUPER_ADMIN]))
        )
        return list(result.scalars().all())


async def notify_operators_new_ticket(ticket_id: int, user_id: int) -> None:
    """Notify operators about a newly created ticket."""
    try:
        ticket, user = await _get_ticket_and_user(ticket_id, user_id)
        if not ticket or not user:
            return

        payload = {
            "type": "new_ticket",
            "ticket_id": ticket_id,
            "subject": ticket.subject,
            "user_phone": user.phone,
            "priority": _priority_value(ticket.priority),
            "timestamp": datetime.utcnow().isoformat(),
        }
        await websocket_manager.broadcast(payload, roles=list(STAFF_ROLE_VALUES))

        operators = await _get_staff_users()
        ticket_url = _app_url(f"/admin/tickets/{ticket_id}")
        for operator in operators:
            if operator.email:
                await send_email(
                    operator.email,
                    f"Новая заявка #{ticket_id}",
                    (
                        f"Поступила новая заявка от абонента {user.phone}.\n"
                        f"Тема: {ticket.subject}\n"
                        f"Приоритет: {_priority_value(ticket.priority)}\n"
                        f"Открыть карточку: {ticket_url}"
                    ),
                )

        logger.info("Notified operators about new ticket %s", ticket_id)
    except Exception as exc:
        logger.error("Failed to notify operators about new ticket %s: %s", ticket_id, exc)


async def notify_user_new_message(user_id: int, ticket_id: int, preview: str) -> None:
    """Notify user about a new operator reply."""
    try:
        async with AsyncSessionLocal() as db:
            user_result = await db.execute(select(User).where(User.id == user_id))
            user = user_result.scalar_one_or_none()

        if not user:
            return

        await websocket_manager.notify_ticket_update(
            user_id,
            ticket_id,
            "new_message",
            {"preview": preview, "timestamp": datetime.utcnow().isoformat()},
        )

        ticket_url = _app_url(f"/tickets/{ticket_id}")
        if user.email:
            await send_email(
                user.email,
                f"Новый ответ по заявке #{ticket_id}",
                (
                    f"По вашей заявке появился новый ответ оператора.\n\n"
                    f"{preview}\n\n"
                    f"Открыть переписку: {ticket_url}"
                ),
            )

        if user.phone:
            await send_sms_notification(user.phone, f"Заявка #{ticket_id}: поступил новый ответ оператора.")

        logger.info("Notified user %s about new message in ticket %s", user_id, ticket_id)
    except Exception as exc:
        logger.error("Failed to notify user %s about ticket %s: %s", user_id, ticket_id, exc)


async def notify_operators_new_message(ticket_id: int, user_id: int, preview: str) -> None:
    """Notify operators about a new user reply."""
    try:
        ticket, user = await _get_ticket_and_user(ticket_id, user_id)
        if not ticket:
            return

        message = {
            "type": "ticket_update",
            "ticket_id": ticket_id,
            "action": "user_replied",
            "preview": preview,
            "user_id": user_id,
            "timestamp": datetime.utcnow().isoformat(),
        }

        if ticket.assigned_to:
            await websocket_manager.send_personal_message(ticket.assigned_to, message)
        else:
            await websocket_manager.broadcast(message, roles=list(STAFF_ROLE_VALUES))

        logger.info("Notified operators about reply in ticket %s", ticket_id)
    except Exception as exc:
        logger.error("Failed to notify operators about message in ticket %s: %s", ticket_id, exc)


async def notify_ticket_escalated(ticket_id: int, previous_priority: str, new_priority: str) -> None:
    """Notify operators when a ticket breaches SLA and is escalated."""
    try:
        ticket, user = await _get_ticket_and_user(ticket_id)
        if not ticket:
            return

        payload = {
            "type": "ticket_escalated",
            "ticket_id": ticket_id,
            "subject": ticket.subject,
            "previous_priority": previous_priority,
            "new_priority": new_priority,
            "timestamp": datetime.utcnow().isoformat(),
        }
        await websocket_manager.broadcast(payload, roles=list(STAFF_ROLE_VALUES))

        operators = await _get_staff_users()
        ticket_url = _app_url(f"/admin/tickets/{ticket_id}")
        for operator in operators:
            if operator.email:
                await send_email(
                    operator.email,
                    f"Эскалация заявки #{ticket_id}",
                    (
                        f"Заявка нарушила SLA и была повышена по приоритету.\n"
                        f"Тема: {ticket.subject}\n"
                        f"Абонент: {user.phone if user else ticket.user_id}\n"
                        f"Приоритет: {previous_priority} -> {new_priority}\n"
                        f"Открыть карточку: {ticket_url}"
                    ),
                )

        logger.info("Escalation notification sent for ticket %s", ticket_id)
    except Exception as exc:
        logger.error("Failed to notify escalation for ticket %s: %s", ticket_id, exc)
