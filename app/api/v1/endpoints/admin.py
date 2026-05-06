import asyncio
import csv
import io
import json
import logging
import math
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import settings
from app.core.constants import UserRole
from app.core.logger import log_activity
from app.database import engine, get_db
from app.dependencies import get_current_admin, get_current_superadmin
from app.models import ActivityLog, Message, PaymentLog, PaymentStatus, Tariff, Ticket, TicketStatus, User, UserSession
from app.schemas.admin import (
    AdminManualPaymentRequest,
    AdminStaffCreateRequest,
    AdminStaffDetailResponse,
    AdminStaffUpdateRequest,
    AdminStatsResponse,
    AdminUserCreateRequest,
    AdminUserBulkStatusRequest,
    AdminUserUpdateRequest,
    SystemSettingsUpdate,
)
from app.services.billing import BillingService
from app.services.cache import redis_cache
from app.services.email import send_email
from app.services.monitoring import get_admin_monitoring_overview, get_alerts_response, get_user_monitoring_snapshots
from app.services.ticket_notify import notify_user_new_message
from app.services.websocket_manager import websocket_manager
from app.utils.file_upload import save_attachment, validate_file

try:
    import psutil
except Exception:  # pragma: no cover
    psutil = None

router = APIRouter(prefix="/admin", tags=["admin"])
logger = logging.getLogger(__name__)
APP_STARTED_AT = datetime.utcnow()
STAFF_ROLES = {
    UserRole.OPERATOR,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
}
OPEN_TICKET_STATUSES = {
    TicketStatus.NEW,
    TicketStatus.IN_PROGRESS,
    TicketStatus.WAITING_CUSTOMER,
    TicketStatus.ESCALATED,
}
DEFAULT_SYSTEM_SETTINGS = {
    "maintenance_mode": False,
    "registration_enabled": True,
    "payment_enabled": True,
    "ticket_system_enabled": True,
    "min_payment_amount": 100,
    "max_payment_amount": 100000,
    "ticket_auto_close_days": 7,
    "maintenance_message": "Сервис временно обновляется. Мы уже чиним. Загляните через 10 минут.",
}
STATUS_FILTER_OPTIONS = {"all", "active", "blocked", "inactive"}
DEBT_FILTER_OPTIONS = {"all", "has_debt", "clear"}
TICKET_FILTER_OPTIONS = {"all", "with_open", "without_open"}
TICKET_STATUS_LABELS = {
    TicketStatus.NEW: "Новые",
    TicketStatus.IN_PROGRESS: "В работе",
    TicketStatus.WAITING_CUSTOMER: "Ожидают клиента",
    TicketStatus.RESOLVED: "Решённые",
    TicketStatus.CLOSED: "Закрытые",
    TicketStatus.ESCALATED: "Эскалация",
}
TICKET_PRIORITY_LABELS = {
    "low": "Низкий",
    "medium": "Средний",
    "high": "Высокий",
    "urgent": "Срочный",
    "critical": "Критический",
}


def _empty_monitoring_overview() -> dict[str, Any]:
    return {
        "monitoring_monitored_users": 0,
        "monitoring_disabled_users": 0,
        "monitoring_users_with_active_alerts": 0,
        "monitoring_critical_alerts_24h": 0,
        "monitoring_average_quality_score": 0,
        "monitoring_quality_breakdown": [],
        "monitoring_alert_types": [],
        "monitoring_latest_alerts": [],
        "monitoring_worst_users": [],
    }


def _empty_admin_stats_response(*, now: datetime) -> AdminStatsResponse:
    return AdminStatsResponse(
        total_users=0,
        new_users_today=0,
        blocked_users=0,
        total_tickets=0,
        open_tickets=0,
        overdue_tickets=0,
        resolved_tickets_today=0,
        revenue_month=0,
        revenue_today=0,
        active_users_last_24h=0,
        active_users_today=0,
        total_staff=0,
        active_staff=0,
        tickets_by_status=[],
        tickets_by_priority=[],
        payments_last_7_days=[],
        recent_activity=[],
        **_empty_monitoring_overview(),
        system_health={"status": "degraded", "timestamp": now.isoformat()},
    )


def _enum_value(value: Any) -> Any:
    return value.value if hasattr(value, "value") else value


def _display_name(user: Optional[User]) -> str:
    if not user:
        return "Не назначен"
    return getattr(user, "full_name", "") or getattr(user, "display_name", "") or user.phone


def _role_label(role: Any) -> str:
    mapping = {
        "user": "Абонент",
        "operator": "Оператор",
        "admin": "Администратор",
        "super_admin": "Суперадмин",
    }
    return mapping.get(str(_enum_value(role)), str(_enum_value(role)))


def _status_label(is_active: bool, is_blocked: bool) -> str:
    if is_blocked or not is_active:
        return "Заблокирован"
    return "Активен"


def _can_manage_users(admin: User) -> bool:
    return _enum_value(getattr(admin, "role", None)) in {
        UserRole.ADMIN.value,
        UserRole.SUPER_ADMIN.value,
    }


def _ensure_user_management_permission(admin: User) -> None:
    if not _can_manage_users(admin):
        raise HTTPException(status_code=403, detail="Недостаточно прав для управления абонентами")


def _normalize_filter_value(value: str, allowed: set[str], label: str) -> str:
    normalized = (value or "all").strip().lower()
    if normalized not in allowed:
        raise HTTPException(status_code=400, detail=f"Некорректное значение фильтра: {label}")
    return normalized


def _safe_iso(value: Any) -> Optional[str]:
    return value.isoformat() if value else None


def _activity_item_payload(activity: ActivityLog, actor: Optional[User] = None) -> dict[str, Any]:
    return {
        "id": activity.id,
        "action": activity.action,
        "status": activity.status,
        "created_at": activity.created_at,
        "user_id": str(activity.user_id) if activity.user_id is not None else None,
        "user_name": _display_name(actor) if actor else None,
        "ip_address": str(activity.ip_address) if activity.ip_address else None,
    }


async def _fetch_balances_map(users: list[User]) -> dict[int, Optional[float]]:
    if not users:
        return {}

    billing = BillingService()
    semaphore = asyncio.Semaphore(8)

    async def _fetch(user: User) -> tuple[int, Optional[float]]:
        async with semaphore:
            try:
                balance = await billing.get_balance(user.billing_id)
                return user.id, float(balance)
            except Exception:
                return user.id, None

    try:
        pairs = await asyncio.gather(*(_fetch(user) for user in users))
    finally:
        await billing.close()

    return dict(pairs)


def _ticket_status_clause(status_filter: str):
    normalized = (status_filter or "").strip().lower()
    if not normalized:
        return None
    if normalized == "open":
        return Ticket.status.in_(list(OPEN_TICKET_STATUSES))
    if normalized == "resolved":
        return Ticket.status == TicketStatus.RESOLVED
    if normalized == "closed":
        return Ticket.status == TicketStatus.CLOSED
    for status in TicketStatus:
        if normalized == status.value:
            return Ticket.status == status
    raise HTTPException(status_code=400, detail="Неизвестный фильтр статуса")


def _serialize_staff(user: User) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "phone": user.phone,
        "email": user.email,
        "billing_id": user.billing_id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "middle_name": user.middle_name,
        "role": _enum_value(user.role),
        "role_label": _role_label(user.role),
        "full_name": getattr(user, "full_name", "") or user.phone,
        "display_name": getattr(user, "display_name", "") or getattr(user, "full_name", "") or user.phone,
        "is_active": bool(user.is_active),
        "is_blocked": bool(user.is_blocked),
        "block_reason": user.block_reason,
        "is_2fa_enabled": bool(user.is_2fa_enabled),
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


def _serialize_admin_message(message: Message) -> dict[str, Any]:
    author = getattr(message, "user", None)
    return {
        "id": str(message.id),
        "user_id": str(message.user_id),
        "body": message.body,
        "is_internal": bool(message.is_internal),
        "attachment_name": message.attachment_name,
        "attachment_path": message.attachment_path,
        "attachment_size": message.attachment_size,
        "attachment_mime": message.attachment_mime,
        "created_at": message.created_at.isoformat() if message.created_at else None,
        "author_name": _display_name(author),
        "author_role": _enum_value(getattr(author, "role", None)) if author else None,
        "author_phone": getattr(author, "phone", None),
    }


def _serialize_admin_ticket(ticket: Ticket) -> dict[str, Any]:
    user = getattr(ticket, "user", None)
    assignee = getattr(ticket, "assignee", None)
    messages = list(getattr(ticket, "messages", []) or [])
    return {
        "id": str(ticket.id),
        "subject": ticket.subject,
        "status": _enum_value(ticket.status),
        "priority": _enum_value(ticket.priority),
        "category": ticket.category,
        "user_id": str(ticket.user_id),
        "user_phone": getattr(user, "phone", None),
        "user_email": getattr(user, "email", None),
        "user_name": _display_name(user),
        "user_billing_id": getattr(user, "billing_id", None),
        "assigned_to": str(ticket.assigned_to) if ticket.assigned_to is not None else None,
        "assigned_to_name": _display_name(assignee) if assignee else None,
        "resolution_summary": ticket.resolution_summary,
        "created_at": ticket.created_at.isoformat() if ticket.created_at else None,
        "updated_at": ticket.updated_at.isoformat() if ticket.updated_at else None,
        "last_activity_at": ticket.last_activity_at.isoformat() if ticket.last_activity_at else None,
        "first_response_at": ticket.first_response_at.isoformat() if ticket.first_response_at else None,
        "resolved_at": ticket.resolved_at.isoformat() if ticket.resolved_at else None,
        "closed_at": ticket.closed_at.isoformat() if ticket.closed_at else None,
        "escalated_at": ticket.escalated_at.isoformat() if ticket.escalated_at else None,
        "sla_deadline": ticket.sla_deadline.isoformat() if ticket.sla_deadline else None,
        "is_overdue": bool(getattr(ticket, "is_overdue", False)),
        "response_time_seconds": getattr(ticket, "response_time_seconds", None),
        "resolution_time_seconds": getattr(ticket, "resolution_time_seconds", None),
        "messages": [_serialize_admin_message(item) for item in messages],
    }


def _generate_staff_billing_id(phone: str) -> str:
    suffix = uuid.uuid4().hex[:10].upper()
    normalized_phone = "".join(ch for ch in phone if ch.isdigit())[-6:]
    return f"STAFF-{normalized_phone}-{suffix}"


def _resolve_log_path() -> Path:
    configured = Path(settings.log_file)
    candidates = [
        configured,
        Path.cwd() / configured,
        Path(__file__).resolve().parents[3] / configured,
        Path(__file__).resolve().parents[4] / configured,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[1]


def _read_log_records(level: str = "all") -> List[Dict[str, Any]]:
    path = _resolve_log_path()
    if not path.exists():
        return []

    records: List[Dict[str, Any]] = []
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()

    for raw in reversed(lines):
        raw = raw.strip()
        if not raw:
            continue

        record: Dict[str, Any]
        if raw.startswith("{") and raw.endswith("}"):
            try:
                parsed = json.loads(raw)
                record = {
                    "timestamp": parsed.get("timestamp") or parsed.get("asctime") or "",
                    "level": str(parsed.get("level") or parsed.get("levelname") or "INFO"),
                    "logger": parsed.get("logger") or parsed.get("name") or "app",
                    "message": parsed.get("message") or "",
                }
            except json.JSONDecodeError:
                record = {"timestamp": "", "level": "INFO", "logger": "app", "message": raw}
        else:
            record = {"timestamp": "", "level": "INFO", "logger": "app", "message": raw}

        if level != "all" and record["level"].upper() != level.upper():
            continue
        records.append(record)

    return records


@router.get("/stats", response_model=AdminStatsResponse)
@router.get("/dashboard")
async def get_admin_stats(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    now = datetime.utcnow()
    today_start = datetime(now.year, now.month, now.day)
    seven_days_ago = today_start - timedelta(days=6)
    try:
        abonent_filter = User.role == UserRole.USER

        total_users = await db.scalar(
            select(func.count()).select_from(User).where(abonent_filter),
        ) or 0
        new_users_today = await db.scalar(
            select(func.count()).select_from(User).where(
                abonent_filter,
                User.created_at >= today_start,
            ),
        ) or 0
        blocked_users = await db.scalar(
            select(func.count()).select_from(User).where(
                abonent_filter,
                or_(User.is_blocked == True, User.is_active == False),
            ),
        ) or 0
        total_tickets = await db.scalar(select(func.count()).select_from(Ticket)) or 0
        open_tickets = await db.scalar(
            select(func.count()).select_from(Ticket).where(
                Ticket.status.in_(list(OPEN_TICKET_STATUSES)),
            ),
        ) or 0
        overdue_tickets = await db.scalar(
            select(func.count()).select_from(Ticket).where(
                Ticket.status.in_(list(OPEN_TICKET_STATUSES)),
                Ticket.sla_deadline.is_not(None),
                Ticket.sla_deadline < now,
            ),
        ) or 0
        resolved_tickets_today = await db.scalar(
            select(func.count()).select_from(Ticket).where(
                Ticket.resolved_at.is_not(None),
                Ticket.resolved_at >= today_start,
            ),
        ) or 0
        revenue_month = await db.scalar(
            select(func.sum(PaymentLog.amount)).where(
                PaymentLog.status == PaymentStatus.SUCCEEDED,
                PaymentLog.created_at >= (now - timedelta(days=30)),
            ),
        ) or 0
        revenue_today = await db.scalar(
            select(func.sum(PaymentLog.amount)).where(
                PaymentLog.status == PaymentStatus.SUCCEEDED,
                PaymentLog.created_at >= today_start,
            ),
        ) or 0

        active_users = await db.scalar(
            select(func.count(func.distinct(ActivityLog.user_id))).where(ActivityLog.created_at >= (now - timedelta(days=1))),
        ) or 0
        active_users_today = await db.scalar(
            select(func.count(func.distinct(ActivityLog.user_id))).where(ActivityLog.created_at >= today_start),
        ) or 0
        total_staff = await db.scalar(
            select(func.count()).select_from(User).where(User.role.in_(list(STAFF_ROLES))),
        ) or 0
        active_staff = await db.scalar(
            select(func.count()).select_from(User).where(
                User.role.in_(list(STAFF_ROLES)),
                User.is_active == True,
                User.is_blocked == False,
            ),
        ) or 0

        ticket_status_rows = await db.execute(
            select(Ticket.status, func.count())
            .group_by(Ticket.status)
            .order_by(func.count().desc()),
        )
        ticket_priority_rows = await db.execute(
            select(Ticket.priority, func.count())
            .group_by(Ticket.priority)
            .order_by(func.count().desc()),
        )
        payment_rows = await db.execute(
            select(PaymentLog.created_at, PaymentLog.amount)
            .where(
                PaymentLog.status == PaymentStatus.SUCCEEDED,
                PaymentLog.created_at >= seven_days_ago,
            )
            .order_by(PaymentLog.created_at.asc()),
        )
        recent_activity_rows = await db.execute(
            select(ActivityLog, User)
            .outerjoin(User, User.id == ActivityLog.user_id)
            .order_by(ActivityLog.created_at.desc())
            .limit(8),
        )
        try:
            monitoring_overview = await get_admin_monitoring_overview(db)
        except Exception:
            logger.exception("Failed to build admin monitoring overview")
            monitoring_overview = _empty_monitoring_overview()

        payment_series = {
            (seven_days_ago + timedelta(days=index)).date().isoformat(): {"amount": 0.0, "count": 0}
            for index in range(7)
        }
        for created_at, amount in payment_rows.all():
            if not created_at:
                continue
            bucket = payment_series.setdefault(created_at.date().isoformat(), {"amount": 0.0, "count": 0})
            bucket["amount"] += float(amount or 0)
            bucket["count"] += 1

        return AdminStatsResponse(
            total_users=int(total_users),
            new_users_today=int(new_users_today),
            blocked_users=int(blocked_users),
            total_tickets=int(total_tickets),
            open_tickets=int(open_tickets),
            overdue_tickets=int(overdue_tickets),
            resolved_tickets_today=int(resolved_tickets_today),
            revenue_month=float(revenue_month or 0),
            revenue_today=float(revenue_today or 0),
            active_users_last_24h=int(active_users),
            active_users_today=int(active_users_today),
            total_staff=int(total_staff),
            active_staff=int(active_staff),
            tickets_by_status=[
                {
                    "key": _enum_value(status),
                    "label": TICKET_STATUS_LABELS.get(status, str(_enum_value(status))),
                    "value": int(count),
                }
                for status, count in ticket_status_rows.all()
            ],
            tickets_by_priority=[
                {
                    "key": _enum_value(priority),
                    "label": TICKET_PRIORITY_LABELS.get(str(_enum_value(priority)), str(_enum_value(priority))),
                    "value": int(count),
                }
                for priority, count in ticket_priority_rows.all()
            ],
            payments_last_7_days=[
                {
                    "date": day,
                    "amount": round(values["amount"], 2),
                    "count": int(values["count"]),
                }
                for day, values in payment_series.items()
            ],
            recent_activity=[
                _activity_item_payload(activity, actor)
                for activity, actor in recent_activity_rows.all()
            ],
            **monitoring_overview,
            system_health={"status": "healthy", "timestamp": now.isoformat()},
        )
    except Exception:
        logger.exception("Failed to build admin stats response")
        return _empty_admin_stats_response(now=now)


@router.get("/tickets")
async def list_admin_tickets(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: str = Query("", max_length=40),
    search: str = Query("", max_length=120),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    ticket_query = (
        select(Ticket, User.phone, User.email)
        .join(User, User.id == Ticket.user_id)
        .options(selectinload(Ticket.assignee), selectinload(Ticket.user))
    )
    count_query = select(func.count()).select_from(Ticket).join(User, User.id == Ticket.user_id)

    status_clause = _ticket_status_clause(status_filter)
    if status_clause is not None:
        ticket_query = ticket_query.where(status_clause)
        count_query = count_query.where(status_clause)

    if search:
        term = f"%{search.strip()}%"
        filter_clause = or_(
            Ticket.subject.ilike(term),
            User.phone.ilike(term),
            User.email.ilike(term),
            User.billing_id.ilike(term),
        )
        ticket_query = ticket_query.where(filter_clause)
        count_query = count_query.join(User, User.id == Ticket.user_id).where(filter_clause)

    total = int((await db.scalar(count_query)) or 0)
    offset = (page - 1) * page_size
    result = await db.execute(
        ticket_query
        .order_by(Ticket.created_at.desc())
        .offset(offset)
        .limit(page_size),
    )

    items = []
    for ticket, phone, email in result.all():
        items.append(
            {
                "id": str(ticket.id),
                "subject": ticket.subject,
                "status": _enum_value(ticket.status),
                "priority": _enum_value(ticket.priority),
                "category": ticket.category,
                "user_id": str(ticket.user_id),
                "user_phone": phone,
                "user_email": email,
                "created_at": ticket.created_at.isoformat() if ticket.created_at else None,
                "updated_at": ticket.updated_at.isoformat() if ticket.updated_at else None,
                "sla_deadline": ticket.sla_deadline.isoformat() if ticket.sla_deadline else None,
                "is_overdue": bool(getattr(ticket, "is_overdue", False)),
                "assigned_to": str(ticket.assigned_to) if ticket.assigned_to is not None else None,
                "assigned_to_name": _display_name(ticket.assignee) if ticket.assignee else None,
            },
        )

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(math.ceil(total / page_size), 1),
    }


@router.post("/users")
@router.post("/abonents")
async def create_admin_user(
    payload: AdminUserCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    _ensure_user_management_permission(admin)

    phone = (payload.phone or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="Номер телефона обязателен")

    existing_phone = await db.execute(select(User).where(User.phone == phone))
    if existing_phone.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Абонент с таким номером уже существует")

    billing_id = payload.billing_id or f"DEMO{uuid.uuid4().hex[:8].upper()}"
    existing_billing = await db.execute(select(User).where(User.billing_id == billing_id))
    if existing_billing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Абонент с таким лицевым счётом уже существует")

    if payload.email:
        existing_email = await db.execute(select(User).where(User.email == payload.email))
        existing_email_user = existing_email.scalar_one_or_none()
        if existing_email_user:
            raise HTTPException(status_code=409, detail="Абонент с таким email уже существует")

    user = User(
        billing_id=billing_id,
        phone=phone,
        email=payload.email,
        first_name=payload.first_name,
        last_name=payload.last_name,
        middle_name=payload.middle_name,
        role=UserRole.USER,
        is_active=True,
        is_blocked=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()

    tariff_payload = None
    if payload.tariff_id:
        tariff_result = await db.execute(
            select(Tariff).where(Tariff.id == payload.tariff_id, Tariff.is_active == True),
        )
        tariff = tariff_result.scalar_one_or_none()
        if not tariff:
            raise HTTPException(status_code=404, detail="Тариф не найден")
        tariff_payload = tariff

    await db.commit()
    await db.refresh(user)

    if tariff_payload:
        billing = BillingService()
        await billing.change_tariff(user.billing_id, tariff_payload.billing_tariff_id)

    await log_activity(
        db,
        admin.id,
        "admin_user_create",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"target_user_id": user.id, "billing_id": user.billing_id},
    )

    return {
        "message": "Абонент создан",
        "user": {
            "id": str(user.id),
            "billing_id": user.billing_id,
            "phone": user.phone,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "middle_name": user.middle_name,
            "full_name": getattr(user, "full_name", "") or user.phone,
        },
    }


@router.get("/users")
@router.get("/abonents")
async def list_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query("", max_length=120),
    status_filter: str = Query("all", max_length=24),
    debt_filter: str = Query("all", max_length=24),
    ticket_filter: str = Query("all", max_length=24),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    status_filter = _normalize_filter_value(status_filter, STATUS_FILTER_OPTIONS, "status_filter")
    debt_filter = _normalize_filter_value(debt_filter, DEBT_FILTER_OPTIONS, "debt_filter")
    ticket_filter = _normalize_filter_value(ticket_filter, TICKET_FILTER_OPTIONS, "ticket_filter")

    query = select(User).where(User.role == UserRole.USER)

    if search:
        term = f"%{search.strip()}%"
        filter_clause = or_(
            User.phone.ilike(term),
            User.email.ilike(term),
            User.billing_id.ilike(term),
            User.first_name.ilike(term),
            User.last_name.ilike(term),
        )
        query = query.where(filter_clause)

    if status_filter == "active":
        query = query.where(User.is_active == True, User.is_blocked == False)
    elif status_filter == "blocked":
        query = query.where(User.is_blocked == True)
    elif status_filter == "inactive":
        query = query.where(User.is_active == False, User.is_blocked == False)

    result = await db.execute(query.order_by(User.created_at.desc(), User.id.desc()))
    users = list(result.scalars().all())

    user_ids = [user.id for user in users]
    ticket_metrics: dict[int, dict[str, int]] = {}
    last_payment_at_map: dict[int, Any] = {}

    if user_ids:
        ticket_rows = await db.execute(
            select(Ticket.user_id, Ticket.status, func.count())
            .where(Ticket.user_id.in_(user_ids))
            .group_by(Ticket.user_id, Ticket.status),
        )
        for row_user_id, row_status, count in ticket_rows.all():
            metrics = ticket_metrics.setdefault(row_user_id, {"total": 0, "open": 0})
            metrics["total"] += int(count)
            if row_status in OPEN_TICKET_STATUSES:
                metrics["open"] += int(count)

        payment_rows = await db.execute(
            select(PaymentLog.user_id, func.max(PaymentLog.created_at))
            .where(PaymentLog.user_id.in_(user_ids))
            .group_by(PaymentLog.user_id),
        )
        last_payment_at_map = {row_user_id: created_at for row_user_id, created_at in payment_rows.all()}

    if ticket_filter != "all":
        users = [
            user
            for user in users
            if (
                ticket_filter == "with_open" and ticket_metrics.get(user.id, {}).get("open", 0) > 0
            ) or (
                ticket_filter == "without_open" and ticket_metrics.get(user.id, {}).get("open", 0) == 0
            )
        ]

    filtered_balance_map: dict[int, Optional[float]] = {}
    if debt_filter != "all":
        filtered_balance_map = await _fetch_balances_map(users)
        if debt_filter == "has_debt":
            users = [user for user in users if (filtered_balance_map.get(user.id) or 0) < 0]
        elif debt_filter == "clear":
            users = [user for user in users if (filtered_balance_map.get(user.id) or 0) >= 0]

    total = len(users)
    offset = (page - 1) * page_size
    page_users = users[offset : offset + page_size]
    page_balance_map = filtered_balance_map if debt_filter != "all" else await _fetch_balances_map(page_users)
    monitoring_snapshots = await get_user_monitoring_snapshots(db, [user.id for user in page_users])

    items = []
    for user in page_users:
        balance = page_balance_map.get(user.id)
        metrics = ticket_metrics.get(user.id, {"total": 0, "open": 0})
        monitoring = monitoring_snapshots.get(user.id, {})
        items.append(
            {
                "id": str(user.id),
                "phone": user.phone,
                "email": user.email,
                "billing_id": user.billing_id,
                "full_name": getattr(user, "full_name", "") or user.phone,
                "role": _enum_value(user.role),
                "role_label": _role_label(user.role),
                "is_active": bool(user.is_active),
                "is_blocked": bool(user.is_blocked),
                "status_label": _status_label(bool(user.is_active), bool(user.is_blocked)),
                "created_at": _safe_iso(user.created_at),
                "last_login_at": _safe_iso(user.last_login_at),
                "balance": balance,
                "has_debt": balance is not None and balance < 0,
                "balance_state": (
                    "debt" if balance is not None and balance < 0 else
                    "low" if balance is not None and balance < 100 else
                    "ok" if balance is not None else
                    "unknown"
                ),
                "open_tickets": metrics["open"],
                "total_tickets": metrics["total"],
                "last_payment_at": _safe_iso(last_payment_at_map.get(user.id)),
                "monitoring": monitoring,
            },
        )

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(math.ceil(total / page_size), 1),
    }


@router.get("/users/{user_id}")
@router.get("/abonents/{user_id}")
async def get_user_detail(
    user_id: int,
    request: Request,
    silent: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    billing = BillingService()
    balance_task = billing.get_balance(user.billing_id)
    tariff_task = billing.get_current_tariff(user.billing_id)
    account_task = billing.get_account_info(user.billing_id)
    balance_result, tariff_result, account_result = await asyncio.gather(
        balance_task,
        tariff_task,
        account_task,
        return_exceptions=True,
    )

    balance = None if isinstance(balance_result, Exception) else balance_result
    tariff = None if isinstance(tariff_result, Exception) else tariff_result
    account_info = None if isinstance(account_result, Exception) else account_result

    total_payments = await db.scalar(
        select(func.sum(PaymentLog.amount)).where(
            PaymentLog.user_id == user.id,
            PaymentLog.status == PaymentStatus.SUCCEEDED,
        ),
    ) or 0
    total_tickets = await db.scalar(select(func.count()).select_from(Ticket).where(Ticket.user_id == user.id)) or 0

    activity_result = await db.execute(
        select(ActivityLog)
        .where(ActivityLog.user_id == user.id)
        .order_by(ActivityLog.created_at.desc())
        .limit(12),
    )
    activities = activity_result.scalars().all()

    payments_result = await db.execute(
        select(PaymentLog)
        .where(PaymentLog.user_id == user.id)
        .order_by(PaymentLog.created_at.desc())
        .limit(6),
    )
    recent_payments = payments_result.scalars().all()

    tickets_result = await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.assignee))
        .where(Ticket.user_id == user.id)
        .order_by(Ticket.created_at.desc())
        .limit(6),
    )
    recent_tickets = tickets_result.scalars().all()

    tariffs_result = await db.execute(
        select(Tariff)
        .where(Tariff.is_active == True)
        .order_by(Tariff.sort_order.asc(), Tariff.price.asc(), Tariff.id.asc()),
    )
    available_tariffs = tariffs_result.scalars().all()
    monitoring_snapshot_map = await get_user_monitoring_snapshots(db, [user.id])
    monitoring_alerts_payload = await get_alerts_response(
        db,
        user.id,
        page=1,
        page_size=5,
        status_value=None,
        alert_type=None,
        severity=None,
        date_from=datetime.utcnow() - timedelta(days=30),
        date_to=None,
    )

    if not silent:
        await log_activity(
            db,
            admin.id,
            "admin_view_abonent",
            request.client.host if request.client else None,
            request.headers.get("user-agent", ""),
            extra={"target_user_id": user.id, "billing_id": user.billing_id},
        )

    return {
        "user": {
            "id": str(user.id),
            "billing_id": user.billing_id,
            "phone": user.phone,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "role": _enum_value(user.role),
            "role_label": _role_label(user.role),
            "is_active": bool(user.is_active),
            "is_blocked": bool(user.is_blocked),
            "is_verified": bool(user.is_verified),
            "is_2fa_enabled": bool(user.is_2fa_enabled),
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
            "full_name": getattr(user, "full_name", "") or user.phone,
            "display_name": getattr(user, "display_name", "") or getattr(user, "full_name", "") or user.phone,
            "status_label": _status_label(bool(user.is_active), bool(user.is_blocked)),
            "block_reason": user.block_reason,
        },
        "balance": float(balance or 0),
        "tariff": tariff,
        "account_info": account_info or {},
        "current_billing_tariff_id": (tariff or {}).get("tariff_id") if isinstance(tariff, dict) else None,
        "total_payments": float(total_payments or 0),
        "total_tickets": int(total_tickets),
        "recent_payments": [
            {
                "id": payment.id,
                "amount": float(payment.amount or 0),
                "status": _enum_value(payment.status),
                "payment_method": payment.payment_method,
                "payment_type": payment.payment_type,
                "description": payment.description,
                "created_at": payment.created_at.isoformat() if payment.created_at else None,
                "completed_at": payment.completed_at.isoformat() if payment.completed_at else None,
                "external_id": payment.external_id,
                "payment_url": payment.payment_url,
            }
            for payment in recent_payments
        ],
        "recent_tickets": [
            {
                "id": ticket.id,
                "subject": ticket.subject,
                "status": _enum_value(ticket.status),
                "priority": _enum_value(ticket.priority),
                "category": ticket.category,
                "created_at": ticket.created_at.isoformat() if ticket.created_at else None,
                "updated_at": ticket.updated_at.isoformat() if ticket.updated_at else None,
                "last_activity_at": ticket.last_activity_at.isoformat() if ticket.last_activity_at else None,
                "assigned_to_name": _display_name(ticket.assignee) if ticket.assignee else None,
                "is_overdue": bool(getattr(ticket, "is_overdue", False)),
            }
            for ticket in recent_tickets
        ],
        "available_tariffs": [
            {
                "id": tariff_item.id,
                "billing_tariff_id": tariff_item.billing_tariff_id,
                "name": tariff_item.name,
                "speed_mbps": tariff_item.speed_mbps,
                "upload_speed_mbps": tariff_item.upload_speed_mbps,
                "price": float(tariff_item.price or 0),
                "is_popular": bool(getattr(tariff_item, "is_popular", False)),
                "is_unlimited": bool(getattr(tariff_item, "is_unlimited", True)),
                "traffic_limit_gb": tariff_item.traffic_limit_gb,
                "contract_term_months": getattr(tariff_item, "contract_term_months", 12),
            }
            for tariff_item in available_tariffs
        ],
        "activities": [
            {
                "action": activity.action,
                "created_at": activity.created_at.isoformat() if activity.created_at else None,
                "ip": str(activity.ip_address or ""),
                "status": activity.status,
            }
            for activity in activities
        ],
        "monitoring_summary": monitoring_snapshot_map.get(user.id, {}),
        "monitoring_recent_alerts": [
            {
                "id": alert.id,
                "type": alert.type,
                "severity": alert.severity,
                "status": alert.status,
                "message": alert.message,
                "start_time": alert.start_time.isoformat() if alert.start_time else None,
                "end_time": alert.end_time.isoformat() if alert.end_time else None,
                "is_read": bool(alert.is_read),
                "current_value": float(alert.current_value) if alert.current_value is not None else None,
                "threshold_value": float(alert.threshold_value) if alert.threshold_value is not None else None,
            }
            for alert in monitoring_alerts_payload["items"]
        ],
    }


@router.patch("/users/{user_id}")
@router.patch("/abonents/{user_id}")
async def update_admin_user(
    user_id: int,
    payload: AdminUserUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    _ensure_user_management_permission(admin)

    result = await db.execute(select(User).where(User.id == user_id, User.role == UserRole.USER))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Абонент не найден")

    if payload.email and payload.email != user.email:
        existing_email = await db.execute(select(User).where(User.email == payload.email, User.id != user_id))
        if existing_email.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Абонент с таким email уже существует")

    if payload.email is not None:
        user.email = payload.email
    if payload.first_name is not None:
        user.first_name = payload.first_name
    if payload.last_name is not None:
        user.last_name = payload.last_name
    if payload.middle_name is not None:
        user.middle_name = payload.middle_name
    user.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(user)

    await log_activity(
        db,
        admin.id,
        "admin_user_update",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"target_user_id": user.id, "billing_id": user.billing_id},
    )

    return {
        "message": "Данные абонента обновлены",
        "user": {
            "id": str(user.id),
            "billing_id": user.billing_id,
            "phone": user.phone,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "middle_name": user.middle_name,
            "full_name": getattr(user, "full_name", "") or user.phone,
        },
    }


@router.post("/users/{user_id}/manual-payment")
@router.post("/abonents/{user_id}/manual-payment")
async def manual_payment_for_user(
    user_id: int,
    payload: AdminManualPaymentRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    _ensure_user_management_permission(admin)

    result = await db.execute(select(User).where(User.id == user_id, User.role == UserRole.USER))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Абонент не найден")

    amount = round(float(payload.amount or 0), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Сумма пополнения должна быть больше нуля")

    payment_external_id = f"admin-manual-{uuid.uuid4().hex}"
    billing = BillingService()
    billing_result = await billing.add_payment(user.billing_id, amount, payment_id=payment_external_id)

    payment = PaymentLog(
        user_id=user.id,
        amount=amount,
        fee_amount=0,
        net_amount=amount,
        payment_method="manual_admin",
        payment_type="topup",
        status=PaymentStatus.SUCCEEDED,
        external_id=payment_external_id,
        description=payload.comment or "Ручное зачисление через административную панель",
        completed_at=datetime.utcnow(),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", ""),
        gateway_response={"source": "admin_manual", "billing": billing_result},
    )
    db.add(payment)
    await db.commit()
    await db.refresh(payment)

    await log_activity(
        db,
        admin.id,
        "admin_manual_payment",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"target_user_id": user.id, "amount": amount, "payment_id": payment.id},
    )

    return {
        "message": "Средства зачислены",
        "payment": {
            "id": payment.id,
            "amount": float(payment.amount or 0),
            "status": _enum_value(payment.status),
            "payment_method": payment.payment_method,
            "description": payment.description,
            "created_at": payment.created_at.isoformat() if payment.created_at else None,
            "completed_at": payment.completed_at.isoformat() if payment.completed_at else None,
        },
        "billing_result": billing_result,
    }


@router.get("/activity-log")
async def get_activity_log(
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    action: str = Query("", max_length=120),
    user_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    query = select(ActivityLog)
    count_query = select(func.count()).select_from(ActivityLog)

    if action:
        query = query.where(ActivityLog.action.ilike(f"%{action}%"))
        count_query = count_query.where(ActivityLog.action.ilike(f"%{action}%"))

    if user_id:
        query = query.where(ActivityLog.user_id == user_id)
        count_query = count_query.where(ActivityLog.user_id == user_id)

    total = int((await db.scalar(count_query)) or 0)
    result = await db.execute(
        query.order_by(ActivityLog.created_at.desc()).offset((page - 1) * page_size).limit(page_size),
    )
    logs = result.scalars().all()

    return {
        "items": [
            {
                "id": item.id,
                "user_id": str(item.user_id) if item.user_id is not None else None,
                "action": item.action,
                "status": item.status,
                "ip_address": str(item.ip_address) if item.ip_address else "",
                "user_agent": item.user_agent,
                "created_at": item.created_at.isoformat() if item.created_at else None,
                "resource_type": item.resource_type,
                "resource_id": item.resource_id,
            }
            for item in logs
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(math.ceil(total / page_size), 1),
    }


@router.get("/tickets/{ticket_id}")
async def get_admin_ticket_detail(
    ticket_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(
        select(Ticket)
        .options(
            selectinload(Ticket.user),
            selectinload(Ticket.assignee),
            selectinload(Ticket.messages).selectinload(Message.user),
        )
        .where(Ticket.id == ticket_id),
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Заявка не найдена")

    await log_activity(
        db,
        admin.id,
        "admin_ticket_view",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"ticket_id": ticket_id},
    )

    return _serialize_admin_ticket(ticket)


@router.post("/tickets/{ticket_id}/assign")
async def assign_admin_ticket(
    ticket_id: int,
    assignee_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    ticket_result = await db.execute(select(Ticket).where(Ticket.id == ticket_id))
    ticket = ticket_result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Заявка не найдена")

    assignee_result = await db.execute(select(User).where(User.id == assignee_id))
    assignee = assignee_result.scalar_one_or_none()
    if not assignee:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")

    if assignee.role not in STAFF_ROLES:
        raise HTTPException(status_code=400, detail="Назначить можно только сотрудника")
    if assignee.is_blocked or not assignee.is_active:
        raise HTTPException(status_code=400, detail="Нельзя назначить заблокированного или неактивного сотрудника")

    ticket.assigned_to = assignee.id
    if ticket.status == TicketStatus.NEW:
        ticket.status = TicketStatus.IN_PROGRESS
    ticket.updated_at = datetime.utcnow()
    ticket.last_activity_at = datetime.utcnow()
    await db.commit()

    await log_activity(
        db,
        admin.id,
        "admin_ticket_assign",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"ticket_id": ticket_id, "assignee_id": assignee_id},
    )

    await websocket_manager.send_personal_message(
        assignee.id,
        {
            "type": "ticket_assignment",
            "ticket_id": ticket_id,
            "subject": ticket.subject,
            "assigned_by": _display_name(admin),
        },
    )

    return {"message": "Заявка назначена", "assigned_to": assignee_id}


@router.post("/tickets/{ticket_id}/reply")
async def reply_admin_ticket(
    ticket_id: int,
    request: Request,
    background_tasks: BackgroundTasks,
    body: str = Form(...),
    is_internal: bool = Form(False),
    attachment: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.user), selectinload(Ticket.assignee))
        .where(Ticket.id == ticket_id),
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if ticket.status == TicketStatus.CLOSED:
        raise HTTPException(status_code=400, detail="Нельзя отвечать в закрытой заявке")

    clean_body = (body or "").strip()
    if len(clean_body) < 1 or len(clean_body) > 10000:
        raise HTTPException(status_code=400, detail="Сообщение должно содержать от 1 до 10 000 символов")

    attachment_path = None
    attachment_name = None
    attachment_size = None
    attachment_mime = None
    if attachment:
        valid, error = validate_file(attachment)
        if not valid:
            raise HTTPException(status_code=400, detail=error or "Недопустимый файл")

        uploaded = await save_attachment(attachment, admin.id, ticket_id)
        attachment_path = uploaded["path"]
        attachment_name = uploaded["original_filename"]
        attachment_size = uploaded["size"]
        attachment_mime = uploaded["mime_type"]

    now = datetime.utcnow()
    message = Message(
        ticket_id=ticket_id,
        user_id=admin.id,
        body=clean_body,
        is_internal=bool(is_internal),
        attachment_path=attachment_path,
        attachment_name=attachment_name,
        attachment_size=attachment_size,
        attachment_mime=attachment_mime,
        created_at=now,
    )
    db.add(message)

    previous_status = ticket.status
    if ticket.assigned_to is None:
        ticket.assigned_to = admin.id
    if previous_status in {TicketStatus.NEW, TicketStatus.WAITING_CUSTOMER, TicketStatus.ESCALATED} or (
        previous_status == TicketStatus.RESOLVED and not is_internal
    ):
        ticket.status = TicketStatus.IN_PROGRESS
    if previous_status == TicketStatus.RESOLVED and not is_internal:
        ticket.resolved_at = None
    if not is_internal and ticket.first_response_at is None:
        ticket.first_response_at = now
    ticket.updated_at = now
    ticket.last_activity_at = now

    await db.commit()
    await db.refresh(message)

    preview = clean_body[:120]
    if not is_internal:
        background_tasks.add_task(notify_user_new_message, ticket.user_id, ticket_id, preview)
        await websocket_manager.notify_ticket_update(
            ticket.user_id,
            ticket_id,
            "staff_reply",
            {"message_preview": preview},
        )

    await log_activity(
        db,
        admin.id,
        "admin_ticket_reply",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"ticket_id": ticket_id, "is_internal": bool(is_internal)},
    )

    return {
        "message": "Ответ сохранён",
        "ticket_status": _enum_value(ticket.status),
        "reply": _serialize_admin_message(message),
    }


@router.post("/tickets/{ticket_id}/resolve")
async def resolve_admin_ticket(
    ticket_id: int,
    payload: Dict[str, Any],
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    resolution_summary = str(payload.get("resolution_summary", "")).strip()
    if len(resolution_summary) < 10 or len(resolution_summary) > 1000:
        raise HTTPException(status_code=400, detail="Итог решения должен содержать от 10 до 1000 символов")

    result = await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.user), selectinload(Ticket.assignee))
        .where(Ticket.id == ticket_id),
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if ticket.status == TicketStatus.CLOSED:
        raise HTTPException(status_code=400, detail="Заявка уже закрыта")

    now = datetime.utcnow()
    if ticket.assigned_to is None:
        ticket.assigned_to = admin.id
    if ticket.first_response_at is None:
        ticket.first_response_at = now
    ticket.status = TicketStatus.RESOLVED
    ticket.resolved_at = now
    ticket.updated_at = now
    ticket.last_activity_at = now
    ticket.resolution_summary = resolution_summary
    await db.commit()

    if ticket.user and ticket.user.email:
        await send_email(
            ticket.user.email,
            f"Заявка #{ticket_id} решена",
            (
                f"Ваша заявка переведена в статус «Решена».\n\n"
                f"Комментарий оператора:\n{resolution_summary}\n\n"
                "Если проблема останется, ответьте в этой же переписке в личном кабинете."
            ),
        )

    await websocket_manager.notify_ticket_update(
        ticket.user_id,
        ticket_id,
        "resolved",
        {"resolution": resolution_summary},
    )
    await log_activity(
        db,
        admin.id,
        "admin_ticket_resolve",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"ticket_id": ticket_id},
    )
    return {"message": "Заявка переведена в статус «Решена»", "ticket_status": _enum_value(ticket.status)}


@router.get("/staff")
async def list_staff(
    search: str = Query("", max_length=120),
    include_inactive: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    query = select(User).where(User.role.in_(list(STAFF_ROLES)))
    if not include_inactive:
        query = query.where(User.is_active == True, User.is_blocked == False)
    if search:
        term = f"%{search.strip()}%"
        query = query.where(
            or_(
                User.phone.ilike(term),
                User.email.ilike(term),
                User.first_name.ilike(term),
                User.last_name.ilike(term),
                User.billing_id.ilike(term),
            ),
        )
    result = await db.execute(query.order_by(User.role.asc(), User.last_name.asc(), User.first_name.asc(), User.id.asc()))
    return {"items": [_serialize_staff(user) for user in result.scalars().all()]}


@router.get("/staff/{staff_id}", response_model=AdminStaffDetailResponse)
async def get_staff_detail(
    staff_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(select(User).where(User.id == staff_id))
    staff = result.scalar_one_or_none()
    if not staff or staff.role not in STAFF_ROLES:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")

    now = datetime.utcnow()
    active_sessions = await db.scalar(
        select(func.count()).select_from(UserSession).where(
            UserSession.user_id == staff.id,
            UserSession.is_revoked == False,
            UserSession.expires_at > now,
        ),
    ) or 0
    assigned_open_tickets = await db.scalar(
        select(func.count()).select_from(Ticket).where(
            Ticket.assigned_to == staff.id,
            Ticket.status.in_(list(OPEN_TICKET_STATUSES)),
        ),
    ) or 0
    assigned_total_tickets = await db.scalar(
        select(func.count()).select_from(Ticket).where(Ticket.assigned_to == staff.id),
    ) or 0
    resolved_tickets_7d = await db.scalar(
        select(func.count()).select_from(Ticket).where(
            Ticket.assigned_to == staff.id,
            Ticket.resolved_at.is_not(None),
            Ticket.resolved_at >= (now - timedelta(days=7)),
        ),
    ) or 0

    activity_rows = await db.execute(
        select(ActivityLog)
        .where(ActivityLog.user_id == staff.id)
        .order_by(ActivityLog.created_at.desc())
        .limit(8),
    )
    recent_assignments_result = await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.user))
        .where(Ticket.assigned_to == staff.id)
        .order_by(Ticket.updated_at.desc().nullslast(), Ticket.created_at.desc())
        .limit(6),
    )

    return AdminStaffDetailResponse(
        **_serialize_staff(staff),
        notification_settings=staff.notification_settings or {},
        last_login_ip=str(staff.last_login_ip) if staff.last_login_ip else None,
        active_sessions=int(active_sessions),
        assigned_open_tickets=int(assigned_open_tickets),
        assigned_total_tickets=int(assigned_total_tickets),
        resolved_tickets_7d=int(resolved_tickets_7d),
        recent_activity=[_activity_item_payload(item, staff) for item in activity_rows.scalars().all()],
        recent_assignments=[
            {
                "id": ticket.id,
                "subject": ticket.subject,
                "status": _enum_value(ticket.status),
                "priority": _enum_value(ticket.priority),
                "user_name": _display_name(ticket.user),
                "user_phone": getattr(ticket.user, "phone", None),
                "updated_at": ticket.updated_at or ticket.created_at,
                "is_overdue": bool(getattr(ticket, "is_overdue", False)),
            }
            for ticket in recent_assignments_result.scalars().all()
        ],
    )


@router.post("/staff")
async def create_staff(
    payload: AdminStaffCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_superadmin),
):
    if payload.role not in STAFF_ROLES:
        raise HTTPException(status_code=400, detail="Можно создавать только сотрудников")

    existing_phone = await db.execute(select(User).where(User.phone == payload.phone))
    if existing_phone.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Пользователь с таким телефоном уже существует")

    billing_id = payload.billing_id or _generate_staff_billing_id(payload.phone)
    existing_billing = await db.execute(select(User).where(User.billing_id == billing_id))
    if existing_billing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Такой billing ID уже используется")

    user = User(
        billing_id=billing_id,
        phone=payload.phone,
        email=payload.email,
        first_name=payload.first_name,
        last_name=payload.last_name,
        middle_name=payload.middle_name,
        role=payload.role,
        is_active=payload.is_active,
        is_verified=True,
        is_blocked=False,
        notification_settings=payload.notification_settings or {},
        created_at=datetime.utcnow(),
    )
    user.set_password(payload.password)
    db.add(user)
    await db.commit()
    await db.refresh(user)

    await log_activity(
        db,
        admin.id,
        "admin_staff_create",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"staff_id": user.id, "role": _enum_value(user.role)},
    )

    return {"message": "Сотрудник создан", "staff": _serialize_staff(user)}


@router.put("/staff/{staff_id}")
async def update_staff(
    staff_id: int,
    payload: AdminStaffUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_superadmin),
):
    result = await db.execute(select(User).where(User.id == staff_id))
    staff = result.scalar_one_or_none()
    if not staff or staff.role not in STAFF_ROLES:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")

    if payload.phone and payload.phone != staff.phone:
        existing_phone = await db.execute(select(User).where(User.phone == payload.phone, User.id != staff_id))
        if existing_phone.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Телефон уже используется")
        staff.phone = payload.phone

    if payload.billing_id and payload.billing_id != staff.billing_id:
        existing_billing = await db.execute(select(User).where(User.billing_id == payload.billing_id, User.id != staff_id))
        if existing_billing.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Billing ID уже используется")
        staff.billing_id = payload.billing_id

    if payload.role is not None:
        if payload.role not in STAFF_ROLES:
            raise HTTPException(status_code=400, detail="Можно назначать только staff-роли")
        if staff.id == admin.id and payload.role != UserRole.SUPER_ADMIN:
            raise HTTPException(status_code=400, detail="Нельзя понизить собственную роль суперадмина")
        staff.role = payload.role

    if payload.email is not None:
        staff.email = payload.email
    if payload.first_name is not None:
        staff.first_name = payload.first_name
    if payload.last_name is not None:
        staff.last_name = payload.last_name
    if payload.middle_name is not None:
        staff.middle_name = payload.middle_name
    if payload.notification_settings is not None:
        staff.notification_settings = payload.notification_settings
    if payload.password:
        staff.set_password(payload.password)
    if payload.reset_2fa:
        staff.totp_secret = None
        staff.is_2fa_enabled = False
    if payload.is_blocked is not None:
        if staff.id == admin.id and payload.is_blocked:
            raise HTTPException(status_code=400, detail="Нельзя заблокировать самого себя")
        staff.is_blocked = payload.is_blocked
        if payload.is_blocked:
            staff.is_active = False
            staff.block_reason = payload.block_reason or "Заблокирован через панель управления staff"
        else:
            staff.block_reason = None
    if payload.is_active is not None:
        if staff.id == admin.id and not payload.is_active:
            raise HTTPException(status_code=400, detail="Нельзя деактивировать собственную учётную запись")
        staff.is_active = payload.is_active
        if payload.is_active and not staff.is_blocked:
            staff.block_reason = None

    if staff.is_blocked and staff.is_active:
        raise HTTPException(status_code=400, detail="Нельзя активировать заблокированного сотрудника. Сначала снимите блокировку.")

    staff.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(staff)

    await log_activity(
        db,
        admin.id,
        "admin_staff_update",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"staff_id": staff.id},
    )

    return {"message": "Профиль сотрудника обновлён", "staff": _serialize_staff(staff)}


@router.post("/users/bulk-status")
@router.post("/abonents/bulk-status")
async def bulk_update_users_status(
    payload: AdminUserBulkStatusRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    _ensure_user_management_permission(admin)

    result = await db.execute(
        select(User).where(
            User.id.in_(payload.user_ids),
            User.role == UserRole.USER,
        ),
    )
    users = result.scalars().all()
    if not users:
        raise HTTPException(status_code=404, detail="Абоненты не найдены")

    action = payload.action
    reason = payload.reason or "Массовое действие через административную панель"
    for user in users:
        if action == "block":
            user.is_active = False
            user.is_blocked = True
            user.block_reason = reason
        else:
            user.is_active = True
            user.is_blocked = False
            user.block_reason = None
        user.updated_at = datetime.utcnow()

    await db.commit()

    await log_activity(
        db,
        admin.id,
        f"admin_user_bulk_{action}",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"target_user_ids": [user.id for user in users], "count": len(users)},
    )

    return {
        "message": "Статусы абонентов обновлены",
        "action": action,
        "updated_count": len(users),
        "user_ids": [user.id for user in users],
    }


@router.post("/users/{user_id}/block")
async def block_user(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    _ensure_user_management_permission(admin)

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    user.is_active = False
    user.is_blocked = True
    user.block_reason = "Заблокирован через административную панель"
    await db.commit()

    await log_activity(
        db,
        admin.id,
        "admin_user_block",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"target_user_id": user_id},
    )

    return {"message": "Пользователь заблокирован"}


@router.post("/users/{user_id}/unblock")
async def unblock_user(
    user_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    _ensure_user_management_permission(admin)

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    user.is_active = True
    user.is_blocked = False
    user.block_reason = None
    await db.commit()

    await log_activity(
        db,
        admin.id,
        "admin_user_unblock",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"target_user_id": user_id},
    )

    return {"message": "Пользователь разблокирован"}


@router.post("/force-tariff-change")
async def force_tariff_change(
    user_id: int,
    tariff_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    _ensure_user_management_permission(admin)

    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    tariff_result = await db.execute(select(Tariff).where(Tariff.id == tariff_id))
    tariff = tariff_result.scalar_one_or_none()
    if not tariff:
        raise HTTPException(status_code=404, detail="Тариф не найден")

    billing = BillingService()
    result = await billing.change_tariff(user.billing_id, tariff.billing_tariff_id)

    await log_activity(
        db,
        admin.id,
        "admin_tariff_force_change",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"target_user_id": user_id, "tariff_id": tariff.id, "billing_tariff_id": tariff.billing_tariff_id},
    )

    return {
        "message": "Тариф принудительно изменён",
        "tariff": {"id": tariff.id, "name": tariff.name, "billing_tariff_id": tariff.billing_tariff_id},
        "billing_result": result,
    }


@router.get("/users/export")
@router.get("/abonents/export")
async def export_users(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(
        select(User).where(User.role == UserRole.USER).order_by(User.created_at.desc()),
    )
    users = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Телефон", "Email", "Лицевой счёт", "Роль", "Статус", "Дата регистрации", "Последний вход"])

    for user in users:
        writer.writerow(
            [
                user.id,
                user.phone,
                user.email or "",
                user.billing_id,
                _role_label(user.role),
                _status_label(bool(user.is_active), bool(user.is_blocked)),
                user.created_at.isoformat() if user.created_at else "",
                user.last_login_at.isoformat() if user.last_login_at else "",
            ],
        )

    output.seek(0)
    return StreamingResponse(
        output,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=users_export.csv"},
    )


@router.get("/logs")
async def get_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(40, ge=1, le=200),
    level: str = Query("all"),
    admin: User = Depends(get_current_admin),
):
    records = _read_log_records(level=level)
    total = len(records)
    start = (page - 1) * page_size
    end = start + page_size
    items = records[start:end]

    return {
        "items": items,
        "logs": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(math.ceil(total / page_size), 1),
    }


@router.get("/logs/export")
async def export_logs(
    level: str = Query("all"),
    admin: User = Depends(get_current_admin),
):
    records = _read_log_records(level=level)
    lines = [
        f"[{record['timestamp']}] [{record['level']}] [{record['logger']}] {record['message']}"
        for record in records
    ]
    content = "\n".join(lines) if lines else "Логи не найдены"
    filename = f"app_logs_{level.lower()}.log"
    return PlainTextResponse(
        content,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/system/info")
async def get_system_info(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    uptime_delta = datetime.utcnow() - APP_STARTED_AT
    hours, remainder = divmod(int(uptime_delta.total_seconds()), 3600)
    minutes = remainder // 60

    if psutil:
        cpu_percent = round(psutil.cpu_percent(interval=0.1), 1)
        memory_percent = round(psutil.virtual_memory().percent, 1)
        disk_percent = round(psutil.disk_usage("/").percent, 1)
    else:
        cpu_percent = 0.0
        memory_percent = 0.0
        disk_percent = 0.0

    db_connections = 0
    try:
        pool = engine.pool
        checked_in = getattr(pool, "checkedin", lambda: 0)()
        checked_out = getattr(pool, "checkedout", lambda: 0)()
        db_connections = int(checked_in + checked_out)
    except Exception:
        db_connections = 0

    active_users = await db.scalar(
        select(func.count(func.distinct(ActivityLog.user_id))).where(ActivityLog.created_at >= (datetime.utcnow() - timedelta(hours=24))),
    ) or 0

    error_records = _read_log_records(level="ERROR")

    return {
        "app_version": settings.app_version,
        "environment": str(settings.environment.value if hasattr(settings.environment, "value") else settings.environment),
        "uptime": f"{hours} ч {minutes} мин",
        "cpu_percent": cpu_percent,
        "memory_percent": memory_percent,
        "disk_percent": disk_percent,
        "db_connections": db_connections,
        "active_users_24h": int(active_users),
        "error_count_last_log_snapshot": len(error_records[:200]),
    }


@router.get("/system/settings")
async def get_system_settings(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_superadmin),
):
    cached = await redis_cache.get("system:settings", {})
    maintenance_mode = await redis_cache.get(
        "system:maintenance_mode",
        cached.get("maintenance_mode", DEFAULT_SYSTEM_SETTINGS["maintenance_mode"]),
    )
    maintenance_message = await redis_cache.get(
        "system:maintenance_message",
        cached.get("maintenance_message", DEFAULT_SYSTEM_SETTINGS["maintenance_message"]),
    )

    resolved = {
        **DEFAULT_SYSTEM_SETTINGS,
        **cached,
        "maintenance_mode": bool(maintenance_mode),
        "maintenance_message": str(maintenance_message),
    }
    return resolved


@router.put("/system/settings")
async def update_system_settings(
    settings_data: SystemSettingsUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_superadmin),
):
    payload = settings_data.model_dump()
    await redis_cache.set("system:settings", payload, expire=None)
    await redis_cache.set("system:maintenance_mode", payload["maintenance_mode"], expire=None)
    await redis_cache.set("system:maintenance_message", payload["maintenance_message"], expire=None)

    await log_activity(
        db,
        admin.id,
        "admin_settings_change",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"settings": payload},
    )

    return {"message": "Настройки обновлены"}


@router.post("/cache/clear")
async def clear_cache(
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_superadmin),
):
    for pattern in (
        "balance:*",
        "tariff:*",
        "traffic:*",
        "user:*",
        "notifications:*",
        "speedtest:*",
        "dashboard:*",
    ):
        await redis_cache.clear_pattern(pattern)

    await log_activity(
        db,
        admin.id,
        "cache_cleared",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
    )

    return {"message": "Кэш очищен"}


@router.post("/maintenance")
async def set_maintenance_mode(
    enabled: bool,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_superadmin),
):
    cached = await get_system_settings(db=db, admin=admin)
    cached["maintenance_mode"] = enabled
    await redis_cache.set("system:settings", cached, expire=None)
    await redis_cache.set("system:maintenance_mode", enabled, expire=None)

    await log_activity(
        db,
        admin.id,
        f"maintenance_mode_{'enabled' if enabled else 'disabled'}",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
    )

    return {"message": f"Режим обслуживания {'включён' if enabled else 'выключен'}"}
