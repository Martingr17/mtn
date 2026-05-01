from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc
from datetime import datetime, timedelta

from app.database import get_db
from app.models import User, Ticket, PaymentLog, ActivityLog, PaymentStatus, TicketStatus
from app.dependencies import get_current_user, get_current_admin
from app.services.stats import TrafficStatsService
from app.schemas.statistics import (
    TrafficStatsResponse, PaymentStatsResponse, TicketStatsResponse,
    DashboardStatsResponse,
)

router = APIRouter(prefix="/statistics", tags=["statistics"])

@router.get("/traffic", response_model=TrafficStatsResponse)
async def get_traffic_stats(
    days: int = Query(30, ge=1, le=90),
    current_user: User = Depends(get_current_user),
):
    """Get user's traffic statistics"""
    stats_service = TrafficStatsService()
    data = await stats_service.get_user_traffic(current_user.billing_id, days)

    return TrafficStatsResponse(**data)

@router.get("/payments", response_model=PaymentStatsResponse)
async def get_payment_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    months: int = Query(6, ge=1, le=24),
):
    """Get user's payment statistics"""
    cutoff_date = datetime.utcnow() - timedelta(days=months * 30)

    # Get all payments
    result = await db.execute(
        select(PaymentLog)
        .where(
            PaymentLog.user_id == current_user.id,
            PaymentLog.created_at >= cutoff_date,
            PaymentLog.status == PaymentStatus.SUCCEEDED,
        )
        .order_by(PaymentLog.created_at),
    )
    payments = result.scalars().all()

    # Calculate monthly totals
    monthly_totals = {}
    for payment in payments:
        month_key = payment.created_at.strftime("%Y-%m")
        monthly_totals[month_key] = monthly_totals.get(month_key, 0) + float(payment.amount)

    # Calculate statistics
    total_amount = sum(float(p.amount) for p in payments)
    avg_amount = total_amount / len(payments) if payments else 0
    largest_payment = max([float(p.amount) for p in payments]) if payments else 0

    # Get recent payments
    recent = payments[-5:] if len(payments) > 5 else payments

    return PaymentStatsResponse(
        total_amount=total_amount,
        average_amount=avg_amount,
        largest_payment=largest_payment,
        payment_count=len(payments),
        monthly_totals=[{"month": k, "amount": v} for k, v in monthly_totals.items()],
        recent_payments=[
            {
                "id": p.id,
                "amount": float(p.amount),
                "created_at": p.created_at,
                "status": p.status.value,
            }
            for p in recent
        ],
    )

@router.get("/tickets", response_model=TicketStatsResponse)
async def get_ticket_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    months: int = Query(6, ge=1, le=24),
):
    """Get user's ticket statistics"""
    cutoff_date = datetime.utcnow() - timedelta(days=months * 30)

    result = await db.execute(
        select(Ticket)
        .where(
            Ticket.user_id == current_user.id,
            Ticket.created_at >= cutoff_date,
        )
        .order_by(Ticket.created_at),
    )
    tickets = result.scalars().all()

    # Statistics by status
    status_counts = {}
    for status in TicketStatus:
        status_counts[status.value] = sum(1 for t in tickets if t.status == status)

    # Average response time
    resolved_tickets = [t for t in tickets if t.resolution_time_seconds]
    avg_response_time = sum(t.response_time_seconds or 0 for t in resolved_tickets) / len(resolved_tickets) if resolved_tickets else 0
    avg_resolution_time = sum(t.resolution_time_seconds or 0 for t in resolved_tickets) / len(resolved_tickets) if resolved_tickets else 0

    # Monthly trend
    monthly_counts = {}
    for ticket in tickets:
        month_key = ticket.created_at.strftime("%Y-%m")
        monthly_counts[month_key] = monthly_counts.get(month_key, 0) + 1

    return TicketStatsResponse(
        total_tickets=len(tickets),
        open_tickets=status_counts.get("new", 0) + status_counts.get("in_progress", 0) + status_counts.get("waiting_customer", 0),
        resolved_tickets=status_counts.get("resolved", 0),
        closed_tickets=status_counts.get("closed", 0),
        average_response_time_hours=round(avg_response_time / 3600, 1),
        average_resolution_time_hours=round(avg_resolution_time / 3600, 1),
        status_breakdown=status_counts,
        monthly_trend=[{"month": k, "count": v} for k, v in monthly_counts.items()],
    )

@router.get("/admin/dashboard", response_model=DashboardStatsResponse)
async def get_admin_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    """Get admin dashboard statistics"""
    now = datetime.utcnow()
    today_start = datetime(now.year, now.month, now.day)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    # User statistics
    total_users = await db.scalar(select(func.count()).select_from(User))
    new_users_today = await db.scalar(
        select(func.count()).select_from(User).where(User.created_at >= today_start),
    )
    new_users_week = await db.scalar(
        select(func.count()).select_from(User).where(User.created_at >= week_ago),
    )
    blocked_users = await db.scalar(
        select(func.count()).select_from(User).where(User.is_blocked == True),
    )

    # Ticket statistics
    total_tickets = await db.scalar(select(func.count()).select_from(Ticket))
    open_tickets = await db.scalar(
        select(func.count()).select_from(Ticket).where(
            Ticket.status.in_([TicketStatus.NEW, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_CUSTOMER]),
        ),
    )
    overdue_tickets = await db.scalar(
        select(func.count()).select_from(Ticket).where(
            Ticket.sla_deadline < now,
            Ticket.status.notin_([TicketStatus.RESOLVED, TicketStatus.CLOSED]),
        ),
    )
    tickets_today = await db.scalar(
        select(func.count()).select_from(Ticket).where(Ticket.created_at >= today_start),
    )

    # Payment statistics
    payments_month = await db.execute(
        select(func.sum(PaymentLog.amount))
        .where(
            PaymentLog.status == PaymentStatus.SUCCEEDED,
            PaymentLog.created_at >= month_ago,
        ),
    )
    revenue_month = float(payments_month.scalar() or 0)

    payments_today = await db.execute(
        select(func.sum(PaymentLog.amount))
        .where(
            PaymentLog.status == PaymentStatus.SUCCEEDED,
            PaymentLog.created_at >= today_start,
        ),
    )
    revenue_today = float(payments_today.scalar() or 0)

    # Activity statistics
    active_users_today = await db.scalar(
        select(func.count()).select_from(ActivityLog)
        .where(ActivityLog.created_at >= today_start, ActivityLog.action == "login"),
    )

    # Recent activities
    recent_activities_result = await db.execute(
        select(ActivityLog)
        .order_by(desc(ActivityLog.created_at))
        .limit(10),
    )
    recent_activities = recent_activities_result.scalars().all()

    return DashboardStatsResponse(
        total_users=total_users,
        new_users_today=new_users_today,
        new_users_week=new_users_week,
        blocked_users=blocked_users,
        total_tickets=total_tickets,
        open_tickets=open_tickets,
        overdue_tickets=overdue_tickets,
        tickets_today=tickets_today,
        revenue_month=revenue_month,
        revenue_today=revenue_today,
        active_users_today=active_users_today,
        recent_activities=[
            {
                "user_id": a.user_id,
                "action": a.action,
                "ip": str(a.ip_address),
                "created_at": a.created_at,
            }
            for a in recent_activities
        ],
    )
