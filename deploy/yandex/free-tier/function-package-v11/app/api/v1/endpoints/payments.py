from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import CacheKeys, PaymentStatus
from app.core.logger import log_activity
from app.database import get_db
from app.dependencies import get_current_user
from app.models import PaymentLog, PaymentMethod, User
from app.schemas.payment import (
    PaymentCreateRequest,
    PaymentMethodCreateRequest,
    PaymentMethodResponse,
    PaymentResponse,
    RefundRequest,
)
from app.services.billing import BillingService
from app.services.cache import cache_delete
from app.services.payment import YooKassaService
from app.services.payment_runtime import (
    detect_payment_provider,
    mark_payment_status,
    mark_payment_succeeded,
    merge_gateway_response,
    serialize_payment,
)
from app.services.websocket_manager import websocket_manager
from app.utils.statement_pdf import build_statement_pdf

router = APIRouter(prefix="/payments", tags=["payments"])

MIN_PAYMENT_AMOUNT = Decimal("10")
MAX_PAYMENT_AMOUNT = Decimal("100000")


def _normalize_gateway_status(payload: dict | None) -> str:
    if not payload:
        return "unknown"
    status_value = str(payload.get("status") or "").strip().lower()
    if status_value in {"succeeded", "paid"} or payload.get("paid") is True:
        return "succeeded"
    if status_value in {"canceled", "cancelled", "expired"}:
        return "cancelled"
    if status_value in {"failed"}:
        return "failed"
    if status_value in {"waiting_for_capture", "processing"}:
        return "processing"
    if status_value in {"open", "pending", "unpaid"}:
        return "pending"
    return status_value or "unknown"


async def _get_user_payment(db: AsyncSession, payment_id: int, user_id: int) -> PaymentLog | None:
    result = await db.execute(select(PaymentLog).where(PaymentLog.id == payment_id, PaymentLog.user_id == user_id))
    return result.scalar_one_or_none()


async def _sync_payment_from_gateway(
    *,
    db: AsyncSession,
    payment: PaymentLog,
    current_user: User,
    source: str,
) -> PaymentLog:
    if not payment.external_id:
        return payment

    gateway = YooKassaService()
    gateway_info = await gateway.get_payment_info(payment.external_id)
    if not gateway_info:
        raise HTTPException(status_code=502, detail="Не удалось получить статус операции у платёжного провайдера")

    normalized_status = _normalize_gateway_status(gateway_info)
    provider = detect_payment_provider(payment.external_id, payment.gateway_response or gateway_info)

    if normalized_status == "succeeded":
        amount = gateway_info.get("amount") or float(payment.amount or 0)
        sync_result = await mark_payment_succeeded(
            db=db,
            payment_log=payment,
            source=source,
            amount=amount,
            user=current_user,
            gateway_payload=gateway_info,
        )
        await log_activity(
            db,
            current_user.id,
            "payment_success",
            None,
            f"{provider}-sync",
            extra={"payment_id": payment.id, "provider": provider, "already_processed": sync_result["already_processed"]},
        )
        return sync_result["payment"]

    if normalized_status == "cancelled":
        await mark_payment_status(
            db=db,
            payment_log=payment,
            target_status=PaymentStatus.CANCELLED,
            source=source,
            gateway_payload=gateway_info,
        )
        await websocket_manager.notify_payment_status(current_user.id, payment.id, "cancelled", float(payment.amount or 0))
        await log_activity(
            db,
            current_user.id,
            "payment_fail",
            None,
            f"{provider}-sync",
            extra={"payment_id": payment.id, "provider": provider, "status": "cancelled"},
        )
        return payment

    if normalized_status == "failed":
        await mark_payment_status(
            db=db,
            payment_log=payment,
            target_status=PaymentStatus.FAILED,
            source=source,
            gateway_payload=gateway_info,
        )
        await websocket_manager.notify_payment_status(current_user.id, payment.id, "failed", float(payment.amount or 0))
        await log_activity(
            db,
            current_user.id,
            "payment_fail",
            None,
            f"{provider}-sync",
            extra={"payment_id": payment.id, "provider": provider, "status": "failed"},
        )
        return payment

    if normalized_status == "processing":
        await mark_payment_status(
            db=db,
            payment_log=payment,
            target_status=PaymentStatus.PROCESSING,
            source=source,
            gateway_payload=gateway_info,
        )
        return payment

    await mark_payment_status(
        db=db,
        payment_log=payment,
        target_status=PaymentStatus.PENDING,
        source=source,
        gateway_payload=gateway_info,
    )
    return payment


@router.post("/create", response_model=dict)
async def create_payment(
    request: Request,
    payment_data: PaymentCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Создать новый платёж и вернуть URL checkout-сценария."""

    amount = Decimal(str(payment_data.amount))
    if amount < MIN_PAYMENT_AMOUNT:
        raise HTTPException(status_code=400, detail="Минимальная сумма пополнения — 10 ₽")
    if amount > MAX_PAYMENT_AMOUNT:
        raise HTTPException(status_code=400, detail="Максимальная сумма платежа — 100 000 ₽")

    payment_log = PaymentLog(
        user_id=current_user.id,
        amount=amount,
        fee_amount=Decimal("0"),
        net_amount=amount,
        payment_method=payment_data.payment_method,
        payment_type="topup",
        status=PaymentStatus.PENDING,
        description=f"Пополнение лицевого счёта {current_user.billing_id}",
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", ""),
    )
    db.add(payment_log)
    await db.flush()
    await db.refresh(payment_log)

    gateway = YooKassaService()

    try:
        payment_url, external_id = await gateway.create_payment(
            amount=float(amount),
            description=payment_log.description or "Пополнение баланса",
            payment_id=str(payment_log.id),
            payment_method=payment_data.payment_method,
            metadata={
                "user_id": current_user.id,
                "billing_id": current_user.billing_id,
                "payment_log_id": payment_log.id,
            },
        )

        if not external_id:
            raise RuntimeError("Платёжный сервис не вернул идентификатор операции")

        provider = detect_payment_provider(external_id)
        payment_log.external_id = external_id
        payment_log.payment_url = payment_url
        merge_gateway_response(
            payment_log,
            provider=provider,
            created_at=datetime.utcnow().isoformat(),
            billing_applied=False,
            checkout_url=payment_url,
        )
        await db.commit()

        await log_activity(
            db,
            current_user.id,
            "payment_create",
            request.client.host if request.client else None,
            request.headers.get("user-agent", ""),
            extra={"amount": str(amount), "payment_id": payment_log.id, "provider": provider},
        )

        return {
            "payment_id": payment_log.id,
            "payment_url": payment_url,
            "redirect_url": payment_url,
            "amount": float(amount),
            "status": "pending",
            "provider": provider,
        }
    except Exception as exc:
        await mark_payment_status(
            db=db,
            payment_log=payment_log,
            target_status=PaymentStatus.FAILED,
            source="create_payment_error",
            gateway_payload={"error": str(exc)},
        )
        raise HTTPException(status_code=502, detail=f"Ошибка платёжного шлюза: {str(exc)}") from exc


@router.post("/{payment_id}/confirm-demo", response_model=dict)
async def confirm_demo_payment(
    payment_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Подтвердить demo-платёж и начислить средства на баланс."""

    payment = await _get_user_payment(db, payment_id, current_user.id)
    if not payment:
        raise HTTPException(status_code=404, detail="Платёж не найден")

    provider = detect_payment_provider(payment.external_id, payment.gateway_response or {})
    if provider != "demo":
        raise HTTPException(status_code=400, detail="Ручное подтверждение доступно только для demo checkout")

    if payment.status == PaymentStatus.SUCCEEDED and (payment.gateway_response or {}).get("billing_applied"):
        return {
            "message": "Платёж уже подтверждён",
            "status": "succeeded",
            "redirect_url": "/payments?payment=success",
        }

    if payment.status not in {PaymentStatus.PENDING, PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED}:
        raise HTTPException(status_code=400, detail="Подтверждение доступно только для ожидающих платежей")

    sync_result = await mark_payment_succeeded(
        db=db,
        payment_log=payment,
        source="demo_checkout",
        amount=float(payment.amount),
        user=current_user,
        gateway_payload={"provider": "demo", "confirmed_by": "checkout_page"},
    )

    await log_activity(
        db,
        current_user.id,
        "payment_success",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"payment_id": payment.id, "amount": str(payment.amount), "provider": "demo"},
    )

    return {
        "message": "Баланс успешно пополнен",
        "status": "succeeded",
        "balance": sync_result.get("billing_result", {}).get("balance"),
        "redirect_url": "/payments?payment=success",
    }


@router.post("/{payment_id}/refresh", response_model=PaymentResponse)
async def refresh_payment_status(
    payment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Запросить актуальный статус операции у платёжного провайдера."""

    payment = await _get_user_payment(db, payment_id, current_user.id)
    if not payment:
        raise HTTPException(status_code=404, detail="Платёж не найден")

    payment = await _sync_payment_from_gateway(
        db=db,
        payment=payment,
        current_user=current_user,
        source="manual_refresh",
    )
    return PaymentResponse.model_validate(serialize_payment(payment))


@router.post("/{payment_id}/retry", response_model=dict)
async def retry_payment(
    payment_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Сформировать новый checkout URL для незавершённого платежа."""

    payment = await _get_user_payment(db, payment_id, current_user.id)
    if not payment:
        raise HTTPException(status_code=404, detail="Платёж не найден")
    if payment.status == PaymentStatus.SUCCEEDED and (payment.gateway_response or {}).get("billing_applied"):
        raise HTTPException(status_code=400, detail="Успешный платёж нельзя перезапустить")

    gateway = YooKassaService()
    payment_url, external_id = await gateway.create_payment(
        amount=float(payment.amount),
        description=payment.description or f"Пополнение лицевого счёта {current_user.billing_id}",
        payment_id=str(payment.id),
        payment_method=payment.payment_method or "bank_card",
        metadata={
            "user_id": current_user.id,
            "billing_id": current_user.billing_id,
            "payment_log_id": payment.id,
        },
    )
    provider = detect_payment_provider(external_id)
    payment.status = PaymentStatus.PENDING
    payment.completed_at = None
    payment.external_id = external_id
    payment.payment_url = payment_url
    merge_gateway_response(
        payment,
        provider=provider,
        retried_at=datetime.utcnow().isoformat(),
        billing_applied=False,
        checkout_url=payment_url,
    )
    await db.commit()

    await log_activity(
        db,
        current_user.id,
        "payment_retry",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"payment_id": payment.id, "provider": provider},
    )
    return {
        "payment_id": payment.id,
        "payment_url": payment_url,
        "redirect_url": payment_url,
        "provider": provider,
        "status": "pending",
    }


@router.get("/history", response_model=List[PaymentResponse])
async def payment_history(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = 50,
    offset: int = 0,
    status_filter: Optional[str] = None,
):
    """История платежей пользователя."""

    query = select(PaymentLog).where(PaymentLog.user_id == current_user.id)
    if status_filter:
        query = query.where(PaymentLog.status == status_filter)

    query = query.order_by(desc(PaymentLog.created_at)).offset(offset).limit(limit)
    payments = (await db.execute(query)).scalars().all()
    return [PaymentResponse.model_validate(serialize_payment(payment)) for payment in payments]


@router.get("/statement/pdf")
async def download_payment_statement_pdf(
    year: Optional[int] = Query(None, ge=2020, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a simple PDF statement for the selected period."""

    query = select(PaymentLog).where(PaymentLog.user_id == current_user.id).order_by(PaymentLog.created_at.desc())
    payments = (await db.execute(query)).scalars().all()

    if year and month:
        payments = [
            item
            for item in payments
            if item.created_at and item.created_at.year == year and item.created_at.month == month
        ]

    if not payments:
        raise HTTPException(status_code=404, detail="Нет операций за выбранный период")

    period_label = f"{month:02d}.{year}" if year and month else "весь период"
    lines = [
        f"Абонент: {current_user.phone}",
        f"Лицевой счёт: {current_user.billing_id}",
        f"Период: {period_label}",
        "",
    ]

    total_in = Decimal("0")
    for payment in reversed(payments):
        amount = Decimal(payment.amount or 0)
        total_in += amount
        created_at = payment.created_at.strftime("%d.%m.%Y %H:%M") if payment.created_at else "—"
        method = payment.payment_method or "не указан"
        status_value = payment.status.value if hasattr(payment.status, "value") else str(payment.status)
        lines.append(f"{created_at} | {amount:.2f} ₽ | {method} | {status_value} | ID {payment.id}")

    lines.extend(["", f"Итого пополнений: {total_in:.2f} ₽"])
    pdf_bytes = build_statement_pdf("Выписка по операциям MTN", lines)
    filename = f"payment_statement_{current_user.id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{payment_id}", response_model=PaymentResponse)
async def get_payment(
    payment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Получить детали конкретного платежа."""

    payment = await _get_user_payment(db, payment_id, current_user.id)
    if not payment:
        raise HTTPException(status_code=404, detail="Платёж не найден")
    return PaymentResponse.model_validate(serialize_payment(payment))


@router.post("/methods", response_model=PaymentMethodResponse)
async def save_payment_method(
    request: Request,
    method_data: PaymentMethodCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Сохранить способ оплаты."""

    if method_data.is_default:
        result = await db.execute(select(PaymentMethod).where(PaymentMethod.user_id == current_user.id))
        for payment_method in result.scalars().all():
            payment_method.is_default = False

    payment_method = PaymentMethod(
        user_id=current_user.id,
        method_type=method_data.method_type,
        token=method_data.token,
        masked_pan=method_data.masked_pan,
        card_type=method_data.card_type,
        expiry_month=method_data.expiry_month,
        expiry_year=method_data.expiry_year,
        is_default=method_data.is_default,
        is_active=True,
    )
    db.add(payment_method)
    await db.commit()
    await db.refresh(payment_method)

    await log_activity(
        db,
        current_user.id,
        "save_payment_method",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
    )
    return PaymentMethodResponse.model_validate(payment_method)


@router.get("/methods", response_model=List[PaymentMethodResponse])
async def get_payment_methods(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Получить сохранённые способы оплаты."""

    result = await db.execute(
        select(PaymentMethod)
        .where(PaymentMethod.user_id == current_user.id, PaymentMethod.is_active == True)
        .order_by(PaymentMethod.is_default.desc())
    )
    methods = result.scalars().all()
    return [PaymentMethodResponse.model_validate(method) for method in methods]


@router.delete("/methods/{method_id}")
async def delete_payment_method(
    method_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Удалить сохранённый способ оплаты."""

    result = await db.execute(select(PaymentMethod).where(PaymentMethod.id == method_id, PaymentMethod.user_id == current_user.id))
    method = result.scalar_one_or_none()
    if not method:
        raise HTTPException(status_code=404, detail="Способ оплаты не найден")

    method.is_active = False
    await db.commit()

    await log_activity(
        db,
        current_user.id,
        "delete_payment_method",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
    )
    return {"message": "Способ оплаты удалён"}


@router.post("/refund")
async def request_refund(
    request: Request,
    refund_data: RefundRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Запросить возврат по платежу."""

    result = await db.execute(
        select(PaymentLog).where(
            PaymentLog.id == refund_data.payment_id,
            PaymentLog.user_id == current_user.id,
            PaymentLog.status == PaymentStatus.SUCCEEDED,
        )
    )
    payment = result.scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Платёж не найден или недоступен для возврата")

    days_since = (datetime.utcnow() - payment.created_at).days
    if days_since > 30:
        raise HTTPException(status_code=400, detail="Срок возврата истёк (30 дней)")

    gateway = YooKassaService()
    success = await gateway.refund_payment(payment.external_id, float(refund_data.amount), refund_data.reason)
    if not success:
        raise HTTPException(status_code=502, detail="Не удалось обработать возврат")

    await mark_payment_status(
        db=db,
        payment_log=payment,
        target_status=PaymentStatus.REFUNDED,
        source="refund_request",
        gateway_payload={"reason": refund_data.reason, "amount": float(refund_data.amount)},
    )

    billing = BillingService()
    await billing.add_payment(current_user.billing_id, -float(refund_data.amount), payment_id=str(payment.id))
    await cache_delete(CacheKeys.user_balance_key(current_user.id))

    await log_activity(
        db,
        current_user.id,
        "payment_refund",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"payment_id": refund_data.payment_id, "amount": str(refund_data.amount)},
    )
    return {"message": "Возврат успешно оформлен"}
