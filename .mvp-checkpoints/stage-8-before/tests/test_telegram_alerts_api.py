from datetime import datetime
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import dependencies, main
from app.api.v1.endpoints import telegram_alerts as telegram_endpoint
from app.database import get_db


def _user(role: str, user_id: int = 77):
    return SimpleNamespace(id=user_id, role=role, is_active=True, is_blocked=False)


def _log(status: str = "sent", entity_type: str = "zabbix_alarm"):
    now = datetime.utcnow()
    return SimpleNamespace(
        id=300,
        entity_type=entity_type,
        entity_id=200,
        severity="critical",
        title="Critical alarm",
        message="Mock Telegram alert",
        chat_id="mock-chat",
        status=status,
        error=None if status == "sent" else "Mock skip",
        sent_at=now if status == "sent" else None,
        created_at=now,
    )


class _FakeTelegramAlertService:
    def __init__(self, _db):
        self.db = _db

    async def list_logs(self, **_kwargs):
        return [_log()], 1, 1

    async def send_critical_alarm(self, _alarm_id, **_kwargs):
        return _log("sent", "zabbix_alarm")

    async def send_critical_incident(self, _incident_id, **_kwargs):
        return _log("sent", "noc_incident")


async def _override_db():
    yield SimpleNamespace()


def _client_for_role(role: str, monkeypatch):
    async def _override_user():
        return _user(role)

    monkeypatch.setattr(telegram_endpoint, "TelegramAlertService", _FakeTelegramAlertService)
    main.app.dependency_overrides[get_db] = _override_db
    main.app.dependency_overrides[dependencies.get_current_user] = _override_user
    return TestClient(main.app, base_url="http://localhost")


def _clear_overrides():
    main.app.dependency_overrides.clear()


def test_telegram_alerts_reject_support_billing_and_subscriber(monkeypatch):
    for role in ("operator", "billing", "user"):
        client = _client_for_role(role, monkeypatch)
        try:
            response = client.get("/api/v1/telegram-alerts")
        finally:
            _clear_overrides()

        assert response.status_code == 403


def test_telegram_alerts_noc_can_read_and_send(monkeypatch):
    client = _client_for_role("noc_engineer", monkeypatch)
    try:
        list_response = client.get("/api/v1/telegram-alerts")
        alarm_response = client.post("/api/v1/telegram-alerts/zabbix/200/send")
        incident_response = client.post("/api/v1/telegram-alerts/incidents/100/send")
    finally:
        _clear_overrides()

    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["status"] == "sent"
    assert alarm_response.status_code == 200
    assert alarm_response.json()["alert"]["entity_type"] == "zabbix_alarm"
    assert incident_response.status_code == 200
    assert incident_response.json()["alert"]["entity_type"] == "noc_incident"


def test_telegram_alerts_admin_can_send(monkeypatch):
    client = _client_for_role("admin", monkeypatch)
    try:
        response = client.post("/api/v1/telegram-alerts/zabbix/200/send")
    finally:
        _clear_overrides()

    assert response.status_code == 200
    assert response.json()["result"] == "sent"
