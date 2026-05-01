from __future__ import annotations

import hashlib
import hmac
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.logger import log_activity
from app.database import get_db
from app.models import PaymentLog, PaymentStatus, User
from app.services.payment_runtime import mark_payment_status, mark_payment_succeeded
from app.services.websocket_manager import websocket_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook", tags=["webhooks"])


def _verify_yookassa_signature(body: bytes, signature: str) -> bool:
    if settings.demo_mode and not settings.ykassa_webhook_secret:
        return True
    if not settings.ykassa_webhook_secret:
        return True
    if not signature:
        return False
    digest = hmac.new(settings.ykassa_webhook_secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, signature.strip())


async def _resolve_payment(db: AsyncSession, payload: dict) -> PaymentLog | None:
    obj = payload.get("object") or {}
    metadata = obj.get("metadata") or {}
    payment_log_id = metadata.get("payment_log_id") or metadata.get("payment_id")
    external_id = obj.get("id")

    if payment_log_id:
        result = await db.execute(select(PaymentLog).where(PaymentLog.id == int(payment_log_id)))
        payment = result.scalar_one_or_none()
        if payment:
            return payment

    if external_id:
        result = await db.execute(select(PaymentLog).where(PaymentLog.external_id == external_id))
        return result.scalar_one_or_none()

    return None


async def _resolve_user(db: AsyncSession, payment_log: PaymentLog) -> User | None:
    result = await db.execute(select(User).where(User.id == payment_log.user_id))
    return result.scalar_one_or_none()


async def _handle_payment_event(db: AsyncSession, payload: dict) -> dict:
    event = str(payload.get("event") or "")
    payment_log = await _resolve_payment(db, payload)
    if not payment_log:
        logger.warning("Webhook payment not found for payload: %s", json.dumps(payload, ensure_ascii=False))
        return {"status": "ignored", "reason": "payment_not_found"}

    user = await _resolve_user(db, payment_log)
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь платежа не найден")

    obj = payload.get("object") or {}
    amount = float((obj.get("amount") or {}).get("value") or payment_log.amount or 0)
    external_id = obj.get("id")

    if event == "payment.succeeded":
        result = await mark_payment_succeeded(
            db=db,
            payment_log=payment_log,
            source="yookassa_webhook",
            amount=amount,
            user=user,
            gateway_payload=payload,
        )
        await log_activity(
            db,
            user.id,
            "payment_success",
            None,
            "yookassa-webhook",
            extra={"payment_id": payment_log.id, "external_id": external_id, "already_processed": result["already_processed"]},
        )
        return {"status": "ok", "event": event}

    if event in {"payment.waiting_for_capture", "payment.pending"}:
        await mark_payment_status(
            db=db,
            payment_log=payment_log,
            target_status=PaymentStatus.PROCESSING,
            source="yookassa_webhook",
            gateway_payload=payload,
            external_id=external_id,
        )
        return {"status": "ok", "event": event}

    if event in {"payment.canceled", "payment.cancelled"}:
        await mark_payment_status(
            db=db,
            payment_log=payment_log,
            target_status=PaymentStatus.CANCELLED,
            source="yookassa_webhook",
            gateway_payload=payload,
            external_id=external_id,
        )
        await websocket_manager.notify_payment_status(user.id, payment_log.id, "cancelled", amount)
        await log_activity(
            db,
            user.id,
            "payment_fail",
            None,
            "yookassa-webhook",
            extra={"payment_id": payment_log.id, "external_id": external_id, "status": "cancelled"},
        )
        return {"status": "ok", "event": event}

    if event == "refund.succeeded":
        await mark_payment_status(
            db=db,
            payment_log=payment_log,
            target_status=PaymentStatus.REFUNDED,
            source="yookassa_webhook",
            gateway_payload=payload,
            external_id=external_id,
        )
        return {"status": "ok", "event": event}

    return {"status": "ignored", "event": event}


@router.post("/yookassa")
@router.post("/payment")
async def payment_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    body = await request.body()
    signature = request.headers.get("X-Content-SHA256", "")

    if not _verify_yookassa_signature(body, signature):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook signature")

    try:
        payload = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook payload") from exc

    try:
        return await _handle_payment_event(db, payload)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Webhook processing failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
