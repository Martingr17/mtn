import logging
import uuid
from typing import Any, Dict, Optional

import httpx
from yookassa import Configuration, Payment, Refund

from app.config import settings
from app.core.exceptions import PaymentException

logger = logging.getLogger(__name__)


class YooKassaService:
    def __init__(self):
        self._base_public_url = settings.public_app_url.rstrip("/")
        self._has_yookassa_credentials = bool(settings.ykassa_shop_id and settings.ykassa_secret_key)
        self._has_stripe_credentials = bool(settings.stripe_secret_key)

        if self._has_yookassa_credentials:
            Configuration.account_id = settings.ykassa_shop_id
            Configuration.secret_key = settings.ykassa_secret_key

    def _demo_checkout_url(self, payment_id: str) -> str:
        return f"{self._base_public_url}/payments/checkout/{payment_id}"

    def _success_return_url(self, payment_id: str) -> str:
        return f"{self._base_public_url}/payments/success?payment_id={payment_id}"

    def _cancel_return_url(self, payment_id: str) -> str:
        return f"{self._base_public_url}/payments?payment_id={payment_id}&cancelled=1"

    async def _create_stripe_checkout(
        self,
        *,
        amount: float,
        description: str,
        payment_id: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> tuple[str, str]:
        payload = {
            "mode": "payment",
            "success_url": f"{self._success_return_url(payment_id)}&session_id={{CHECKOUT_SESSION_ID}}",
            "cancel_url": self._cancel_return_url(payment_id),
            "payment_method_types[0]": "card",
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]": "rub",
            "line_items[0][price_data][unit_amount]": str(max(int(round(amount * 100)), 100)),
            "line_items[0][price_data][product_data][name]": description[:120],
            "metadata[payment_id]": payment_id,
        }

        for key, value in (metadata or {}).items():
            payload[f"metadata[{key}]"] = str(value)

        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                "https://api.stripe.com/v1/checkout/sessions",
                headers={"Authorization": f"Bearer {settings.stripe_secret_key}"},
                data=payload,
            )
            response.raise_for_status()
            data = response.json()

        checkout_url = data.get("url")
        session_id = data.get("id")
        if not checkout_url or not session_id:
            raise PaymentException(detail="Stripe Checkout не вернул URL сессии")

        return checkout_url, session_id

    async def create_payment(
        self,
        amount: float,
        description: str,
        payment_id: str,
        payment_method: str = "bank_card",
        return_url: str = None,
        metadata: Dict[str, Any] = None,
    ) -> tuple[Optional[str], Optional[str]]:
        """Create payment in a configured gateway or return a safe demo checkout URL."""
        if self._has_stripe_credentials:
            try:
                return await self._create_stripe_checkout(
                    amount=amount,
                    description=description,
                    payment_id=payment_id,
                    metadata=metadata,
                )
            except Exception as exc:
                logger.error("Stripe checkout creation failed: %s", exc)
                if not settings.demo_mode:
                    raise PaymentException(detail=f"Stripe error: {exc!s}")

        if settings.demo_mode or not self._has_yookassa_credentials:
            return self._demo_checkout_url(payment_id), f"demo-{payment_id}"

        try:
            idempotence_key = str(uuid.uuid4())
            payment_data = {
                "amount": {
                    "value": f"{amount:.2f}",
                    "currency": "RUB",
                },
                "confirmation": {
                    "type": "redirect",
                    "return_url": return_url or self._success_return_url(payment_id),
                },
                "description": description,
                "metadata": {
                    "payment_id": payment_id,
                    "payment_log_id": payment_id,
                    **(metadata or {}),
                },
                "capture": True,
            }

            if payment_method:
                payment_data["payment_method_data"] = {"type": payment_method}

            payment = Payment.create(payment_data, idempotence_key)
            return payment.confirmation.confirmation_url, payment.id
        except Exception as exc:
            logger.error("YooKassa payment creation failed: %s", exc)
            raise PaymentException(detail=f"Payment gateway error: {exc!s}")

    async def get_payment_info(self, payment_id: str) -> Optional[Dict[str, Any]]:
        if payment_id.startswith("demo-"):
            return {
                "id": payment_id,
                "status": "pending",
                "amount": None,
                "paid": False,
                "created_at": None,
                "captured_at": None,
                "provider": "demo",
            }

        if payment_id.startswith("cs_"):
            try:
                async with httpx.AsyncClient(timeout=20) as client:
                    response = await client.get(
                        f"https://api.stripe.com/v1/checkout/sessions/{payment_id}",
                        headers={"Authorization": f"Bearer {settings.stripe_secret_key}"},
                    )
                    response.raise_for_status()
                    data = response.json()

                payment_status = data.get("payment_status") or "unpaid"
                session_status = data.get("status") or "open"
                normalized_status = "succeeded" if payment_status == "paid" else ("cancelled" if session_status == "expired" else "pending")
                amount_total = data.get("amount_total")
                return {
                    "id": data.get("id"),
                    "status": normalized_status,
                    "amount": float(amount_total) / 100 if amount_total is not None else None,
                    "paid": payment_status == "paid",
                    "created_at": data.get("created"),
                    "captured_at": data.get("created"),
                    "provider": "stripe",
                    "raw": data,
                }
            except Exception as exc:
                logger.error("Failed to get Stripe checkout info: %s", exc)
                return None

        try:
            payment = Payment.find_one(payment_id)
            return {
                "id": payment.id,
                "status": payment.status,
                "amount": float(payment.amount.value),
                "paid": payment.paid,
                "created_at": payment.created_at,
                "captured_at": payment.captured_at,
                "provider": "yookassa",
                "raw": {
                    "status": payment.status,
                    "paid": payment.paid,
                },
            }
        except Exception as exc:
            logger.error("Failed to get payment info: %s", exc)
            return None

    async def capture_payment(self, payment_id: str, amount: float = None) -> bool:
        if payment_id.startswith("demo-"):
            return True

        try:
            if amount:
                payment = Payment.capture(payment_id, {"amount": {"value": f"{amount:.2f}", "currency": "RUB"}})
            else:
                payment = Payment.capture(payment_id)
            return payment.status == "succeeded"
        except Exception as exc:
            logger.error("Payment capture failed: %s", exc)
            return False

    async def refund_payment(self, payment_id: str, amount: float, reason: str = "Customer request") -> bool:
        if payment_id.startswith("demo-"):
            return True

        try:
            idempotence_key = str(uuid.uuid4())
            refund = Refund.create(
                {
                    "payment_id": payment_id,
                    "amount": {"value": f"{amount:.2f}", "currency": "RUB"},
                    "description": reason,
                },
                idempotence_key,
            )
            return refund.status == "succeeded"
        except Exception as exc:
            logger.error("Payment refund failed: %s", exc)
            return False
