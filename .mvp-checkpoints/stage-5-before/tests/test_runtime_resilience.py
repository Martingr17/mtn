from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from app.api.v1.endpoints import health
from app.main import app
from app.services.cache import InMemoryRedisCompat, RedisCache


class FailingRedisClient:
    async def incrby(self, *args, **kwargs):
        raise RuntimeError("redis unavailable")

    async def set(self, *args, **kwargs):
        raise RuntimeError("redis unavailable")

    async def setex(self, *args, **kwargs):
        raise RuntimeError("redis unavailable")

    async def get(self, *args, **kwargs):
        raise RuntimeError("redis unavailable")


def test_spa_route_does_not_depend_on_rate_limit_cache(monkeypatch):
    async def fail_if_called(*args, **kwargs):
        raise AssertionError("rate limit cache should not be called for non-API routes")

    monkeypatch.setattr("app.core.middleware.redis_cache.incr", fail_if_called)

    with TestClient(app, base_url="http://localhost") as client:
        response = client.get("/app", follow_redirects=False)

    assert response.status_code == 200


async def test_redis_cache_falls_back_to_in_memory_backend():
    cache = RedisCache()
    cache.client = FailingRedisClient()

    current = await cache.incr("rate-limit:test")
    stored = await cache.set("session:test", {"ok": True}, expire=60)
    payload = await cache.get("session:test")

    assert current == 1
    assert stored is True
    assert payload == {"ok": True}
    assert isinstance(cache.client, InMemoryRedisCompat)


async def test_readiness_check_returns_503_json_when_dependencies_fail():
    class BrokenSession:
        async def execute(self, *_args, **_kwargs):
            raise RuntimeError("database unavailable")

    original_client = health.redis_cache.client
    health.redis_cache.client = type(
        "BrokenRedis",
        (),
        {"ping": AsyncMock(side_effect=RuntimeError("redis unavailable"))},
    )()
    try:
        response = await health.readiness_check(BrokenSession())
    finally:
        health.redis_cache.client = original_client

    assert response.status_code == 503
    assert response.body == b'{"status":"not ready"}'
