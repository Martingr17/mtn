import logging
import ipaddress
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import ActionType
from app.core.logging_config import setup_logging
from app.models.activity import ActivityLog


logger = logging.getLogger(__name__)


def log_middleware(message: str, **extra: Any) -> None:
    if extra:
        logger.info("%s | %s", message, extra)
    else:
        logger.info(message)


async def log_activity(
    db: AsyncSession,
    user_id: Optional[int],
    action: str,
    ip_address: str,
    user_agent: str,
    extra: Optional[dict[str, Any]] = None,
) -> None:
    action_type = ActionType(action) if action in ActionType._value2member_map_ else None
    payload = extra or {}
    safe_ip = ip_address or "127.0.0.1"

    try:
        safe_ip = str(ipaddress.ip_address(safe_ip))
    except ValueError:
        safe_ip = "127.0.0.1"

    activity = ActivityLog(
        user_id=user_id,
        action=action,
        action_type=action_type,
        ip_address=safe_ip,
        user_agent=user_agent,
        resource_type=payload.get("resource_type"),
        resource_id=payload.get("resource_id") or payload.get("ticket_id") or payload.get("payment_id"),
        new_value=payload,
        status=payload.get("status", "success"),
        error_message=payload.get("error_message"),
    )

    db.add(activity)
    await db.flush()
