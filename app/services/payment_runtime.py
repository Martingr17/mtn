from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import CacheKeys, PaymentStatus
from app.models import PaymentLog, User
from app.services.billing import BillingService
from app.services.cache import cache_delete
from app.services.websocket_manager import websocket_manager


def detect_payment_provider(external_id: str | None, gateway_response: dict[str, Any] | None = None) -> str:
    provider = str((gateway_response or {}).get("provider") or "").strip().lower()
    if provider:
        return provider
    if not external_id:
        return "demo"
    if str(external_id).startswith("demo-"):
        return "demo"
    if str(external_id).startswith("cs_") or str(external_id).startswith("stripe_"):
        return "stripe"
    if str(external_id).startswith("yk_"):
        return "yookassa"
    return "gateway"


def merge_gateway_response(payment_log: PaymentLog, **updates: Any) -> dict[str, Any]:
    payload = dict(payment_log.gateway_response or {})
    payload.update({key: value for key, value in updates.items() if value is not None})
    payment_log.gateway_response = payload
    return payload


def serialize_payment(payment_log: PaymentLog) -> dict[str, Any]:
    gateway_response = dict(payment_log.gateway_response or {})
    provider = detect_payment_provider(payment_log.external_id, gateway_response)
    billing_applied = bool(gateway_response.get("billing_applied"))
    return {
        "id": str(payment_log.id),
        "user_id": str(payment_log.user_id),
        "amount": payment_log.amount,
        "fee_amount": payment_log.fee_amount,
        "net_amount": payment_log.net_amount,
        "payment_method": payment_log.payment_method,
        "payment_type": payment_log.payment_type,
        "status": payment_log.status,
        "external_id": payment_log.external_id,
        "payment_url": payment_log.payment_url,
        "description": payment_log.description,
        "created_at": payment_log.created_at,
        "completed_at": payment_log.completed_at,
        "provider": provider,
        "can_retry": payment_log.status in {PaymentStatus.PENDING, PaymentStatus.FAILED, PaymentStatus.CANCELLED},
        "billing_applied": billing_applied,
    }


async def resolve_payment_user(db: AsyncSession, payment_log: PaymentLog) -> User | None:
    result = await db.execute(select(User).where(User.id == payment_log.user_id))
    return result.scalar_one_or_none()


async def mark_payment_succeeded(
    *,
    db: AsyncSession,
    payment_log: PaymentLog,
    source: str,
    amount: float | Decimal | None = None,
    user: User | None = None,
    gateway_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    user = user or await resolve_payment_user(db, payment_log)
    if not user:
        raise ValueError("Payment owner not found")

    effective_amount = Decimal(str(amount if amount is not None else payment_log.amount or 0))
    gateway_response = dict(payment_log.gateway_response or {})
    if payment_log.status == PaymentStatus.SUCCEEDED and gateway_response.get("billing_applied"):
        return {
            "already_processed": True,
            "user": user,
            "amount": float(effective_amount),
            "payment": payment_log,
        }

    billing = BillingService()
    billing_result = await billing.add_payment(user.billing_id, float(effective_amount), payment_id=str(payment_log.id))

    payment_log.status = PaymentStatus.SUCCEEDED
    payment_log.completed_at = payment_log.completed_at or datetime.utcnow()
    merge_gateway_response(
        payment_log,
        billing_applied=True,
        billing_applied_at=datetime.utcnow().isoformat(),
        billing_result=billing_result,
        success_source=source,
        last_gateway_payload=gateway_payload,
    )
    await db.commit()
    await cache_delete(CacheKeys.user_balance_key(user.id))
    await websocket_manager.notify_payment_status(user.id, payment_log.id, "succeeded", float(effective_amount))

    return {
        "already_processed": False,
        "user": user,
        "amount": float(effective_amount),
        "billing_result": billing_result,
        "payment": payment_log,
    }


async def mark_payment_status(
    *,
    db: AsyncSession,
    payment_log: PaymentLog,
    target_status: PaymentStatus,
    source: str,
    gateway_payload: dict[str, Any] | None = None,
    external_id: str | None = None,
) -> PaymentLog:
    payment_log.status = target_status
    if target_status in {PaymentStatus.CANCELLED, PaymentStatus.FAILED, PaymentStatus.REFUNDED}:
        payment_log.completed_at = payment_log.completed_at or datetime.utcnow()
    if external_id:
        payment_log.external_id = external_id
    merge_gateway_response(
        payment_log,
        last_status_source=source,
        last_gateway_payload=gateway_payload,
    )
    await db.commit()
    return payment_log
