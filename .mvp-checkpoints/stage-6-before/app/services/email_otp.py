from __future__ import annotations

import hashlib
import hmac
import logging
import math
import random
import string
import time
from dataclasses import dataclass
from datetime import datetime

from fastapi import BackgroundTasks, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.validators import Validators
from app.models import User
from app.services.cache import redis_cache
from app.services.email import send_verification_code_email

logger = logging.getLogger(__name__)
_SEND_WINDOW_SECONDS = 3600
_USER_OTP_SYSTEM_KEY = "__system_email_otp"
_USER_OTP_RECORDS_KEY = "email_otp_records"


@dataclass
class EmailOTPError(Exception):
    detail: str
    status_code: int
    retry_after: int | None = None


class EmailOTPService:
    def __init__(self) -> None:
        self.ttl_seconds = max(60, settings.email_otp_ttl_seconds)
        self.cooldown_seconds = max(0, settings.email_otp_resend_cooldown_seconds)
        self.max_attempts = max(1, settings.email_otp_max_attempts)
        self.max_sends_per_hour = max(1, settings.email_otp_max_sends_per_hour)
        self.code_length = min(max(4, settings.email_otp_length), 8)

    def normalize_email(self, email: str) -> str:
        return Validators.normalize_email(email)

    def mask_email(self, email: str) -> str:
        normalized = self.normalize_email(email)
        local_part, _, domain = normalized.partition("@")
        if not domain:
            return normalized

        if len(local_part) <= 2:
            masked_local = f"{local_part[:1]}***"
        else:
            masked_local = f"{local_part[:2]}***"

        return f"{masked_local}@{domain}"

    def _scope(self, purpose: str, email: str) -> str:
        normalized = self.normalize_email(email)
        return f"{purpose}:{normalized}"

    def _record_key(self, purpose: str, email: str) -> str:
        return f"email_otp:record:{self._scope(purpose, email)}"

    def _attempts_key(self, purpose: str, email: str) -> str:
        return f"email_otp:attempts:{self._scope(purpose, email)}"

    def _cooldown_key(self, purpose: str, email: str) -> str:
        return f"email_otp:cooldown:{self._scope(purpose, email)}"

    def _send_count_key(self, purpose: str, email: str) -> str:
        return f"email_otp:sends:{self._scope(purpose, email)}"

    def _hash_code(self, purpose: str, email: str, code: str) -> str:
        secret = (settings.secret_key or settings.jwt_secret_key or "mtn-email-otp").encode("utf-8")
        normalized = self.normalize_email(email)
        payload = f"{purpose}:{normalized}:{code}".encode("utf-8")
        return hmac.new(secret, payload, hashlib.sha256).hexdigest()

    def _current_ts(self) -> int:
        return int(time.time())

    def _load_user_record(self, user: User, purpose: str) -> tuple[dict, dict]:
        notification_settings = dict(user.notification_settings or {})
        system_payload = dict(notification_settings.get(_USER_OTP_SYSTEM_KEY) or {})
        records = dict(system_payload.get(_USER_OTP_RECORDS_KEY) or {})
        record = dict(records.get(purpose) or {})
        return notification_settings, record

    def _save_user_record(
        self,
        user: User,
        purpose: str,
        notification_settings: dict,
        record: dict | None,
    ) -> None:
        system_payload = dict(notification_settings.get(_USER_OTP_SYSTEM_KEY) or {})
        records = dict(system_payload.get(_USER_OTP_RECORDS_KEY) or {})

        if record:
            records[purpose] = record
        else:
            records.pop(purpose, None)

        if records:
            system_payload[_USER_OTP_RECORDS_KEY] = records
        else:
            system_payload.pop(_USER_OTP_RECORDS_KEY, None)

        if system_payload:
            notification_settings[_USER_OTP_SYSTEM_KEY] = system_payload
        else:
            notification_settings.pop(_USER_OTP_SYSTEM_KEY, None)

        user.notification_settings = notification_settings
        user.updated_at = datetime.utcnow()

    async def _persist_user(self, db: AsyncSession, user: User) -> None:
        db.add(user)
        await db.commit()
        await db.refresh(user)

    async def revoke_code(
        self,
        *,
        purpose: str,
        email: str,
        user: User | None = None,
        db: AsyncSession | None = None,
    ) -> None:
        if user is not None and db is not None:
            notification_settings, _ = self._load_user_record(user, purpose)
            self._save_user_record(user, purpose, notification_settings, None)
            await self._persist_user(db, user)
            return

        await redis_cache.delete(self._record_key(purpose, email))
        await redis_cache.delete(self._attempts_key(purpose, email))
        await redis_cache.delete(self._cooldown_key(purpose, email))

    async def issue_code(
        self,
        *,
        purpose: str,
        email: str,
        background_tasks: BackgroundTasks,
        user: User | None = None,
        db: AsyncSession | None = None,
    ) -> dict[str, int | str | None]:
        normalized = self.normalize_email(email)

        if user is not None and db is not None:
            now_ts = self._current_ts()
            notification_settings, current_record = self._load_user_record(user, purpose)

            cooldown_until = int(current_record.get("cooldown_until") or 0)
            cooldown_ttl = cooldown_until - now_ts
            if cooldown_ttl > 0:
                raise EmailOTPError(
                    detail=f"РќРѕРІС‹Р№ РєРѕРґ РјРѕР¶РЅРѕ Р·Р°РїСЂРѕСЃРёС‚СЊ С‡РµСЂРµР· {cooldown_ttl} СЃРµРє.",
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    retry_after=cooldown_ttl,
                )

            send_history = [
                int(sent_at)
                for sent_at in current_record.get("send_history", [])
                if int(sent_at) > now_ts - _SEND_WINDOW_SECONDS
            ]
            if len(send_history) >= self.max_sends_per_hour:
                retry_after = max(1, _SEND_WINDOW_SECONDS - (now_ts - send_history[0]))
                raise EmailOTPError(
                    detail="РЎР»РёС€РєРѕРј РјРЅРѕРіРѕ Р·Р°РїСЂРѕСЃРѕРІ РєРѕРґР°. РџРѕРїСЂРѕР±СѓР№С‚Рµ РїРѕР·Р¶Рµ.",
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    retry_after=retry_after,
                )

            code = "".join(random.choices(string.digits, k=self.code_length))
            send_history.append(now_ts)

            record = {
                "email": normalized,
                "code_hash": self._hash_code(purpose, normalized, code),
                "issued_at": now_ts,
                "expires_at": now_ts + self.ttl_seconds,
                "cooldown_until": now_ts + self.cooldown_seconds if self.cooldown_seconds else 0,
                "attempts": 0,
                "send_history": send_history,
            }
            self._save_user_record(user, purpose, notification_settings, record)
            await self._persist_user(db, user)

            background_tasks.add_task(
                send_verification_code_email,
                normalized,
                code,
                max(1, math.ceil(self.ttl_seconds / 60)),
            )
            logger.info("Queued persistent email OTP for user %s (%s)", user.id, purpose)

            return {
                "verification_target": self.mask_email(normalized),
                "expires_in": self.ttl_seconds,
                "resend_available_in": self.cooldown_seconds,
                "demo_code": code if settings.demo_show_email_code else None,
            }

        cooldown_key = self._cooldown_key(purpose, normalized)
        send_count_key = self._send_count_key(purpose, normalized)

        cooldown_ttl = await redis_cache.ttl(cooldown_key)
        if cooldown_ttl > 0:
            raise EmailOTPError(
                detail=f"Новый код можно запросить через {cooldown_ttl} сек.",
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                retry_after=cooldown_ttl,
            )

        sends_count = int(await redis_cache.get(send_count_key, 0) or 0)
        if sends_count >= self.max_sends_per_hour:
            retry_after = await redis_cache.ttl(send_count_key)
            raise EmailOTPError(
                detail="Слишком много запросов кода. Попробуйте позже.",
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                retry_after=retry_after if retry_after > 0 else None,
            )

        code = "".join(random.choices(string.digits, k=self.code_length))
        await redis_cache.set(
            self._record_key(purpose, normalized),
            {
                "email": normalized,
                "code_hash": self._hash_code(purpose, normalized, code),
            },
            expire=self.ttl_seconds,
        )
        await redis_cache.delete(self._attempts_key(purpose, normalized))

        send_counter = await redis_cache.incr(send_count_key)
        if send_counter == 1:
            await redis_cache.expire(send_count_key, _SEND_WINDOW_SECONDS)

        if self.cooldown_seconds:
            await redis_cache.set(cooldown_key, True, expire=self.cooldown_seconds)

        background_tasks.add_task(
            send_verification_code_email,
            normalized,
            code,
            max(1, math.ceil(self.ttl_seconds / 60)),
        )
        logger.info("Queued email OTP for %s (%s)", normalized, purpose)

        return {
            "verification_target": self.mask_email(normalized),
            "expires_in": self.ttl_seconds,
            "resend_available_in": self.cooldown_seconds,
            "demo_code": code if settings.demo_show_email_code else None,
        }

    async def verify_code(
        self,
        *,
        purpose: str,
        email: str,
        code: str,
        user: User | None = None,
        db: AsyncSession | None = None,
    ) -> bool:
        normalized = self.normalize_email(email)

        if user is not None and db is not None:
            now_ts = self._current_ts()
            notification_settings, record = self._load_user_record(user, purpose)
            if not record or record.get("email") != normalized:
                raise EmailOTPError(
                    detail="РЎСЂРѕРє РґРµР№СЃС‚РІРёСЏ РєРѕРґР° РёСЃС‚С‘Рє. Р—Р°РїСЂРѕСЃРёС‚Рµ РЅРѕРІС‹Р№ РєРѕРґ.",
                    status_code=status.HTTP_400_BAD_REQUEST,
                )

            expires_at = int(record.get("expires_at") or 0)
            if expires_at <= now_ts:
                self._save_user_record(user, purpose, notification_settings, None)
                await self._persist_user(db, user)
                raise EmailOTPError(
                    detail="РЎСЂРѕРє РґРµР№СЃС‚РІРёСЏ РєРѕРґР° РёСЃС‚С‘Рє. Р—Р°РїСЂРѕСЃРёС‚Рµ РЅРѕРІС‹Р№ РєРѕРґ.",
                    status_code=status.HTTP_400_BAD_REQUEST,
                )

            attempts = int(record.get("attempts") or 0)
            if attempts >= self.max_attempts:
                raise EmailOTPError(
                    detail="РџСЂРµРІС‹С€РµРЅРѕ С‡РёСЃР»Рѕ РїРѕРїС‹С‚РѕРє. Р—Р°РїСЂРѕСЃРёС‚Рµ РЅРѕРІС‹Р№ РєРѕРґ.",
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    retry_after=max(1, expires_at - now_ts),
                )

            normalized_code = str(code or "").strip()
            expected_hash = str(record.get("code_hash") or "")
            current_hash = self._hash_code(purpose, normalized, normalized_code)
            if not hmac.compare_digest(expected_hash, current_hash):
                attempts += 1
                record["attempts"] = attempts
                self._save_user_record(user, purpose, notification_settings, record)
                await self._persist_user(db, user)

                if attempts >= self.max_attempts:
                    raise EmailOTPError(
                        detail="РџСЂРµРІС‹С€РµРЅРѕ С‡РёСЃР»Рѕ РїРѕРїС‹С‚РѕРє. Р—Р°РїСЂРѕСЃРёС‚Рµ РЅРѕРІС‹Р№ РєРѕРґ.",
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        retry_after=max(1, expires_at - now_ts),
                    )

                raise EmailOTPError(
                    detail="РќРµРІРµСЂРЅС‹Р№ РєРѕРґ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ.",
                    status_code=status.HTTP_401_UNAUTHORIZED,
                )

            self._save_user_record(user, purpose, notification_settings, None)
            await self._persist_user(db, user)
            return True

        record_key = self._record_key(purpose, normalized)
        attempts_key = self._attempts_key(purpose, normalized)
        record = await redis_cache.get(record_key)

        if not record:
            raise EmailOTPError(
                detail="Срок действия кода истёк. Запросите новый код.",
                status_code=status.HTTP_400_BAD_REQUEST,
            )

        attempts = int(await redis_cache.get(attempts_key, 0) or 0)
        if attempts >= self.max_attempts:
            retry_after = await redis_cache.ttl(record_key)
            raise EmailOTPError(
                detail="Превышено число попыток. Запросите новый код.",
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                retry_after=retry_after if retry_after > 0 else None,
            )

        normalized_code = str(code or "").strip()
        expected_hash = record.get("code_hash", "")
        current_hash = self._hash_code(purpose, normalized, normalized_code)

        if not hmac.compare_digest(expected_hash, current_hash):
            attempts = await redis_cache.incr(attempts_key)
            ttl = await redis_cache.ttl(record_key)
            if ttl > 0:
                await redis_cache.expire(attempts_key, ttl)

            if attempts >= self.max_attempts:
                raise EmailOTPError(
                    detail="Превышено число попыток. Запросите новый код.",
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    retry_after=ttl if ttl > 0 else None,
                )

            raise EmailOTPError(
                detail="Неверный код подтверждения.",
                status_code=status.HTTP_401_UNAUTHORIZED,
            )

        await redis_cache.delete(record_key)
        await redis_cache.delete(attempts_key)
        return True


email_otp_service = EmailOTPService()
