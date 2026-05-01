import asyncio
import math
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import MvpRole, PaymentStatus, TicketStatus, UserRole, user_role_has_mvp_access
from app.database import get_db
from app.dependencies import get_current_user, require_mvp_roles
from app.models import PaymentLog, Ticket, User
from app.schemas.subscriber import (
    SubscriberBalanceResponse,
    SubscriberDetailResponse,
    SubscriberListResponse,
    SubscriberPaymentsResponse,
    SubscriberSummaryResponse,
    SubscriberTicketsResponse,
)
from app.services.billing import BillingService


router = APIRouter(prefix="/subscribers", tags=["subscribers"])

SUBSCRIBER_READER_ROLES = (
    MvpRole.SUPPORT,
    MvpRole.BILLING,
    MvpRole.NOC_ENGINEER,
    MvpRole.ADMIN,
)


def _enum_value(value: object) -> str:
    return value.value if hasattr(value, "value") else str(value)


def _display_name(user: User) -> str:
    return getattr(user, "full_name", None) or " ".join(
        part for part in [user.last_name, user.first_name, user.middle_name] if part
    ) or user.phone


def _service_status(user: User) -> tuple[str, str]:
    if user.is_blocked:
        return "blocked", "Заблокирован"
    if not user.is_active:
        return "inactive", "Неактивен"
    return "active", "Активен"


def _connection_address(user: User, account_info: Optional[dict[str, Any]] = None) -> Optional[str]:
    if getattr(user, "connection_address", None):
        return user.connection_address

    settings_payload = user.notification_settings if isinstance(user.notification_settings, dict) else {}
    for key in ("connection_address", "address", "installation_address"):
        value = settings_payload.get(key)
        if value:
            return str(value)

    account_payload = account_info if isinstance(account_info, dict) else {}
    for key in ("connection_address", "address", "installation_address"):
        value = account_payload.get(key)
        if value:
            return str(value)

    return None


def _normalize_tariff(payload: Any) -> Optional[dict[str, Any]]:
    if not isinstance(payload, dict) or not payload:
        return None

    return {
        "tariff_id": payload.get("tariff_id") or payload.get("billing_tariff_id"),
        "name": payload.get("name"),
        "speed_mbps": payload.get("speed_mbps") or payload.get("speed"),
        "upload_speed_mbps": payload.get("upload_speed_mbps"),
        "price": float(payload.get("price") or 0),
        "is_unlimited": payload.get("is_unlimited"),
        "traffic_limit_gb": payload.get("traffic_limit_gb"),
    }


def _has_staff_subscriber_access(user: User) -> bool:
    return user_role_has_mvp_access(user.role, SUBSCRIBER_READER_ROLES)


def _ensure_can_read_subscriber(current_user: User, subscriber_id: int) -> None:
    if _has_staff_subscriber_access(current_user):
        return
    if user_role_has_mvp_access(current_user.role, [MvpRole.SUBSCRIBER]) and current_user.id == subscriber_id:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Недостаточно прав для просмотра абонента",
    )


async def _load_subscriber(db: AsyncSession, subscriber_id: int) -> User:
    result = await db.execute(select(User).where(User.id == subscriber_id, User.role == UserRole.USER))
    subscriber = result.scalar_one_or_none()
    if subscriber is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Абонент не найден")
    return subscriber


async def _safe_balance(billing: BillingService, billing_id: str) -> Optional[float]:
    try:
        return float(await billing.get_balance(billing_id))
    except Exception:
        return None


async def _safe_tariff(billing: BillingService, billing_id: str) -> Optional[dict[str, Any]]:
    try:
        return _normalize_tariff(await billing.get_current_tariff(billing_id))
    except Exception:
        return None


async def _safe_account_info(billing: BillingService, billing_id: str) -> dict[str, Any]:
    try:
        return await billing.get_account_info(billing_id) or {}
    except Exception:
        return {}


async def _ticket_counts(db: AsyncSession, subscriber_ids: list[int]) -> dict[int, dict[str, int]]:
    if not subscriber_ids:
        return {}

    rows = await db.execute(
        select(Ticket.user_id, Ticket.status, func.count())
        .where(Ticket.user_id.in_(subscriber_ids))
        .group_by(Ticket.user_id, Ticket.status),
    )
    counters: dict[int, dict[str, int]] = {}
    open_statuses = {"new", "in_progress", "waiting_customer", "escalated"}
    for user_id, status_value, count in rows.all():
        status_name = _enum_value(status_value)
        item = counters.setdefault(int(user_id), {"open": 0, "total": 0})
        item["total"] += int(count)
        if status_name in open_statuses:
            item["open"] += int(count)
    return counters


async def _last_payment_map(db: AsyncSession, subscriber_ids: list[int]) -> dict[int, datetime]:
    if not subscriber_ids:
        return {}

    rows = await db.execute(
        select(PaymentLog.user_id, func.max(PaymentLog.created_at))
        .where(PaymentLog.user_id.in_(subscriber_ids))
        .group_by(PaymentLog.user_id),
    )
    return {int(user_id): created_at for user_id, created_at in rows.all() if created_at is not None}


async def _summary_payload(
    user: User,
    *,
    billing: BillingService,
    ticket_counts: Optional[dict[str, int]] = None,
    last_payment_at: Optional[datetime] = None,
    include_account_info: bool = False,
) -> dict[str, Any]:
    balance_task = _safe_balance(billing, user.billing_id)
    tariff_task = _safe_tariff(billing, user.billing_id)
    account_task = _safe_account_info(billing, user.billing_id) if include_account_info else None
    if account_task is None:
        balance, tariff = await asyncio.gather(balance_task, tariff_task)
        account_info: dict[str, Any] = {}
    else:
        balance, tariff, account_info = await asyncio.gather(balance_task, tariff_task, account_task)

    service_status, service_status_label = _service_status(user)
    counters = ticket_counts or {"open": 0, "total": 0}

    return {
        "id": user.id,
        "billing_id": user.billing_id,
        "full_name": _display_name(user),
        "connection_address": _connection_address(user, account_info),
        "phone": user.phone,
        "email": user.email,
        "current_tariff": tariff,
        "balance": balance,
        "service_status": service_status,
        "service_status_label": service_status_label,
        "is_active": bool(user.is_active),
        "is_blocked": bool(user.is_blocked),
        "open_tickets": int(counters.get("open", 0)),
        "total_tickets": int(counters.get("total", 0)),
        "last_payment_at": last_payment_at,
        "ont": {"status": "planned", "message": "Будет реализовано на этапе GPON"},
        "account_info": account_info,
    }


def _payment_payload(payment: PaymentLog) -> dict[str, Any]:
    return {
        "id": payment.id,
        "amount": float(payment.amount or 0),
        "fee_amount": float(payment.fee_amount or 0),
        "net_amount": float(payment.net_amount) if payment.net_amount is not None else None,
        "payment_method": payment.payment_method,
        "payment_type": payment.payment_type,
        "status": _enum_value(payment.status),
        "external_id": payment.external_id,
        "description": payment.description,
        "created_at": payment.created_at,
        "completed_at": payment.completed_at,
    }


def _ticket_payload(ticket: Ticket) -> dict[str, Any]:
    assignee = getattr(ticket, "assignee", None)
    return {
        "id": ticket.id,
        "subject": ticket.subject,
        "category": ticket.category,
        "status": _enum_value(ticket.status),
        "priority": _enum_value(ticket.priority),
        "assigned_to": ticket.assigned_to,
        "assignee_name": _display_name(assignee) if assignee else None,
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
        "last_activity_at": ticket.last_activity_at,
        "is_overdue": bool(getattr(ticket, "is_overdue", False)),
    }


@router.get("", response_model=SubscriberListResponse)
@router.get("/", response_model=SubscriberListResponse)
async def list_subscribers(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    contract: str = Query("", max_length=64),
    billing_id: str = Query("", max_length=64),
    search: str = Query("", max_length=120),
    address: str = Query("", max_length=160),
    status_filter: str = Query("all", alias="status", max_length=24),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_mvp_roles(SUBSCRIBER_READER_ROLES)),
) -> SubscriberListResponse:
    filters = [User.role == UserRole.USER]

    contract_value = (contract or billing_id).strip()
    if contract_value:
        filters.append(User.billing_id.ilike(f"%{contract_value}%"))

    if search.strip():
        term = f"%{search.strip()}%"
        filters.append(
            or_(
                User.phone.ilike(term),
                User.email.ilike(term),
                User.billing_id.ilike(term),
                User.first_name.ilike(term),
                User.last_name.ilike(term),
                User.middle_name.ilike(term),
            ),
        )

    if address.strip():
        filters.append(User.connection_address.ilike(f"%{address.strip()}%"))

    if status_filter == "active":
        filters.extend([User.is_active == True, User.is_blocked == False])
    elif status_filter == "blocked":
        filters.append(User.is_blocked == True)
    elif status_filter == "inactive":
        filters.extend([User.is_active == False, User.is_blocked == False])
    elif status_filter != "all":
        raise HTTPException(status_code=400, detail="Некорректный статус фильтра")

    total = int(await db.scalar(select(func.count()).select_from(User).where(*filters)) or 0)
    result = await db.execute(
        select(User)
        .where(*filters)
        .order_by(User.created_at.desc(), User.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size),
    )
    users = list(result.scalars().all())
    user_ids = [user.id for user in users]
    ticket_metrics = await _ticket_counts(db, user_ids)
    last_payments = await _last_payment_map(db, user_ids)

    billing = BillingService()
    try:
        items = await asyncio.gather(
            *[
                _summary_payload(
                    user,
                    billing=billing,
                    ticket_counts=ticket_metrics.get(user.id, {"open": 0, "total": 0}),
                    last_payment_at=last_payments.get(user.id),
                )
                for user in users
            ],
        )
    finally:
        await billing.close()

    return SubscriberListResponse(
        items=[SubscriberSummaryResponse(**item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=max(math.ceil(total / page_size), 1),
    )


@router.get("/{subscriber_id}", response_model=SubscriberDetailResponse)
async def get_subscriber(
    subscriber_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriberDetailResponse:
    _ensure_can_read_subscriber(current_user, subscriber_id)
    subscriber = await _load_subscriber(db, subscriber_id)

    ticket_metrics = await _ticket_counts(db, [subscriber.id])
    last_payments = await _last_payment_map(db, [subscriber.id])

    billing = BillingService()
    try:
        payload = await _summary_payload(
            subscriber,
            billing=billing,
            ticket_counts=ticket_metrics.get(subscriber.id, {"open": 0, "total": 0}),
            last_payment_at=last_payments.get(subscriber.id),
            include_account_info=True,
        )
    finally:
        await billing.close()

    payments_result = await db.execute(
        select(PaymentLog)
        .where(PaymentLog.user_id == subscriber.id)
        .order_by(PaymentLog.created_at.desc())
        .limit(10),
    )
    tickets_result = await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.assignee))
        .where(Ticket.user_id == subscriber.id)
        .order_by(Ticket.created_at.desc())
        .limit(10),
    )

    payload.update(
        {
            "first_name": subscriber.first_name,
            "last_name": subscriber.last_name,
            "middle_name": subscriber.middle_name,
            "recent_payments": [_payment_payload(payment) for payment in payments_result.scalars().all()],
            "recent_tickets": [_ticket_payload(ticket) for ticket in tickets_result.scalars().all()],
        },
    )
    return SubscriberDetailResponse(**payload)


@router.get("/{subscriber_id}/payments", response_model=SubscriberPaymentsResponse)
async def get_subscriber_payments(
    subscriber_id: int,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    status_filter: str = Query("all", alias="status", max_length=24),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriberPaymentsResponse:
    _ensure_can_read_subscriber(current_user, subscriber_id)
    subscriber = await _load_subscriber(db, subscriber_id)

    filters = [PaymentLog.user_id == subscriber.id]
    if status_filter != "all":
        try:
            filters.append(PaymentLog.status == PaymentStatus(status_filter))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Некорректный статус платежа") from exc

    total = int(await db.scalar(select(func.count()).select_from(PaymentLog).where(*filters)) or 0)
    result = await db.execute(
        select(PaymentLog)
        .where(*filters)
        .order_by(PaymentLog.created_at.desc(), PaymentLog.id.desc())
        .offset(offset)
        .limit(limit),
    )
    return SubscriberPaymentsResponse(
        items=[_payment_payload(payment) for payment in result.scalars().all()],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{subscriber_id}/tickets", response_model=SubscriberTicketsResponse)
async def get_subscriber_tickets(
    subscriber_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: str = Query("all", alias="status", max_length=24),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriberTicketsResponse:
    _ensure_can_read_subscriber(current_user, subscriber_id)
    subscriber = await _load_subscriber(db, subscriber_id)

    filters = [Ticket.user_id == subscriber.id]
    if status_filter != "all":
        try:
            filters.append(Ticket.status == TicketStatus(status_filter))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Некорректный статус заявки") from exc

    total = int(await db.scalar(select(func.count()).select_from(Ticket).where(*filters)) or 0)
    result = await db.execute(
        select(Ticket)
        .options(selectinload(Ticket.assignee))
        .where(*filters)
        .order_by(Ticket.created_at.desc(), Ticket.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size),
    )
    return SubscriberTicketsResponse(
        items=[_ticket_payload(ticket) for ticket in result.scalars().all()],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=max(math.ceil(total / page_size), 1),
    )


@router.get("/{subscriber_id}/balance", response_model=SubscriberBalanceResponse)
async def get_subscriber_balance(
    subscriber_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriberBalanceResponse:
    _ensure_can_read_subscriber(current_user, subscriber_id)
    subscriber = await _load_subscriber(db, subscriber_id)

    billing = BillingService()
    try:
        balance = await _safe_balance(billing, subscriber.billing_id)
    finally:
        await billing.close()

    amount = float(balance or 0)
    return SubscriberBalanceResponse(
        subscriber_id=subscriber.id,
        billing_id=subscriber.billing_id,
        balance=amount,
        has_debt=amount < 0,
        updated_at=datetime.utcnow(),
    )
