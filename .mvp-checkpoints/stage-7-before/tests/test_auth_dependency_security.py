from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from starlette.requests import Request

from app import dependencies


class _ScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _FakeDb:
    def __init__(self, values):
        self._values = iter(values)

    async def execute(self, _query):
        return _ScalarResult(next(self._values))


def _make_request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/api/v1/users/me",
            "headers": [],
            "query_string": b"",
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
            "scheme": "http",
        },
    )


@pytest.mark.asyncio()
async def test_get_current_user_rejects_refresh_token(monkeypatch):
    monkeypatch.setattr(
        dependencies,
        "decode_token",
        lambda _token: {"sub": "1", "type": "refresh"},
    )

    db = _FakeDb([])
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="fake-refresh-token")

    with pytest.raises(HTTPException) as exc:
        await dependencies.get_current_user(_make_request(), credentials=credentials, db=db)

    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid token type"


@pytest.mark.asyncio()
async def test_get_current_user_accepts_access_token(monkeypatch):
    monkeypatch.setattr(
        dependencies,
        "decode_token",
        lambda _token: {"sub": "1", "type": "access"},
    )

    async def _cache_set(*_args, **_kwargs):
        return None

    monkeypatch.setattr(dependencies.redis_cache, "set", _cache_set)

    user = SimpleNamespace(
        id=1,
        phone="+79990000000",
        email="user@example.com",
        role="user",
        is_active=True,
        is_blocked=False,
    )
    db = _FakeDb([None, user])
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="fake-access-token")

    resolved_user = await dependencies.get_current_user(_make_request(), credentials=credentials, db=db)
    assert resolved_user.id == 1
