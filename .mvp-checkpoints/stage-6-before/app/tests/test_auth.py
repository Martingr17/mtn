from fastapi import BackgroundTasks
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.api.v1.endpoints import auth as auth_endpoints
from app.models import User
from app.core.security import get_password_hash
from app.services.cache import InMemoryRedisCompat, redis_cache
from app.services.email_otp import EmailOTPError, email_otp_service
import app.services.email_otp as email_otp_module


async def _fake_billing_account(_self, billing_id: str):
    return {"billing_id": billing_id, "status": "active"}


async def _noop_async(*_args, **_kwargs):
    return None


@pytest.fixture(autouse=True)
async def configure_auth_flow(monkeypatch):
    original_client = redis_cache.client
    original_demo_show_email_code = auth_endpoints.settings.demo_show_email_code

    redis_cache.client = InMemoryRedisCompat()
    auth_endpoints.settings.demo_show_email_code = True

    monkeypatch.setattr(auth_endpoints.BillingService, "get_account_info", _fake_billing_account)
    monkeypatch.setattr(auth_endpoints, "log_activity", _noop_async)
    monkeypatch.setattr(auth_endpoints, "send_email", _noop_async)
    monkeypatch.setattr(email_otp_module, "send_verification_code_email", _noop_async)

    yield

    auth_endpoints.settings.demo_show_email_code = original_demo_show_email_code
    redis_cache.client = original_client


def _registration_payload(*, billing_id: str, phone: str, email: str) -> dict[str, str]:
    return {
        "billing_id": billing_id,
        "phone": phone,
        "email": email,
        "first_name": "Alina",
        "last_name": "Sokolova",
    }


async def _get_user_by_phone(db_session, phone: str) -> User:
    result = await db_session.execute(select(User).where(User.phone == phone))
    return result.scalar_one()


def _set_registration_record(user: User, **updates) -> None:
    notification_settings = dict(user.notification_settings or {})
    system_payload = dict(notification_settings.get("__system_email_otp") or {})
    records = dict(system_payload.get("email_otp_records") or {})
    record = dict(records.get("registration") or {})
    record.update(updates)
    records["registration"] = record
    system_payload["email_otp_records"] = records
    notification_settings["__system_email_otp"] = system_payload
    user.notification_settings = notification_settings


@pytest.mark.asyncio()
async def test_register_starts_email_verification(client: AsyncClient):
    response = await client.post(
        "/api/v1/auth/register",
        json=_registration_payload(
            billing_id="EMAIL1001",
            phone="+79990001001",
            email="newuser@example.com",
        ),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["requires_confirmation"] is True
    assert payload["verification_channel"] == "email"
    assert payload["verification_target"].endswith("@example.com")
    assert payload["demo_email_code"].isdigit()
    assert len(payload["demo_email_code"]) == email_otp_service.code_length


@pytest.mark.asyncio()
async def test_register_confirm_activates_account_with_email_code(client: AsyncClient, db_session):
    register_response = await client.post(
        "/api/v1/auth/register",
        json=_registration_payload(
            billing_id="EMAIL1002",
            phone="+79990001002",
            email="confirm@example.com",
        ),
    )
    register_payload = register_response.json()

    confirm_response = await client.post(
        "/api/v1/auth/register/confirm",
        json={
            "phone": "+79990001002",
            "email": "confirm@example.com",
            "email_code": register_payload["demo_email_code"],
            "password": "V!brAte_482",
        },
    )

    assert confirm_response.status_code == 200

    result = await db_session.execute(select(User).where(User.phone == "+79990001002"))
    user = result.scalar_one()
    assert user.is_active is True
    assert user.is_verified is True
    assert user.email == "confirm@example.com"
    assert user.check_password("V!brAte_482") is True


@pytest.mark.asyncio()
async def test_register_confirm_rejects_invalid_email_code(client: AsyncClient):
    register_response = await client.post(
        "/api/v1/auth/register",
        json=_registration_payload(
            billing_id="EMAIL1003",
            phone="+79990001003",
            email="invalid-code@example.com",
        ),
    )
    assert register_response.status_code == 200

    response = await client.post(
        "/api/v1/auth/register/confirm",
        json={
            "phone": "+79990001003",
            "email": "invalid-code@example.com",
            "email_code": "000000",
        },
    )

    assert response.status_code == 401


@pytest.mark.asyncio()
async def test_register_confirm_rejects_expired_email_code(client: AsyncClient, db_session):
    register_response = await client.post(
        "/api/v1/auth/register",
        json=_registration_payload(
            billing_id="EMAIL1004",
            phone="+79990001004",
            email="expired@example.com",
        ),
    )
    register_payload = register_response.json()

    user = await _get_user_by_phone(db_session, "+79990001004")
    _set_registration_record(user, expires_at=0)
    db_session.add(user)
    await db_session.commit()

    response = await client.post(
        "/api/v1/auth/register/confirm",
        json={
            "phone": "+79990001004",
            "email": "expired@example.com",
            "email_code": register_payload["demo_email_code"],
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"]


@pytest.mark.asyncio()
async def test_register_rejects_duplicate_email(client: AsyncClient, db_session):
    existing_user = User(
        billing_id="EMAIL1005-EXISTING",
        phone="+79990001999",
        email="duplicate@example.com",
        first_name="Ivan",
        last_name="Petrov",
        is_active=True,
        is_verified=True,
    )
    db_session.add(existing_user)
    await db_session.commit()

    response = await client.post(
        "/api/v1/auth/register",
        json=_registration_payload(
            billing_id="EMAIL1005",
            phone="+79990001005",
            email="duplicate@example.com",
        ),
    )

    assert response.status_code == 400
    assert "email" in response.json()["detail"].lower()


@pytest.mark.asyncio()
async def test_register_resend_reissues_email_code(client: AsyncClient, db_session):
    payload = _registration_payload(
        billing_id="EMAIL1006",
        phone="+79990001006",
        email="resend@example.com",
    )

    first_response = await client.post("/api/v1/auth/register", json=payload)
    first_code = first_response.json()["demo_email_code"]

    user = await _get_user_by_phone(db_session, "+79990001006")
    _set_registration_record(user, cooldown_until=0)
    db_session.add(user)
    await db_session.commit()

    second_response = await client.post("/api/v1/auth/register", json=payload)
    second_payload = second_response.json()

    assert second_response.status_code == 200
    assert second_payload["demo_email_code"].isdigit()
    assert second_payload["demo_email_code"] != first_code


@pytest.mark.asyncio()
async def test_email_otp_code_is_single_use():
    response = await email_otp_service.issue_code(
        purpose="registration",
        email="single-use@example.com",
        background_tasks=BackgroundTasks(),
    )
    code = response["demo_code"]

    assert await email_otp_service.verify_code(
        purpose="registration",
        email="single-use@example.com",
        code=code,
    )

    with pytest.raises(EmailOTPError) as exc_info:
        await email_otp_service.verify_code(
            purpose="registration",
            email="single-use@example.com",
            code=code,
        )

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio()
async def test_email_otp_blocks_after_too_many_attempts():
    await email_otp_service.issue_code(
        purpose="registration",
        email="attempts@example.com",
        background_tasks=BackgroundTasks(),
    )

    for _ in range(email_otp_service.max_attempts - 1):
        with pytest.raises(EmailOTPError) as exc_info:
            await email_otp_service.verify_code(
                purpose="registration",
                email="attempts@example.com",
                code="000000",
            )

        assert exc_info.value.status_code == 401

    with pytest.raises(EmailOTPError) as exc_info:
        await email_otp_service.verify_code(
            purpose="registration",
            email="attempts@example.com",
            code="000000",
        )

    assert exc_info.value.status_code == 429


@pytest.mark.asyncio()
async def test_login_request_email_code_works(client: AsyncClient, test_user):
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": test_user.email},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["verification_channel"] == "email"
    assert payload["verification_target"]
    assert payload["demo_email_code"].isdigit()


@pytest.mark.asyncio()
async def test_login_with_email_code_returns_tokens(client: AsyncClient, db_session):
    user = User(
        billing_id="LOGIN1001",
        phone="+79990001111",
        email="login-code@example.com",
        password_hash=get_password_hash("Test123!@#"),
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.commit()

    request_response = await client.post(
        "/api/v1/auth/login",
        json={"email": user.email},
    )
    request_payload = request_response.json()

    confirm_response = await client.post(
        "/api/v1/auth/login",
        json={
            "email": user.email,
            "email_code": request_payload["demo_email_code"],
        },
    )

    assert confirm_response.status_code == 200
    payload = confirm_response.json()
    assert payload["access_token"]
    assert payload["refresh_token"]
