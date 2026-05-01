import asyncio
import json
import logging
import subprocess
from app.workers.celery_app import celery_app
from app.services.email import email_service
from app.services.sms import sms_service
from app.services.cache import redis_cache
from app.services.monitoring import (
    cleanup_old_monitoring_data as monitoring_cleanup_old_data,
    collect_metrics_batch as monitoring_collect_metrics_batch,
    evaluate_alerts_batch as monitoring_evaluate_alerts_batch,
)
from app.services.notification_center import cleanup_old_notifications as notification_cleanup_old_data
from app.services.websocket_manager import websocket_manager
from app.services.ticket_notify import notify_ticket_escalated
from app.database import AsyncSessionLocal
from app.models import User, Ticket, ActivityLog, Notification, NotificationType
from app.config import settings
from sqlalchemy import select, delete, and_, or_
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)
_worker_event_loop = None


def _run_async(awaitable):
    global _worker_event_loop
    if _worker_event_loop is None or _worker_event_loop.is_closed():
        _worker_event_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_worker_event_loop)
    return _worker_event_loop.run_until_complete(awaitable)


def _promote_ticket_priority(priority):
    from app.core.constants import TicketPriority

    if priority == TicketPriority.LOW:
        return TicketPriority.MEDIUM
    if priority == TicketPriority.MEDIUM:
        return TicketPriority.HIGH
    if priority == TicketPriority.HIGH:
        return TicketPriority.URGENT
    return TicketPriority.CRITICAL


@celery_app.task(name="tasks.collect_monitoring_metrics")
def collect_monitoring_metrics():
    """Collect connection quality metrics for active subscribers."""
    async def _collect():
        async with AsyncSessionLocal() as db:
            count = await monitoring_collect_metrics_batch(db)
            await db.commit()
            return count

    count = _run_async(_collect())
    if count > 0:
        logger.info("Collected %s monitoring metric snapshots", count)
    return count


@celery_app.task(name="tasks.evaluate_monitoring_alerts")
def evaluate_monitoring_alerts():
    """Evaluate monitoring thresholds and create/resolve alerts."""
    async def _evaluate():
        async with AsyncSessionLocal() as db:
            count = await monitoring_evaluate_alerts_batch(db)
            await db.commit()
            return count

    count = _run_async(_evaluate())
    if count > 0:
        logger.info("Processed monitoring alerts for %s subscriber lines", count)
    return count


@celery_app.task(name="tasks.cleanup_old_monitoring_data")
def cleanup_old_monitoring_data():
    """Remove monitoring data outside the configured retention window."""
    async def _cleanup():
        async with AsyncSessionLocal() as db:
            count = await monitoring_cleanup_old_data(db)
            await db.commit()
            return count

    count = _run_async(_cleanup())
    if count > 0:
        logger.info("Removed %s outdated monitoring samples", count)
    return count


@celery_app.task(name="tasks.cleanup_old_notifications")
def cleanup_old_notifications():
    """Remove archived and expired notifications outside the retention window."""
    async def _cleanup():
        async with AsyncSessionLocal() as db:
            count = await notification_cleanup_old_data(db)
            await db.commit()
            return count

    count = _run_async(_cleanup())
    if count > 0:
        logger.info("Removed %s outdated notifications", count)
    return count

@celery_app.task(name="tasks.send_email", bind=True, max_retries=3)
def send_email(self, to_email: str, subject: str, body: str, html_body: str = None):
    """Send email asynchronously"""
    try:
        result = _run_async(email_service.send_email(to_email, subject, body, html_body))
        if result:
            logger.info(f"Email sent to {to_email}")
        else:
            logger.error(f"Failed to send email to {to_email}")
            if self.request.retries < self.max_retries:
                raise self.retry(countdown=60 * (self.request.retries + 1))
        return result
    except Exception as e:
        logger.error(f"Email task error: {e}")
        if self.request.retries < self.max_retries:
            raise self.retry(exc=e, countdown=60)
        return False

@celery_app.task(name="tasks.send_sms", bind=True, max_retries=3)
def send_sms(self, phone: str, message: str):
    """Send SMS asynchronously"""
    try:
        result = _run_async(sms_service.send_code(phone, message))
        if result:
            logger.info(f"SMS sent to {phone}")
        else:
            logger.error(f"Failed to send SMS to {phone}")
            if self.request.retries < self.max_retries:
                raise self.retry(countdown=60)
        return result
    except Exception as e:
        logger.error(f"SMS task error: {e}")
        if self.request.retries < self.max_retries:
            raise self.retry(exc=e, countdown=60)
        return False

@celery_app.task(name="tasks.send_bulk_notifications")
def send_bulk_notifications(user_ids: list, title: str, body: str, notif_type: str = "email"):
    """Send bulk notifications to multiple users"""
    results = []
    for user_id in user_ids:
        try:
            # Store notification in DB
            _run_async(store_notification(user_id, title, body, notif_type))
            results.append(True)
        except Exception as e:
            logger.error(f"Failed to send to user {user_id}: {e}")
            results.append(False)
    return {"total": len(user_ids), "success": sum(results), "failed": len(results) - sum(results)}

async def store_notification(user_id: int, title: str, body: str, notif_type: str):
    """Store notification in database"""
    async with AsyncSessionLocal() as db:
        notification = Notification(
            user_id=user_id,
            title=title,
            body=body,
            type=NotificationType(notif_type),
            is_read=False,
            is_sent=False
        )
        db.add(notification)
        await db.commit()

@celery_app.task(name="tasks.cleanup_expired_sessions")
def cleanup_expired_sessions():
    """Clean up expired user sessions"""
    async def _cleanup():
        async with AsyncSessionLocal() as db:
            from app.models import UserSession
            result = await db.execute(
                delete(UserSession).where(UserSession.expires_at < datetime.utcnow())
            )
            await db.commit()
            return result.rowcount
    
    count = _run_async(_cleanup())
    logger.info(f"Cleaned up {count} expired sessions")
    return count

@celery_app.task(name="tasks.cleanup_old_logs")
def cleanup_old_logs():
    """Clean up old activity and audit logs (retention 90 days)"""
    cutoff_date = datetime.utcnow() - timedelta(days=90)
    
    async def _cleanup():
        async with AsyncSessionLocal() as db:
            from app.models import ActivityLog, AuditLog
            result1 = await db.execute(delete(ActivityLog).where(ActivityLog.created_at < cutoff_date))
            result2 = await db.execute(delete(AuditLog).where(AuditLog.created_at < cutoff_date))
            await db.commit()
            return result1.rowcount + result2.rowcount
    
    count = _run_async(_cleanup())
    logger.info(f"Cleaned up {count} old log records")
    return count

@celery_app.task(name="tasks.check_overdue_tickets")
def check_overdue_tickets():
    """Backward-compatible alias for ticket escalation checks."""
    return escalate_unanswered_tickets()


@celery_app.task(name="tasks.escalate_unanswered_tickets")
def escalate_unanswered_tickets():
    """Escalate tickets that breached SLA or remained unanswered for too long."""
    async def _check():
        async with AsyncSessionLocal() as db:
            from app.core.constants import TicketPriority, TicketStatus

            now = datetime.utcnow()
            stale_new_threshold = now - timedelta(hours=1)
            cooldown_threshold = now - timedelta(hours=4)
            status_filter = [TicketStatus.NEW, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_CUSTOMER, TicketStatus.ESCALATED]

            result = await db.execute(
                select(Ticket).where(
                    and_(
                        Ticket.status.in_(status_filter),
                        or_(
                            Ticket.sla_deadline < now,
                            and_(
                                Ticket.status == TicketStatus.NEW,
                                Ticket.priority.in_([TicketPriority.HIGH, TicketPriority.URGENT, TicketPriority.CRITICAL]),
                                Ticket.created_at < stale_new_threshold,
                            ),
                        ),
                        or_(Ticket.escalated_at.is_(None), Ticket.escalated_at < cooldown_threshold),
                    )
                )
            )
            tickets = result.scalars().all()
            escalated = []

            for ticket in tickets:
                old_priority = ticket.priority
                new_priority = _promote_ticket_priority(ticket.priority)
                ticket.priority = new_priority
                ticket.escalated_at = now
                ticket.updated_at = now
                ticket.last_activity_at = now
                ticket.sla_deadline = now + timedelta(hours=TicketPriority.get_sla_hours(new_priority))

                db.add(
                    ActivityLog(
                        user_id=None,
                        action="ticket_escalate",
                        ip_address="127.0.0.1",
                        user_agent="celery",
                        resource_type="ticket",
                        resource_id=ticket.id,
                        status="success",
                        old_value={"priority": getattr(old_priority, "value", str(old_priority))},
                        new_value={
                            "priority": getattr(new_priority, "value", str(new_priority)),
                            "escalated_at": now.isoformat(),
                        },
                    )
                )
                escalated.append((ticket.id, getattr(old_priority, "value", str(old_priority)), getattr(new_priority, "value", str(new_priority))))

            await db.commit()

            for ticket_id, old_priority, new_priority in escalated:
                await notify_ticket_escalated(ticket_id, old_priority, new_priority)

            return len(escalated)

    count = _run_async(_check())
    if count > 0:
        logger.info("Escalated %s unanswered tickets", count)
    return count


@celery_app.task(name="tasks.close_stale_tickets")
def close_stale_tickets():
    """Automatically close resolved tickets after 7 days without new activity."""
    async def _close():
        async with AsyncSessionLocal() as db:
            from app.core.constants import TicketStatus

            now = datetime.utcnow()
            cutoff = now - timedelta(days=7)
            result = await db.execute(
                select(Ticket).where(
                    and_(
                        Ticket.status == TicketStatus.RESOLVED,
                        Ticket.resolved_at.is_not(None),
                        Ticket.resolved_at < cutoff,
                    )
                )
            )
            tickets = result.scalars().all()

            for ticket in tickets:
                ticket.status = TicketStatus.CLOSED
                ticket.closed_at = now
                ticket.updated_at = now
                ticket.last_activity_at = now
                db.add(
                    ActivityLog(
                        user_id=None,
                        action="ticket_auto_close",
                        ip_address="127.0.0.1",
                        user_agent="celery",
                        resource_type="ticket",
                        resource_id=ticket.id,
                        status="success",
                        new_value={"closed_at": now.isoformat()},
                    )
                )

            await db.commit()
            return len(tickets)

    count = _run_async(_close())
    if count > 0:
        logger.info("Closed %s stale tickets", count)
    return count

@celery_app.task(name="tasks.send_daily_summary")
def send_daily_summary():
    """Send daily summary email to all users"""
    async def _send_summaries():
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(User).where(User.email.isnot(None)))
            users = result.scalars().all()
            delivered = 0
            
            for user in users:
                # Get user's ticket count
                ticket_result = await db.execute(
                    select(Ticket).where(Ticket.user_id == user.id, Ticket.created_at > datetime.utcnow() - timedelta(days=1))
                )
                tickets = ticket_result.scalars().all()
                
                # Get payment info
                from app.models import PaymentLog
                payment_result = await db.execute(
                    select(PaymentLog).where(
                        PaymentLog.user_id == user.id,
                        PaymentLog.created_at > datetime.utcnow() - timedelta(days=1),
                        PaymentLog.status == "succeeded"
                    )
                )
                payments = payment_result.scalars().all()
                
                # Send email
                subject = f"Daily Summary for {datetime.utcnow().strftime('%Y-%m-%d')}"
                body = f"""
                Daily Activity Summary:
                - New tickets: {len(tickets)}
                - Payments made: {len(payments)}
                - Total amount: {sum(p.amount for p in payments)} RUB
                
                Login to your account for more details.
                """
                if await email_service.send_email(user.email, subject, body):
                    delivered += 1
            
            return {"processed": len(users), "delivered": delivered}
    
    result = _run_async(_send_summaries())
    logger.info(
        "Processed daily summaries for %s users, delivered=%s",
        result["processed"],
        result["delivered"],
    )
    return result

@celery_app.task(name="tasks.backup_database")
def backup_database():
    """Create database backup"""
    import subprocess
    import os
    from datetime import datetime
    
    backup_dir = settings.backup_path
    os.makedirs(backup_dir, exist_ok=True)
    
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    backup_file = f"{backup_dir}/backup_{timestamp}.sql"
    
    try:
        # PostgreSQL backup using pg_dump
        cmd = [
            "pg_dump",
            f"postgresql://{settings.postgres_user}:{settings.postgres_password}@{settings.postgres_host}:{settings.postgres_port}/{settings.postgres_db}",
            "-F", "c",  # Custom format
            "-f", backup_file,
            "-v"
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            logger.info(f"Database backup created: {backup_file}")
            
            # Upload to S3 if configured
            if settings.backup_s3_bucket:
                upload_to_s3(backup_file, timestamp)
            
            # Clean old backups
            cleanup_old_backups(backup_dir)
            
            return {"success": True, "file": backup_file, "size": os.path.getsize(backup_file)}
        else:
            logger.error(f"Backup failed: {result.stderr}")
            return {"success": False, "error": result.stderr}
            
    except Exception as e:
        logger.error(f"Backup error: {e}")
        return {"success": False, "error": str(e)}

def upload_to_s3(file_path: str, timestamp: str):
    """Upload backup to S3 bucket"""
    try:
        import boto3
        s3 = boto3.client(
            "s3",
            aws_access_key_id=settings.backup_s3_access_key,
            aws_secret_access_key=settings.backup_s3_secret_key,
            region_name=settings.backup_s3_region
        )
        
        key = f"backups/backup_{timestamp}.sql"
        s3.upload_file(file_path, settings.backup_s3_bucket, key)
        logger.info(f"Backup uploaded to S3: {key}")
    except Exception as e:
        logger.error(f"S3 upload failed: {e}")

def cleanup_old_backups(backup_dir: str):
    """Remove backups older than retention period"""
    import os
    from datetime import datetime, timedelta
    
    retention_days = settings.backup_retention_days
    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    
    for filename in os.listdir(backup_dir):
        if filename.startswith("backup_") and filename.endswith(".sql"):
            filepath = os.path.join(backup_dir, filename)
            mtime = datetime.fromtimestamp(os.path.getmtime(filepath))
            if mtime < cutoff:
                os.remove(filepath)
                logger.info(f"Removed old backup: {filename}")

@celery_app.task(name="tasks.update_tariff_cache")
def update_tariff_cache():
    """Update tariffs cache"""
    async def _update():
        async with AsyncSessionLocal() as db:
            from app.models import Tariff
            result = await db.execute(select(Tariff).where(Tariff.is_active == True))
            tariffs = result.scalars().all()
            
            tariffs_data = [
                {
                    "id": t.id,
                    "billing_tariff_id": t.billing_tariff_id,
                    "name": t.name,
                    "speed_mbps": t.speed_mbps,
                    "price": float(t.price),
                    "description": t.description,
                    "is_popular": t.is_popular
                }
                for t in tariffs
            ]
            await redis_cache.set("tariffs:list", tariffs_data, expire=3600)
            return len(tariffs)
    
    count = _run_async(_update())
    logger.info(f"Updated tariff cache with {count} tariffs")
    return count

@celery_app.task(name="tasks.send_pending_notifications")
def send_pending_notifications():
    """Send pending notifications from database"""
    async def _send():
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Notification).where(
                    and_(
        Notification.is_sent == False,
                        Notification.created_at <= datetime.utcnow() - timedelta(seconds=30)
                    )
                ).limit(100)
            )
            pending = result.scalars().all()

            if not pending:
                return {"processed": 0, "sent": 0, "failed": 0}

            user_ids = {notif.user_id for notif in pending}
            users_result = await db.execute(select(User).where(User.id.in_(user_ids)))
            users = {user.id: user for user in users_result.scalars().all()}

            processed = 0
            sent = 0

            for notif in pending:
                processed += 1
                try:
                    user = users.get(notif.user_id)
                    delivered = False

                    if notif.type == NotificationType.EMAIL:
                        if user and user.email:
                            delivered = await email_service.send_email(
                                user.email,
                                notif.title,
                                notif.body,
                            )
                        else:
                            logger.warning(
                                "Skipping email notification %s: user %s has no email",
                                notif.id,
                                notif.user_id,
                            )
                    elif notif.type == NotificationType.SMS:
                        if user and user.phone:
                            delivered = await sms_service.send_message(
                                user.phone,
                                notif.body[:160],
                            )
                        else:
                            logger.warning(
                                "Skipping SMS notification %s: user %s has no phone",
                                notif.id,
                                notif.user_id,
                            )
                    else:
                        logger.info(
                            "Notification %s has type %s and is stored for in-app delivery only",
                            notif.id,
                            getattr(notif.type, "value", str(notif.type)),
                        )
                        delivered = True

                    if delivered:
                        notif.is_sent = True
                        notif.sent_at = datetime.utcnow()
                        sent += 1
                    else:
                        logger.warning("Notification %s was not delivered", notif.id)
                except Exception as e:
                    logger.error(f"Failed to send notification {notif.id}: {e}")

            await db.commit()
            return {"processed": processed, "sent": sent, "failed": processed - sent}
    
    result = _run_async(_send())
    if result["processed"] > 0:
        logger.info(
            "Processed %s pending notifications, sent=%s failed=%s",
            result["processed"],
            result["sent"],
            result["failed"],
        )
    return result

@celery_app.task(name="tasks.process_payment", bind=True, max_retries=5)
def process_payment(self, payment_id: int, user_id: int, amount: float):
    """Process payment asynchronously"""
    from app.services.payment import YooKassaService
    from app.services.billing import BillingService
    
    try:
        # Create payment in YooKassa
        yk = YooKassaService()
        payment_url, external_id = _run_async(
            yk.create_payment(amount, f"Account top-up", str(payment_id))
        )
        
        if payment_url:
            # Update payment record with external_id
            async def _update():
                async with AsyncSessionLocal() as db:
                    from app.models import PaymentLog
                    result = await db.execute(select(PaymentLog).where(PaymentLog.id == payment_id))
                    payment = result.scalar_one()
                    payment.external_id = external_id
                    await db.commit()
            
            _run_async(_update())
            
            return {"success": True, "payment_url": payment_url, "external_id": external_id}
        else:
            raise Exception("Payment creation failed")
            
    except Exception as e:
        logger.error(f"Payment processing error: {e}")
        if self.request.retries < self.max_retries:
            raise self.retry(exc=e, countdown=60 * (self.request.retries + 1))
        
        # Mark payment as failed
        async def _mark_failed():
            async with AsyncSessionLocal() as db:
                from app.models import PaymentLog, PaymentStatus
                result = await db.execute(select(PaymentLog).where(PaymentLog.id == payment_id))
                payment = result.scalar_one()
                payment.status = PaymentStatus.FAILED
                await db.commit()
        
        _run_async(_mark_failed())
        return {"success": False, "error": str(e)}
