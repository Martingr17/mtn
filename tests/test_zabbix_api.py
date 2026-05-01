from datetime import datetime
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import dependencies, main
from app.api.v1.endpoints import zabbix as zabbix_endpoint
from app.database import get_db


def _user(role: str, user_id: int = 77):
    return SimpleNamespace(id=user_id, role=role, is_active=True, is_blocked=False)


def _alarm(status: str = "active"):
    now = datetime.utcnow()
    return SimpleNamespace(
        id=200,
        alarm_type="low_optical_power",
        severity="warning",
        status=status,
        source_type="ont",
        source_name="ELTX00000002",
        source_id=100,
        title="ONT low optical power",
        description="Mock warning",
        metric_name="ont.rx_power",
        metric_value=-26.8,
        threshold=-25.0,
        first_seen_at=now,
        last_seen_at=now,
        acknowledged_at=now if status == "acknowledged" else None,
        resolved_at=now if status == "resolved" else None,
        acknowledged_by=77 if status == "acknowledged" else None,
        resolved_by=77 if status == "resolved" else None,
    )


class _FakeZabbixAdapter:
    def __init__(self, _db):
        self.db = _db

    async def get_alarms(self, **_kwargs):
        return [_alarm()], 1, 1

    async def get_alarm(self, _alarm_id):
        return _alarm()

    async def get_summary(self):
        return {
            "active": 1,
            "critical": 0,
            "high": 0,
            "warning": 1,
            "resolved": 0,
            "acknowledged": 0,
            "total": 1,
            "by_type": {"low_optical_power": 1},
            "by_source_type": {"ont": 1},
        }

    async def acknowledge_alarm(self, _alarm_id, _user, **_kwargs):
        return _alarm("acknowledged")

    async def resolve_alarm(self, _alarm_id, _user, **_kwargs):
        return _alarm("resolved")

    async def refresh_mock_alarms(self, _user, **_kwargs):
        return {"refreshed": 1, "created": 0, "result": "mock_success"}


async def _override_db():
    yield SimpleNamespace()


def _client_for_role(role: str, monkeypatch):
    async def _override_user():
        return _user(role)

    monkeypatch.setattr(zabbix_endpoint, "ZabbixMockAdapter", _FakeZabbixAdapter)
    main.app.dependency_overrides[get_db] = _override_db
    main.app.dependency_overrides[dependencies.get_current_user] = _override_user
    return TestClient(main.app, base_url="http://localhost")


def _clear_overrides():
    main.app.dependency_overrides.clear()


def test_zabbix_billing_has_no_access(monkeypatch):
    client = _client_for_role("billing", monkeypatch)
    try:
        response = client.get("/api/v1/zabbix/alarms")
    finally:
        _clear_overrides()

    assert response.status_code == 403


def test_zabbix_subscriber_has_no_access(monkeypatch):
    client = _client_for_role("user", monkeypatch)
    try:
        response = client.get("/api/v1/zabbix/summary")
    finally:
        _clear_overrides()

    assert response.status_code == 403


def test_zabbix_support_is_read_only(monkeypatch):
    client = _client_for_role("operator", monkeypatch)
    try:
        list_response = client.get("/api/v1/zabbix/alarms")
        action_response = client.post("/api/v1/zabbix/alarms/200/ack")
    finally:
        _clear_overrides()

    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["alarm_type"] == "low_optical_power"
    assert action_response.status_code == 403


def test_zabbix_noc_can_ack_resolve_and_refresh(monkeypatch):
    client = _client_for_role("noc_engineer", monkeypatch)
    try:
        ack_response = client.post("/api/v1/zabbix/alarms/200/ack")
        resolve_response = client.post("/api/v1/zabbix/alarms/200/resolve")
        refresh_response = client.post("/api/v1/zabbix/refresh")
    finally:
        _clear_overrides()

    assert ack_response.status_code == 200
    assert ack_response.json()["alarm"]["status"] == "acknowledged"
    assert resolve_response.status_code == 200
    assert resolve_response.json()["alarm"]["status"] == "resolved"
    assert refresh_response.status_code == 200
    assert refresh_response.json()["result"] == "mock_success"


def test_zabbix_admin_can_acknowledge(monkeypatch):
    client = _client_for_role("admin", monkeypatch)
    try:
        response = client.post("/api/v1/zabbix/alarms/200/ack")
    finally:
        _clear_overrides()

    assert response.status_code == 200
    assert response.json()["action"] == "ack"
