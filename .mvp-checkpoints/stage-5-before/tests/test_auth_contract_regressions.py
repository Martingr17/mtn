import pytest

from app.api.v1.endpoints import users
from app.schemas.auth import LoginRequest, RefreshRequest, RegisterConfirmRequest, RegisterRequest


class _FakeDb:
    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)


def test_refresh_request_allows_cookie_only_flow():
    payload = RefreshRequest.model_validate({})
    assert payload.refresh_token is None


def test_login_request_normalizes_blank_optional_fields():
    payload = LoginRequest.model_validate(
        {
            "email": "  USER@Example.COM ",
            "password": "   ",
            "email_code": "   ",
            "totp_code": "   ",
        },
    )
    assert payload.email == "user@example.com"
    assert payload.password is None
    assert payload.email_code is None
    assert payload.totp_code is None


def test_register_request_normalizes_email():
    payload = RegisterRequest.model_validate(
        {
            "billing_id": "demo77722",
            "phone": "+79991234567",
            "email": "  USER@Example.COM ",
            "first_name": "Алина",
            "last_name": "Соколова",
        },
    )

    assert payload.billing_id == "DEMO77722"
    assert payload.email == "user@example.com"


def test_register_confirm_request_accepts_legacy_sms_alias_for_email_code():
    payload = RegisterConfirmRequest.model_validate(
        {
            "phone": "+79991234567",
            "email": "  USER@Example.COM ",
            "sms_code": " 123456 ",
            "password": "V!brAte_482",
        },
    )

    assert payload.email == "user@example.com"
    assert payload.email_code == "123456"


@pytest.mark.asyncio()
async def test_blacklist_token_keeps_refresh_type(monkeypatch):
    fake_db = _FakeDb()
    monkeypatch.setattr(
        users,
        "decode_token",
        lambda _token: {"type": "refresh", "exp": 4_200_000_000},
    )

    await users.blacklist_token(fake_db, "sample-refresh-token", 5, "logout_all_sessions")

    assert len(fake_db.added) == 1
    token_row = fake_db.added[0]
    assert token_row.token == "sample-refresh-token"
    assert token_row.token_type == "refresh"
    assert token_row.user_id == 5
