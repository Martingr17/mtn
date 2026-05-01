import fnmatch
import json
import logging
import pickle
import time
from typing import Any

import redis.asyncio as redis

from app.config import settings

logger = logging.getLogger(__name__)


class InMemoryRedisCompat:
    def __init__(self) -> None:
        self._values: dict[str, tuple[Any, float | None]] = {}
        self._zsets: dict[str, dict[str, float]] = {}

    def _now(self) -> float:
        return time.time()

    def _purge_expired(self, key: str) -> None:
        payload = self._values.get(key)
        if not payload:
            return

        _, expires_at = payload
        if expires_at is not None and expires_at <= self._now():
            self._values.pop(key, None)

    def _ensure_zset(self, key: str) -> dict[str, float]:
        self._purge_expired(key)
        return self._zsets.setdefault(key, {})

    async def get(self, key: str) -> Any:
        self._purge_expired(key)
        payload = self._values.get(key)
        if not payload:
            return None
        return payload[0]

    async def set(self, key: str, value: Any, ex: int | None = None, nx: bool = False) -> bool:
        self._purge_expired(key)
        if nx and key in self._values:
            return False

        expires_at = self._now() + ex if ex else None
        self._values[key] = (value, expires_at)
        return True

    async def setex(self, key: str, seconds: int, value: Any) -> bool:
        return await self.set(key, value, ex=seconds)

    async def delete(self, *keys: str) -> int:
        deleted = 0
        for key in keys:
            self._purge_expired(key)
            if key in self._values:
                self._values.pop(key, None)
                deleted += 1
            if key in self._zsets:
                self._zsets.pop(key, None)
                deleted += 1
        return deleted

    async def exists(self, key: str) -> int:
        self._purge_expired(key)
        return 1 if key in self._values else 0

    async def incrby(self, key: str, amount: int) -> int:
        current = await self.get(key)
        next_value = int(current or 0) + amount
        await self.set(key, str(next_value))
        return next_value

    async def decrby(self, key: str, amount: int) -> int:
        return await self.incrby(key, -amount)

    async def expire(self, key: str, seconds: int) -> bool:
        self._purge_expired(key)
        if key not in self._values:
            return False

        value, _ = self._values[key]
        self._values[key] = (value, self._now() + seconds)
        return True

    async def ttl(self, key: str) -> int:
        self._purge_expired(key)
        payload = self._values.get(key)
        if not payload:
            return -2

        _, expires_at = payload
        if expires_at is None:
            return -1
        return max(0, int(expires_at - self._now()))

    async def keys(self, pattern: str) -> list[str]:
        for key in list(self._values):
            self._purge_expired(key)
        return [key for key in self._values if fnmatch.fnmatch(key, pattern)]

    async def zremrangebyscore(self, key: str, min_score: float, max_score: float) -> int:
        zset = self._ensure_zset(key)
        removable = [member for member, score in zset.items() if float(min_score) <= score <= float(max_score)]
        for member in removable:
            zset.pop(member, None)
        return len(removable)

    async def zcard(self, key: str) -> int:
        return len(self._ensure_zset(key))

    async def zrange(self, key: str, start: int, stop: int, withscores: bool = False) -> list[Any]:
        items = sorted(self._ensure_zset(key).items(), key=lambda item: (item[1], item[0]))
        if stop == -1:
            selected = items[start:]
        else:
            selected = items[start : stop + 1]

        if withscores:
            return selected
        return [member for member, _ in selected]

    async def zadd(self, key: str, mapping: dict[str, float]) -> int:
        zset = self._ensure_zset(key)
        added = 0
        for member, score in mapping.items():
            if member not in zset:
                added += 1
            zset[str(member)] = float(score)
        return added

    async def ping(self) -> bool:
        return True

    async def close(self) -> None:
        return None


class RedisCache:
    def __init__(self):
        self.client = None
        self._connect()

    def _activate_in_memory_fallback(self, error: Exception) -> bool:
        if isinstance(self.client, InMemoryRedisCompat):
            return False

        logger.warning("Redis unavailable, switching to in-memory cache backend: %s", error)
        self.client = InMemoryRedisCompat()
        return True

    async def _call_with_fallback(self, operation_name: str, callback, default: Any) -> Any:
        try:
            return await callback()
        except Exception as error:
            logger.warning("Redis %s error: %s", operation_name, error)
            if self._activate_in_memory_fallback(error):
                try:
                    return await callback()
                except Exception as fallback_error:
                    logger.warning(
                        "In-memory fallback %s error: %s",
                        operation_name,
                        fallback_error,
                    )
            return default

    def _connect(self):
        """Connect to Redis"""
        if str(settings.redis_host).lower() in {"memory", "in-memory", "none", "disabled"}:
            logger.info("Redis disabled, using in-memory cache backend")
            self.client = InMemoryRedisCompat()
            return

        self.client = redis.from_url(
            settings.redis_url,
            decode_responses=False,
            socket_connect_timeout=1,
            socket_timeout=1,
            retry_on_timeout=True,
        )

    async def get(self, key: str, default: Any = None) -> Any:
        """Get value from cache"""
        async def operation() -> Any:
            value = await self.client.get(key)
            if value is None:
                return default
            try:
                return json.loads(value)
            except (json.JSONDecodeError, TypeError):
                return pickle.loads(value)

        return await self._call_with_fallback("get", operation, default)

    async def set(self, key: str, value: Any, expire: int = None) -> bool:
        """Set value in cache"""
        async def operation() -> bool:
            # Try JSON serialization first
            try:
                serialized = json.dumps(value)
            except (TypeError, ValueError):
                serialized = pickle.dumps(value)

            if expire:
                await self.client.setex(key, expire, serialized)
            else:
                await self.client.set(key, serialized)
            return True

        return await self._call_with_fallback("set", operation, False)

    async def delete(self, key: str) -> bool:
        """Delete key from cache"""
        async def operation() -> bool:
            await self.client.delete(key)
            return True

        return await self._call_with_fallback("delete", operation, False)

    async def exists(self, key: str) -> bool:
        """Check if key exists"""
        async def operation() -> bool:
            return await self.client.exists(key) > 0

        return await self._call_with_fallback("exists", operation, False)

    async def incr(self, key: str, amount: int = 1) -> int:
        """Increment counter"""
        async def operation() -> int:
            return await self.client.incrby(key, amount)

        return await self._call_with_fallback("incr", operation, 0)

    async def decr(self, key: str, amount: int = 1) -> int:
        """Decrement counter"""
        async def operation() -> int:
            return await self.client.decrby(key, amount)

        return await self._call_with_fallback("decr", operation, 0)

    async def expire(self, key: str, seconds: int) -> bool:
        """Set expiration on key"""
        async def operation() -> bool:
            return await self.client.expire(key, seconds)

        return await self._call_with_fallback("expire", operation, False)

    async def ttl(self, key: str) -> int:
        """Get TTL of key"""
        async def operation() -> int:
            return await self.client.ttl(key)

        return await self._call_with_fallback("ttl", operation, -2)

    async def clear_pattern(self, pattern: str) -> int:
        """Clear all keys matching pattern"""
        async def operation() -> int:
            keys = await self.client.keys(pattern)
            if keys:
                return await self.client.delete(*keys)
            return 0

        return await self._call_with_fallback("clear pattern", operation, 0)

    async def get_or_set(self, key: str, func, expire: int = None) -> Any:
        """Get from cache or execute function and cache result"""
        value = await self.get(key)
        if value is not None:
            return value

        value = await func()
        if value is not None:
            await self.set(key, value, expire)
        return value

    async def close(self):
        """Close Redis connection"""
        if self.client:
            await self.client.close()

redis_cache = RedisCache()

# Convenience functions
async def cache_get(key: str) -> Any:
    return await redis_cache.get(key)

async def cache_set(key: str, value: Any, expire: int = None) -> bool:
    return await redis_cache.set(key, value, expire)

async def cache_delete(key: str) -> bool:
    return await redis_cache.delete(key)

async def cache_exists(key: str) -> bool:
    return await redis_cache.exists(key)

async def cache_incr(key: str, amount: int = 1) -> int:
    return await redis_cache.incr(key, amount)

async def cache_decr(key: str, amount: int = 1) -> int:
    return await redis_cache.decr(key, amount)

async def cache_get_or_set(key: str, func, expire: int = None) -> Any:
    return await redis_cache.get_or_set(key, func, expire)
