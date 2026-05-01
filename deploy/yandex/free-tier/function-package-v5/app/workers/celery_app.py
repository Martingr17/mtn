from celery import Celery
from celery.schedules import crontab
from app.config import settings
import logging

logger = logging.getLogger(__name__)

redis_base_url = settings.redis_url.rsplit("/", 1)[0]
broker_url = settings.celery_broker_url or f"{redis_base_url}/1"
result_backend = settings.celery_result_backend or f"{redis_base_url}/2"

celery_app = Celery(
    "operator_app",
    broker=broker_url,
    backend=result_backend
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone=settings.celery_timezone,
    enable_utc=settings.celery_enable_utc,
    task_track_started=True,
    task_time_limit=30 * 60,  # 30 minutes
    task_soft_time_limit=25 * 60,  # 25 minutes
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=1000,
    broker_connection_retry_on_startup=True,
    
    # Result backend settings
    result_expires=3600,  # 1 hour
    result_compression="gzip",
    
    # Rate limits
    task_default_rate_limit="100/m",
    
    # Queues
    task_queues={
        "high_priority": {
            "exchange": "high_priority",
            "routing_key": "high_priority",
        },
        "default": {
            "exchange": "default",
            "routing_key": "default",
        },
        "low_priority": {
            "exchange": "low_priority",
            "routing_key": "low_priority",
        },
    },
    task_default_queue="default",
    task_default_routing_key="default",
    
    # Routing
    task_routes={
        "tasks.send_email": {"queue": "high_priority"},
        "tasks.send_sms": {"queue": "high_priority"},
        "tasks.process_payment": {"queue": "high_priority"},
        "tasks.escalate_unanswered_tickets": {"queue": "high_priority"},
        "tasks.evaluate_monitoring_alerts": {"queue": "high_priority"},
        "tasks.collect_monitoring_metrics": {"queue": "default"},
        "tasks.generate_report": {"queue": "low_priority"},
        "tasks.cleanup_old_logs": {"queue": "low_priority"},
        "tasks.close_stale_tickets": {"queue": "low_priority"},
        "tasks.cleanup_old_monitoring_data": {"queue": "low_priority"},
        "tasks.cleanup_old_notifications": {"queue": "low_priority"},
    }
)

# Beat schedule for periodic tasks
celery_app.conf.beat_schedule = {
    "cleanup-expired-sessions": {
        "task": "tasks.cleanup_expired_sessions",
        "schedule": crontab(hour=3, minute=0),
    },
    "cleanup-old-logs": {
        "task": "tasks.cleanup_old_logs",
        "schedule": crontab(hour=2, minute=0, day_of_month=1),
    },
    "close-stale-tickets": {
        "task": "tasks.close_stale_tickets",
        "schedule": crontab(hour=2, minute=0),
    },
    "escalate-unanswered-tickets": {
        "task": "tasks.escalate_unanswered_tickets",
        "schedule": crontab(minute="*/15"),
    },
    "collect-monitoring-metrics": {
        "task": "tasks.collect_monitoring_metrics",
        "schedule": crontab(minute="*/5"),
    },
    "evaluate-monitoring-alerts": {
        "task": "tasks.evaluate_monitoring_alerts",
        "schedule": crontab(minute="*/5"),
    },
    "cleanup-old-monitoring-data": {
        "task": "tasks.cleanup_old_monitoring_data",
        "schedule": crontab(hour=3, minute=20),
    },
    "cleanup-old-notifications": {
        "task": "tasks.cleanup_old_notifications",
        "schedule": crontab(hour=3, minute=0),
    },
    "send-daily-summary": {
        "task": "tasks.send_daily_summary",
        "schedule": crontab(hour=20, minute=0),
    },
    "backup-database": {
        "task": "tasks.backup_database",
        "schedule": crontab(hour=2, minute=0),
    },
    "update-tariff-cache": {
        "task": "tasks.update_tariff_cache",
        "schedule": crontab(hour="*/6"),
    },
    "send-pending-notifications": {
        "task": "tasks.send_pending_notifications",
        "schedule": crontab(minute="*/5"),
    },
}

celery_app.autodiscover_tasks(["app.workers.tasks"])
