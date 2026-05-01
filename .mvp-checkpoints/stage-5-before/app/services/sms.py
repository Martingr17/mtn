from __future__ import annotations

import hashlib
import hmac
import logging
import random
import string
import time
from typing import Optional

import httpx
from fastapi import BackgroundTasks

from app.config import settings
from app.services.cache import redis_cache

logger = logging.getLogger(__name__)
_SMS_CODE_TTL_SECONDS = 300


def normalize_phone(phone: str) -> str:
    return "".join(filter(str.isdigit, str(phone or "")))


class SMSService:
    def __init__(self) -> None:
        self.provider = getattr(settings, "sms_provider", "mock")
        self.api_url = getattr(settings, "sms_api_url", "https://sms.ru/sms/send")
        self.api_key = getattr(settings, "sms_api_key", "")
        self.from_number = getattr(settings, "sms_from", "OPERATOR")
        self._client = httpx.AsyncClient(timeout=10.0)

    async def send_code(self, phone: str, code: str) -> bool:
        message = f"Код подтверждения: {code}"
        return await self.send_message(phone, message, log_code=code)

    async def send_message(self, phone: str, message: str, log_code: str | None = None) -> bool:
        clean_phone = normalize_phone(phone)

        if self.provider == "smsru" and self.api_key:
            return await self._send_smsru(clean_phone, message)

        logger.info("[MOCK SMS] phone=%s code=%s message=%s", clean_phone, log_code or "-", message)
        return True

    async def _send_smsru(self, phone: str, message: str) -> bool:
        try:
            response = await self._client.post(
                self.api_url,
                data={
                    "api_id": self.api_key,
                    "to": phone,
                    "msg": message,
                    "json": 1,
                },
            )
            payload = response.json()
            return payload.get("status") == "OK"
        except Exception as exc:
            logger.error("Ошибка SMS-шлюза: %s", exc)
            return False

    async def close(self) -> None:
        await self._client.aclose()


sms_service = SMSService()


def _stateless_demo_sms_code(phone: str, timestamp: Optional[int] = None) -> str:
    clean_phone = normalize_phone(phone)
    current_ts = int(timestamp or time.time())
    slot = current_ts // _SMS_CODE_TTL_SECONDS
    secret = (settings.secret_key or settings.jwt_secret_key or "mtn-demo-sms").encode("utf-8")
    payload = f"{clean_phone}:{slot}".encode()
    digest = hmac.new(secret, payload, hashlib.sha256).digest()
    return f"{int.from_bytes(digest[:4], 'big') % 1000000:06d}"


async def send_sms_notification(phone: str, message: str) -> bool:
    return await sms_service.send_message(phone, message)


async def send_sms_code(phone: str, background_tasks: BackgroundTasks) -> Optional[str]:
    clean_phone = normalize_phone(phone)
    code = _stateless_demo_sms_code(clean_phone) if settings.demo_show_sms_code else "".join(random.choices(string.digits, k=6))

    if redis_cache.client:
        await redis_cache.set(f"sms_code:{clean_phone}", code, expire=300)

    background_tasks.add_task(sms_service.send_code, clean_phone, code)
    logger.info("Код %s поставлен в очередь для %s", code, clean_phone)

    if settings.demo_show_sms_code:
        return code
    return None


async def peek_sms_code(phone: str) -> Optional[str]:
    clean_phone = normalize_phone(phone)
    if not redis_cache.client:
        return None
    return await redis_cache.get(f"sms_code:{clean_phone}")


async def verify_sms_code(phone: str, code: str) -> bool:
    clean_phone = normalize_phone(phone)
    if redis_cache.client:
        stored = await redis_cache.get(f"sms_code:{clean_phone}")
        if stored == code:
            await redis_cache.delete(f"sms_code:{clean_phone}")
            return True

    if settings.demo_show_sms_code:
        current_code = _stateless_demo_sms_code(clean_phone)
        previous_code = _stateless_demo_sms_code(clean_phone, timestamp=int(time.time()) - _SMS_CODE_TTL_SECONDS)
        if code in {current_code, previous_code}:
            return True

    return False
