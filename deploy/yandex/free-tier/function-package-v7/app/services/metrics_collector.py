from prometheus_client import Gauge, Counter
from app.database import AsyncSessionLocal
from app.models import User, Ticket, PaymentLog, PaymentStatus
from sqlalchemy import select, func, and_
from datetime import datetime, timedelta
import asyncio
import logging

logger = logging.getLogger(__name__)

# Metrics definitions
user_total = Gauge('app_users_total', 'Total number of users')
user_active = Gauge('app_users_active', 'Active users (logged in last 24h)')
user_new_today = Gauge('app_users_new_today', 'New users today')
tickets_by_status = Gauge('app_tickets_by_status', 'Tickets by status', ['status'])
tickets_overdue = Gauge('app_tickets_overdue', 'Overdue tickets')
payments_today_total = Gauge('app_payments_today_total', 'Total payments today')
payments_today_count = Gauge('app_payments_today_count', 'Number of payments today')
revenue_today = Gauge('app_revenue_today', 'Revenue today')
revenue_month = Gauge('app_revenue_month', 'Revenue this month')
avg_response_time = Gauge('app_avg_ticket_response_time', 'Average ticket response time in hours')
avg_resolution_time = Gauge('app_avg_ticket_resolution_time', 'Average ticket resolution time in days')

class MetricsCollector:
    """Collect and update application metrics"""
    
    @staticmethod
    async def collect_user_metrics():
        """Collect user-related metrics"""
        async with AsyncSessionLocal() as db:
            # Total users
            total = await db.scalar(select(func.count()).select_from(User))
            user_total.set(total)
            
            # Active users (last 24h)
            day_ago = datetime.utcnow() - timedelta(days=1)
            active = await db.scalar(
                select(func.count()).select_from(User)
                .where(User.last_login_at >= day_ago)
            )
            user_active.set(active or 0)
            
            # New users today
            today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            new_today = await db.scalar(
                select(func.count()).select_from(User)
                .where(User.created_at >= today_start)
            )
            user_new_today.set(new_today or 0)
    
    @staticmethod
    async def collect_ticket_metrics():
        """Collect ticket-related metrics"""
        async with AsyncSessionLocal() as db:
            from app.models import TicketStatus, Ticket
            
            # Tickets by status
            for status in TicketStatus:
                count = await db.scalar(
                    select(func.count()).select_from(Ticket)
                    .where(Ticket.status == status)
                )
                tickets_by_status.labels(status=status.value).set(count or 0)
            
            # Overdue tickets
            now = datetime.utcnow()
            overdue = await db.scalar(
                select(func.count()).select_from(Ticket)
                .where(
                    Ticket.sla_deadline < now,
                    Ticket.status.notin_([TicketStatus.RESOLVED, TicketStatus.CLOSED])
                )
            )
            tickets_overdue.set(overdue or 0)
            
            # Average response time
            resolved_tickets = await db.execute(
                select(Ticket).where(Ticket.first_response_at.isnot(None))
            )
            tickets_list = resolved_tickets.scalars().all()
            if tickets_list:
                avg_seconds = sum(
                    (t.first_response_at - t.created_at).total_seconds()
                    for t in tickets_list
                ) / len(tickets_list)
                avg_response_time.set(avg_seconds / 3600)
            
            # Average resolution time
            closed_tickets = await db.execute(
                select(Ticket).where(Ticket.resolved_at.isnot(None))
            )
            closed_list = closed_tickets.scalars().all()
            if closed_list:
                avg_days = sum(
                    (t.resolved_at - t.created_at).days
                    for t in closed_list
                ) / len(closed_list)
                avg_resolution_time.set(avg_days)
    
    @staticmethod
    async def collect_payment_metrics():
        """Collect payment-related metrics"""
        async with AsyncSessionLocal() as db:
            today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            
            # Today's payments
            today_payments = await db.execute(
                select(func.sum(PaymentLog.amount))
                .where(
                    PaymentLog.created_at >= today_start,
                    PaymentLog.status == PaymentStatus.SUCCEEDED
                )
            )
            today_total = today_payments.scalar() or 0
            payments_today_total.set(float(today_total))
            
            today_count = await db.scalar(
                select(func.count()).select_from(PaymentLog)
                .where(
                    PaymentLog.created_at >= today_start,
                    PaymentLog.status == PaymentStatus.SUCCEEDED
                )
            )
            payments_today_count.set(today_count or 0)
            
            # Monthly revenue
            month_payments = await db.execute(
                select(func.sum(PaymentLog.amount))
                .where(
                    PaymentLog.created_at >= month_start,
                    PaymentLog.status == PaymentStatus.SUCCEEDED
                )
            )
            month_total = month_payments.scalar() or 0
            revenue_month.set(float(month_total))
            
            # Today's revenue (same as today_total)
            revenue_today.set(float(today_total))
    
    @classmethod
    async def collect_all_metrics(cls):
        """Collect all metrics"""
        try:
            await cls.collect_user_metrics()
            await cls.collect_ticket_metrics()
            await cls.collect_payment_metrics()
            logger.debug("Metrics collection completed")
        except Exception as e:
            logger.error(f"Metrics collection failed: {e}")

# Scheduled task for metrics collection
async def scheduled_metrics_collection():
    """Run metrics collection periodically"""
    while True:
        await MetricsCollector.collect_all_metrics()
        await asyncio.sleep(60)  # Collect every minute