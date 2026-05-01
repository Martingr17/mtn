from datetime import datetime
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import dependencies, main
from app.api.v1.endpoints import radius as radius_endpoint
from app.database import get_db


def _user(role: str):
    return SimpleNamespace(id=77, role=role, is_active=True, is_blocked=False)


def _subscriber():
    return SimpleNamespace(
        id=10,
        billing_id="DEMO90001",
        full_name="Demo Subscriber",
        phone="+79000000000",
        email="demo@example.test",
    )


def _session():
    now = datetime.utcnow()
    return SimpleNamespace(
        id=100,
        subscriber_id=10,
        username="DEMO90001",
        framed_ip_address="10.64.1.20",
        mac_address="02:00:00:00:00:10",
        nas_ip_address="10.255.0.1",
        nas_port="pon-mock-1",
        session_id="mock-session-10",
        status="active",
        tariff_profile="MVP-100M",
        speed_down=100,
        speed_up=50,
        started_at=now,
        updated_at=now,
        subscriber=_subscriber(),
    )


def _action(action: str = "block"):
    now = datetime.utcnow()
    return SimpleNamespace(
        id=200,
        subscriber_id=10,
        action=action,
        old_status="active",
        new_status="blocked" if action == "block" else "active",
        old_speed_down=100,
        new_speed_down=200 if action == "change_speed" else 100,
        old_speed_up=50,
        new_speed_up=100 if action == "change_speed" else 50,
        performed_by=77,
        performer=SimpleNamespace(
            id=77,
            billing_id="STAFF-DEMO",
            full_name="Demo Staff",
            phone="+79005550000",
            email="staff@example.test",
        ),
        result="mock_success",
        created_at=now,
        subscriber=_subscriber(),
    )


class _FakeRadiusAdapter:
    def __init__(self, _db):
        self.db = _db

    async def get_sessions(self, **_kwargs):
        return [_session()], 1, 1

    async def get_subscriber_session(self, _subscriber_id):
        return _session()

    async def block_subscriber(self, _subscriber_id, **_kwargs):
        return _session(), _action("block")

    async def unblock_subscriber(self, _subscriber_id, **_kwargs):
        return _session(), _action("unblock")

    async def disconnect_subscriber(self, _subscriber_id, **_kwargs):
        return _session(), _action("disconnect")

    async def change_speed(self, _subscriber_id, _speed_down, _speed_up, **_kwargs):
        return _session(), _action("change_speed")

    async def get_actions(self, **_kwargs):
        return [_action("block")], 1, 1


async def _override_db():
    yield SimpleNamespace()


def _client_for_role(role: str, monkeypatch):
    async def _override_user():
        return _user(role)

    monkeypatch.setattr(radius_endpoint, "RadiusMockAdapter", _FakeRadiusAdapter)
    main.app.dependency_overrides[get_db] = _override_db
    main.app.dependency_overrides[dependencies.get_current_user] = _override_user
    return TestClient(main.app, base_url="http://localhost")


def _clear_overrides():
    main.app.dependency_overrides.clear()


def test_radius_sessions_reject_subscriber_role(monkeypatch):
    client = _client_for_role("user", monkeypatch)
    try:
        response = client.get("/api/v1/radius/sessions")
    finally:
        _clear_overrides()

    assert response.status_code == 403


def test_radius_support_can_view_sessions(monkeypatch):
    client = _client_for_role("operator", monkeypatch)
    try:
        response = client.get("/api/v1/radius/sessions")
    finally:
        _clear_overrides()

    assert response.status_code == 200
    assert response.json()["items"][0]["subscriber_id"] == 10


def test_radius_support_cannot_block(monkeypatch):
    client = _client_for_role("operator", monkeypatch)
    try:
        response = client.post("/api/v1/radius/subscribers/10/block")
    finally:
        _clear_overrides()

    assert response.status_code == 403


def test_radius_billing_can_block(monkeypatch):
    client = _client_for_role("billing", monkeypatch)
    try:
        response = client.post("/api/v1/radius/subscribers/10/block")
    finally:
        _clear_overrides()

    assert response.status_code == 200
    assert response.json()["action"]["action"] == "block"


def test_radius_noc_can_change_speed(monkeypatch):
    client = _client_for_role("noc_engineer", monkeypatch)
    try:
        response = client.post(
            "/api/v1/radius/subscribers/10/change-speed",
            json={"speed_down": 200, "speed_up": 100},
        )
    finally:
        _clear_overrides()

    assert response.status_code == 200
    assert response.json()["action"]["action"] == "change_speed"
