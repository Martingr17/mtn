from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import Select, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import TicketPriority, TicketStatus, UserRole
from app.core.logger import log_activity
from app.database import get_db
from app.dependencies import get_current_admin, get_current_user
from app.models import Message, Ticket, User
from app.schemas.ticket import (
    MessageResponse,
    TicketDetailResponse,
    TicketListResponse,
    TicketRateRequest,
    TicketResolveRequest,
    TicketResponse,
)
from app.services.email import send_email
from app.services.ticket_notify import (
    notify_operators_new_message,
    notify_operators_new_ticket,
    notify_user_new_message,
)
from app.services.websocket_manager import websocket_manager
from app.utils.file_upload import save_attachment, validate_file

router = APIRouter(prefix="/tickets", tags=["tickets"])

STAFF_ROLE_VALUES = {
    UserRole.OPERATOR.value,
    UserRole.ADMIN.value,
    UserRole.SUPER_ADMIN.value,
}
OPEN_TICKET_STATUSES = {
    TicketStatus.NEW,
    TicketStatus.IN_PROGRESS,
    TicketStatus.WAITING_CUSTOMER,
    TicketStatus.ESCALATED,
}
SORTABLE_FIELDS = {
    "created_at": Ticket.created_at,
    "updated_at": Ticket.updated_at,
    "last_activity_at": Ticket.last_activity_at,
    "priority": Ticket.priority,
    "status": Ticket.status,
}


def _enum_value(value: object) -> str:
    return value.value if hasattr(value, "value") else str(value or "")


def _is_staff(user: User) -> bool:
    return _enum_value(getattr(user, "role", None)) in STAFF_ROLE_VALUES


def _normalize_status_filter(status_filter: Optional[str]):
    if not status_filter:
        return None

    normalized = status_filter.strip().lower()
    if not normalized:
        return None

    if normalized == "open":
        return Ticket.status.in_(list(OPEN_TICKET_STATUSES))
    if normalized == "closed":
        return Ticket.status == TicketStatus.CLOSED
    if normalized == "resolved":
        return Ticket.status == TicketStatus.RESOLVED

    for status in TicketStatus:
        if normalized == status.value:
            return Ticket.status == status

    raise HTTPException(status_code=400, detail="Неизвестный фильтр статуса")


def _resolve_sort_column(sort_by: str):
    return SORTABLE_FIELDS.get(sort_by, Ticket.created_at)


def _serialize_message(message: Message) -> dict:
    author = getattr(message, "user", None)
    return {
        "id": message.id,
        "user_id": message.user_id,
        "body": message.body,
        "is_internal": bool(message.is_internal),
        "attachment_path": message.attachment_path,
        "attachment_name": message.attachment_name,
        "attachment_size": message.attachment_size,
        "attachment_mime": message.attachment_mime,
        "created_at": message.created_at,
        "user_display_name": getattr(author, "display_name", None) or getattr(author, "full_name", None),
    }


def _serialize_ticket(ticket: Ticket) -> dict:
    assignee = getattr(ticket, "assignee", None)
    user = getattr(ticket, "user", None)
    return {
        "id": ticket.id,
        "subject": ticket.subject,
        "status": ticket.status,
        "priority": ticket.priority,
        "category": ticket.category,
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
        "last_activity_at": ticket.last_activity_at,
        "closed_at": ticket.closed_at,
        "resolved_at": ticket.resolved_at,
        "sla_deadline": ticket.sla_deadline,
        "escalated_at": ticket.escalated_at,
        "user_id": ticket.user_id,
        "assigned_to": ticket.assigned_to,
        "assignee_name": getattr(assignee, "display_name", None) or getattr(assignee, "full_name", None),
        "user_display_name": getattr(user, "display_name", None) or getattr(user, "full_name", None),
        "is_overdue": bool(ticket.is_overdue),
    }


def _serialize_ticket_detail(ticket: Ticket, messages: list[Message]) -> dict:
    payload = _serialize_ticket(ticket)
    payload.update(
        {
            "messages": [_serialize_message(message) for message in messages],
            "resolution_summary": ticket.resolution_summary,
            "satisfaction_rating": ticket.satisfaction_rating,
            "first_response_at": ticket.first_response_at,
            "response_time_seconds": ticket.response_time_seconds,
            "resolution_time_seconds": ticket.resolution_time_seconds,
        }
    )
    return payload


@router.post("/", response_model=TicketResponse)
async def create_ticket(
    request: Request,
    background_tasks: BackgroundTasks,
    subject: str = Form(...),
    body: str = Form(...),
    priority: TicketPriority = Form(TicketPriority.MEDIUM),
    category: Optional[str] = Form(None),
    attachment: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new support ticket."""

    clean_subject = (subject or "").strip()
    clean_body = (body or "").strip()
    if len(clean_subject) < 3 or len(clean_subject) > 255:
        raise HTTPException(status_code=400, detail="Тема должна содержать от 3 до 255 символов")
    if len(clean_body) < 1 or len(clean_body) > 10000:
        raise HTTPException(status_code=400, detail="Описание должно содержать от 1 до 10 000 символов")

    attachment_path = None
    attachment_name = None
    attachment_size = None
    attachment_mime = None

    if attachment:
        if not validate_file(attachment):
            raise HTTPException(status_code=400, detail="Недопустимый тип файла или превышен размер")

        valid, error = validate_file(attachment)
        if not valid:
            raise HTTPException(status_code=400, detail=error or "Недопустимый тип файла или превышен размер")

        uploaded = await save_attachment(attachment, current_user.id)
        attachment_path = uploaded["path"]
        attachment_name = uploaded["filename"]
        attachment_size = uploaded["size"]
        attachment_mime = uploaded["mime_type"]

    now = datetime.utcnow()
    ticket = Ticket(
        user_id=current_user.id,
        subject=clean_subject,
        category=category,
        priority=priority,
        status=TicketStatus.NEW,
        sla_deadline=now,
        created_at=now,
        updated_at=now,
        last_activity_at=now,
    )
    ticket.sla_deadline = now + timedelta(hours=TicketPriority.get_sla_hours(priority))
    db.add(ticket)
    await db.flush()

    message = Message(
        ticket_id=ticket.id,
        user_id=current_user.id,
        body=clean_body,
        is_internal=False,
        attachment_path=attachment_path,
        attachment_name=attachment_name,
        attachment_size=attachment_size,
        attachment_mime=attachment_mime,
        created_at=now,
    )
    db.add(message)
    await db.commit()

    result = await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.user), selectinload(Ticket.assignee))
        .where(Ticket.id == ticket.id)
    )
    created_ticket = result.scalar_one()

    background_tasks.add_task(notify_operators_new_ticket, created_ticket.id, current_user.id)
    await log_activity(
        db,
        current_user.id,
        "ticket_create",
        request.client.host,
        request.headers.get("user-agent", ""),
        extra={"ticket_id": created_ticket.id, "priority": _enum_value(priority)},
    )

    return TicketResponse.model_validate(_serialize_ticket(created_ticket))


@router.get("/", response_model=TicketListResponse)
async def list_tickets(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    status_filter: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    sort_by: str = "created_at",
    sort_order: str = "desc",
):
    """Return paginated list of current user's tickets."""

    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    offset = (page - 1) * page_size

    status_clause = _normalize_status_filter(status_filter)
    sort_column = _resolve_sort_column(sort_by)

    query: Select = (
        select(Ticket)
        .options(selectinload(Ticket.user), selectinload(Ticket.assignee))
        .where(Ticket.user_id == current_user.id)
    )
    count_query: Select = select(func.count()).select_from(Ticket).where(Ticket.user_id == current_user.id)

    if status_clause is not None:
        query = query.where(status_clause)
        count_query = count_query.where(status_clause)

    if sort_order.lower() == "asc":
        query = query.order_by(sort_column)
    else:
        query = query.order_by(desc(sort_column))

    total = (await db.execute(count_query)).scalar() or 0
    tickets = (await db.execute(query.offset(offset).limit(page_size))).scalars().all()

    return TicketListResponse(
        total=total,
        items=[TicketResponse.model_validate(_serialize_ticket(ticket)) for ticket in tickets],
        page=page,
        page_size=page_size,
        total_pages=max(1, (total + page_size - 1) // page_size) if total else 1,
    )


@router.get("/{ticket_id}", response_model=TicketDetailResponse)
async def get_ticket(
    ticket_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return ticket details with full conversation."""

    result = await db.execute(
        select(Ticket)
        .options(
            selectinload(Ticket.user),
            selectinload(Ticket.assignee),
            selectinload(Ticket.messages).selectinload(Message.user),
        )
        .where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Заявка не найдена")

    if ticket.user_id != current_user.id and not _is_staff(current_user):
        raise HTTPException(status_code=403, detail="Доступ запрещён")

    messages = list(ticket.messages or [])
    if not _is_staff(current_user):
        messages = [message for message in messages if not message.is_internal]

    await log_activity(
        db,
        current_user.id,
        "ticket_view",
        request.client.host if getattr(request, "client", None) else "unknown",
        request.headers.get("user-agent", ""),
        extra={"ticket_id": ticket_id},
    )

    return TicketDetailResponse.model_validate(_serialize_ticket_detail(ticket, messages))


@router.post("/{ticket_id}/reply", response_model=MessageResponse)
async def reply_ticket(
    ticket_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    body: str = Form(...),
    is_internal: bool = Form(False),
    attachment: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a message to an existing ticket."""

    result = await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.user), selectinload(Ticket.assignee))
        .where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Заявка не найдена")

    is_staff = _is_staff(current_user)
    if ticket.user_id != current_user.id and not is_staff:
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    if ticket.status == TicketStatus.CLOSED:
        raise HTTPException(status_code=400, detail="Нельзя отвечать в закрытой заявке")
    if is_internal and not is_staff:
        raise HTTPException(status_code=403, detail="Внутренние комментарии доступны только сотрудникам")

    clean_body = (body or "").strip()
    if len(clean_body) < 1 or len(clean_body) > 10000:
        raise HTTPException(status_code=400, detail="Сообщение должно содержать от 1 до 10 000 символов")

    attachment_path = None
    attachment_name = None
    attachment_size = None
    attachment_mime = None

    if attachment:
        if not validate_file(attachment):
            raise HTTPException(status_code=400, detail="Недопустимый тип файла или превышен размер")

        valid, error = validate_file(attachment)
        if not valid:
            raise HTTPException(status_code=400, detail=error or "Недопустимый тип файла или превышен размер")

        uploaded = await save_attachment(attachment, current_user.id, ticket_id)
        attachment_path = uploaded["path"]
        attachment_name = uploaded["filename"]
        attachment_size = uploaded["size"]
        attachment_mime = uploaded["mime_type"]

    now = datetime.utcnow()
    message = Message(
        ticket_id=ticket_id,
        user_id=current_user.id,
        body=clean_body,
        is_internal=bool(is_internal and is_staff),
        attachment_path=attachment_path,
        attachment_name=attachment_name,
        attachment_size=attachment_size,
        attachment_mime=attachment_mime,
        created_at=now,
    )
    db.add(message)

    if is_staff:
        if ticket.status in {TicketStatus.NEW, TicketStatus.WAITING_CUSTOMER, TicketStatus.ESCALATED, TicketStatus.RESOLVED}:
            ticket.status = TicketStatus.IN_PROGRESS
        if ticket.first_response_at is None:
            ticket.first_response_at = now
    else:
        if ticket.status == TicketStatus.RESOLVED:
            ticket.resolved_at = None
        ticket.status = TicketStatus.IN_PROGRESS

    ticket.updated_at = now
    ticket.last_activity_at = now

    await db.commit()
    await db.refresh(message)
    await db.refresh(ticket)

    preview = clean_body[:100]
    if is_staff:
        background_tasks.add_task(notify_user_new_message, ticket.user_id, ticket_id, preview)
        await websocket_manager.notify_ticket_update(ticket.user_id, ticket_id, "staff_reply", {"message_preview": preview})
    else:
        background_tasks.add_task(notify_operators_new_message, ticket_id, current_user.id, preview)
        await websocket_manager.broadcast(
            {
                "type": "new_ticket_reply",
                "ticket_id": ticket_id,
                "user_id": current_user.id,
                "preview": preview,
            },
            roles=list(STAFF_ROLE_VALUES),
        )

    await log_activity(
        db,
        current_user.id,
        "ticket_reply",
        request.client.host,
        request.headers.get("user-agent", ""),
        extra={"ticket_id": ticket_id, "is_internal": bool(is_internal and is_staff)},
    )

    return MessageResponse.model_validate(
        {
            **_serialize_message(message),
            "user_display_name": current_user.display_name,
        }
    )


@router.post("/{ticket_id}/resolve")
async def resolve_ticket(
    ticket_id: int,
    request: Request,
    resolve_data: TicketResolveRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """Mark a ticket as resolved."""

    result = await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.user))
        .where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if ticket.status == TicketStatus.CLOSED:
        raise HTTPException(status_code=400, detail="Заявка уже закрыта")

    now = datetime.utcnow()
    ticket.status = TicketStatus.RESOLVED
    ticket.resolved_at = now
    ticket.updated_at = now
    ticket.last_activity_at = now
    ticket.resolution_summary = resolve_data.resolution_summary.strip()
    await db.commit()

    if ticket.user and ticket.user.email:
        await send_email(
            ticket.user.email,
            f"Заявка #{ticket_id} решена",
            (
                f"Ваша заявка переведена в статус «Решена».\n\n"
                f"Комментарий оператора: {ticket.resolution_summary}\n\n"
                "Если проблема осталась, ответьте в этой же переписке."
            ),
        )

    await websocket_manager.notify_ticket_update(
        ticket.user_id,
        ticket_id,
        "resolved",
        {"resolution": ticket.resolution_summary},
    )
    await log_activity(
        db,
        current_user.id,
        "ticket_resolve",
        request.client.host,
        request.headers.get("user-agent", ""),
        extra={"ticket_id": ticket_id},
    )
    return {"message": "Заявка отмечена как решённая"}


@router.post("/{ticket_id}/rate")
async def rate_ticket(
    ticket_id: int,
    request: Request,
    rating_data: TicketRateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save customer satisfaction rating for a resolved ticket."""

    result = await db.execute(
        select(Ticket).where(
            Ticket.id == ticket_id,
            Ticket.user_id == current_user.id,
            Ticket.status == TicketStatus.RESOLVED,
        )
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Решённая заявка не найдена")

    ticket.satisfaction_rating = rating_data.rating
    ticket.updated_at = datetime.utcnow()
    await db.commit()
    await log_activity(
        db,
        current_user.id,
        "ticket_rate",
        request.client.host,
        request.headers.get("user-agent", ""),
        extra={"ticket_id": ticket_id, "rating": rating_data.rating},
    )
    return {"message": "Спасибо за вашу оценку"}


@router.post("/{ticket_id}/close")
async def close_ticket(
    ticket_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Close a resolved ticket from the user side."""

    result = await db.execute(
        select(Ticket).where(
            Ticket.id == ticket_id,
            Ticket.user_id == current_user.id,
            Ticket.status == TicketStatus.RESOLVED,
        )
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Решённая заявка не найдена")

    now = datetime.utcnow()
    ticket.status = TicketStatus.CLOSED
    ticket.closed_at = now
    ticket.updated_at = now
    ticket.last_activity_at = now
    await db.commit()
    await log_activity(
        db,
        current_user.id,
        "ticket_close",
        request.client.host,
        request.headers.get("user-agent", ""),
        extra={"ticket_id": ticket_id},
    )
    return {"message": "Заявка закрыта"}
