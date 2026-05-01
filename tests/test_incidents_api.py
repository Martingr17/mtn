from datetime import datetime
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import dependencies, main
from app.api.v1.endpoints import incidents as incidents_endpoint
from app.database import get_db


def _user(role: str, user_id: int = 77):
    return SimpleNamespace(id=user_id, role=role, is_active=True, is_blocked=False)


def _alarm():
    now = datetime.utcnow()
    return SimpleNamespace(
        id=200,
        alarm_type="bgp_down",
        severity="critical",
        status="active",
        source_type="core_router",
        source_name="CR-01",
        source_id=None,
        title="BGP peer down",
        description="Mock alarm",
        metric_name="bgp.peer.state",
        metric_value=0,
        threshold=1,
        first_seen_at=now,
        last_seen_at=now,
        acknowledged_at=None,
        resolved_at=None,
        acknowledged_by=None,
        resolved_by=None,
    )


def _incident(status: str = "new", assigned_to: int | None = None):
    now = datetime.utcnow()
    return SimpleNamespace(
        id=100,
        title="BGP peer down",
        description="Mock incident",
        severity="critical",
        status=status,
        source="zabbix",
        affected_service="bgp",
        affected_subscribers_count=0,
        assigned_to=assigned_to,
        created_by=77,
        acknowledged_by=77 if status in {"acknowledged", "in_progress"} else None,
        resolved_by=77 if status == "resolved" else None,
        closed_by=77 if status == "closed" else None,
        created_at=now,
        acknowledged_at=now if status in {"acknowledged", "in_progress"} else None,
        started_at=now if status == "in_progress" else None,
        resolved_at=now if status == "resolved" else None,
        closed_at=now if status == "closed" else None,
        updated_at=now,
        assigned_user=None,
        created_by_user=None,
        alarm_links=[SimpleNamespace(alarm=_alarm())],
    )


class _FakeIncidentService:
    def __init__(self, _db):
        self.db = _db

    async def list_incidents(self, **_kwargs):
        return [_incident()], 1, 1

    async def get_incident(self, _incident_id):
        return _incident()

    async def create_incident(self, _payload, **_kwargs):
        return _incident("new")

    async def create_from_alarm(self, _alarm_id, **_kwargs):
        return _incident("new"), True

    async def acknowledge_incident(self, _incident_id, **_kwargs):
        return _incident("acknowledged")

    async def start_incident(self, _incident_id, **_kwargs):
        return _incident("in_progress", assigned_to=77)

    async def resolve_incident(self, _incident_id, **_kwargs):
        return _incident("resolved")

    async def close_incident(self, _incident_id, **_kwargs):
        return _incident("closed")

    async def assign_incident(self, _incident_id, user_id, **_kwargs):
        return _incident("new", assigned_to=user_id)


async def _override_db():
    yield SimpleNamespace()


def _client_for_role(role: str, monkeypatch, user_id: int = 77):
    async def _override_user():
        return _user(role, user_id)

    monkeypatch.setattr(incidents_endpoint, "IncidentService", _FakeIncidentService)
    main.app.dependency_overrides[get_db] = _override_db
    main.app.dependency_overrides[dependencies.get_current_user] = _override_user
    return TestClient(main.app, base_url="http://localhost")


def _clear_overrides():
    main.app.dependency_overrides.clear()


def test_incidents_billing_and_subscriber_have_no_access(monkeypatch):
    billing_client = _client_for_role("billing", monkeypatch)
    try:
        billing_response = billing_client.get("/api/v1/incidents")
    finally:
        _clear_overrides()

    subscriber_client = _client_for_role("user", monkeypatch)
    try:
        subscriber_response = subscriber_client.get("/api/v1/incidents")
    finally:
        _clear_overrides()

    assert billing_response.status_code == 403
    assert subscriber_response.status_code == 403


def test_incidents_support_is_read_only(monkeypatch):
    client = _client_for_role("operator", monkeypatch)
    try:
        list_response = client.get("/api/v1/incidents")
        create_response = client.post(
            "/api/v1/incidents",
            json={"title": "Manual incident", "severity": "medium", "affected_service": "other"},
        )
    finally:
        _clear_overrides()

    assert list_response.status_code == 200
    assert list_response.json()["items"][0]["title"] == "BGP peer down"
    assert create_response.status_code == 403


def test_incidents_noc_can_run_workflow(monkeypatch):
    client = _client_for_role("noc_engineer", monkeypatch, user_id=77)
    try:
        create_response = client.post(
            "/api/v1/incidents",
            json={"title": "Manual incident", "severity": "high", "affected_service": "gpon", "assigned_to": 77},
        )
        from_alarm_response = client.post("/api/v1/incidents/from-alarm/200")
        ack_response = client.post("/api/v1/incidents/100/ack")
        start_response = client.post("/api/v1/incidents/100/start")
        resolve_response = client.post("/api/v1/incidents/100/resolve")
        assign_self_response = client.post("/api/v1/incidents/100/assign", json={"user_id": 77})
    finally:
        _clear_overrides()

    assert create_response.status_code == 200
    assert from_alarm_response.status_code == 200
    assert ack_response.json()["incident"]["status"] == "acknowledged"
    assert start_response.json()["incident"]["status"] == "in_progress"
    assert resolve_response.json()["incident"]["status"] == "resolved"
    assert assign_self_response.json()["incident"]["assigned_to"] == 77


def test_incidents_noc_cannot_close_or_assign_other_user(monkeypatch):
    client = _client_for_role("noc_engineer", monkeypatch, user_id=77)
    try:
        close_response = client.post("/api/v1/incidents/100/close")
        assign_other_response = client.post("/api/v1/incidents/100/assign", json={"user_id": 88})
    finally:
        _clear_overrides()

    assert close_response.status_code == 403
    assert assign_other_response.status_code == 403


def test_incidents_admin_can_close_and_assign_any_user(monkeypatch):
    client = _client_for_role("admin", monkeypatch, user_id=1)
    try:
        close_response = client.post("/api/v1/incidents/100/close")
        assign_response = client.post("/api/v1/incidents/100/assign", json={"user_id": 88})
    finally:
        _clear_overrides()

    assert close_response.status_code == 200
    assert close_response.json()["incident"]["status"] == "closed"
    assert assign_response.status_code == 200
    assert assign_response.json()["incident"]["assigned_to"] == 88
