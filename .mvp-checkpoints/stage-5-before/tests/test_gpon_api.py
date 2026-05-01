from datetime import datetime
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import dependencies, main
from app.api.v1.endpoints import gpon as gpon_endpoint
from app.database import get_db


def _user(role: str, user_id: int = 77):
    return SimpleNamespace(id=user_id, role=role, is_active=True, is_blocked=False)


def _subscriber():
    return SimpleNamespace(
        id=10,
        billing_id="DEMO90001",
        full_name="Demo Subscriber",
        phone="+79000000000",
        email="demo@example.test",
    )


def _olt():
    now = datetime.utcnow()
    return SimpleNamespace(
        id=1,
        name="OLT-ЖК-1",
        vendor="Eltex",
        model="LTP-16X",
        management_ip="10.30.0.11",
        location="ЖК-1",
        status="online",
        pon_ports_total=16,
        pon_ports_used=8,
        uplink_status="up",
        created_at=now,
        updated_at=now,
    )


def _ont(status: str = "online"):
    now = datetime.utcnow()
    return SimpleNamespace(
        id=100,
        subscriber_id=10,
        olt_id=1,
        serial_number="ELTX00000001",
        mac_address="04:bf:6d:00:00:01",
        pon_port=1,
        ont_id_on_port=1,
        vlan_id=301,
        status=status,
        rx_power=-18.2,
        tx_power=2.1,
        last_seen_at=now,
        created_at=now,
        updated_at=now,
        subscriber=_subscriber(),
        olt=_olt(),
    )


class _FakeGponAdapter:
    def __init__(self, _db):
        self.db = _db

    async def get_olts(self):
        return [_olt()]

    async def get_olt(self, _olt_id):
        return _olt()

    async def get_onts(self, **_kwargs):
        return [_ont()], 1, 1

    async def get_ont(self, _ont_id):
        return _ont()

    async def get_subscriber_ont(self, _subscriber_id):
        return _ont()

    async def reboot_ont(self, _ont_id, **_kwargs):
        return _ont()

    async def block_ont(self, _ont_id, **_kwargs):
        return _ont("blocked")

    async def unblock_ont(self, _ont_id, **_kwargs):
        return _ont("online")

    async def mark_rogue_suspected(self, _ont_id, **_kwargs):
        return _ont("rogue_suspected")

    async def refresh_ont_status(self, _ont_id, **_kwargs):
        return _ont()


async def _override_db():
    yield SimpleNamespace()


def _client_for_role(role: str, monkeypatch, user_id: int = 77):
    async def _override_user():
        return _user(role, user_id)

    monkeypatch.setattr(gpon_endpoint, "GponMockAdapter", _FakeGponAdapter)
    main.app.dependency_overrides[get_db] = _override_db
    main.app.dependency_overrides[dependencies.get_current_user] = _override_user
    return TestClient(main.app, base_url="http://localhost")


def _clear_overrides():
    main.app.dependency_overrides.clear()


def test_gpon_subscriber_cannot_list_onts(monkeypatch):
    client = _client_for_role("user", monkeypatch, user_id=10)
    try:
        response = client.get("/api/v1/gpon/onts")
    finally:
        _clear_overrides()

    assert response.status_code == 403


def test_gpon_billing_can_read_subscriber_summary_only(monkeypatch):
    client = _client_for_role("billing", monkeypatch)
    try:
        list_response = client.get("/api/v1/gpon/onts")
        summary_response = client.get("/api/v1/gpon/subscribers/10/ont")
    finally:
        _clear_overrides()

    assert list_response.status_code == 403
    assert summary_response.status_code == 200
    assert summary_response.json()["serial_number"] == "ELTX00000001"


def test_gpon_subscriber_can_read_only_own_summary(monkeypatch):
    client = _client_for_role("user", monkeypatch, user_id=10)
    try:
        own_response = client.get("/api/v1/gpon/subscribers/10/ont")
        other_response = client.get("/api/v1/gpon/subscribers/11/ont")
    finally:
        _clear_overrides()

    assert own_response.status_code == 200
    assert other_response.status_code == 403


def test_gpon_support_is_read_only(monkeypatch):
    client = _client_for_role("operator", monkeypatch)
    try:
        list_response = client.get("/api/v1/gpon/onts")
        action_response = client.post("/api/v1/gpon/onts/100/reboot")
    finally:
        _clear_overrides()

    assert list_response.status_code == 200
    assert action_response.status_code == 403


def test_gpon_noc_can_reboot_refresh_and_mark_rogue(monkeypatch):
    client = _client_for_role("noc_engineer", monkeypatch)
    try:
        reboot_response = client.post("/api/v1/gpon/onts/100/reboot")
        refresh_response = client.post("/api/v1/gpon/onts/100/refresh-status")
        rogue_response = client.post("/api/v1/gpon/onts/100/mark-rogue-suspected")
    finally:
        _clear_overrides()

    assert reboot_response.status_code == 200
    assert refresh_response.status_code == 200
    assert rogue_response.status_code == 200
    assert rogue_response.json()["action"] == "mark_rogue_suspected"


def test_gpon_noc_cannot_block(monkeypatch):
    client = _client_for_role("noc_engineer", monkeypatch)
    try:
        response = client.post("/api/v1/gpon/onts/100/block")
    finally:
        _clear_overrides()

    assert response.status_code == 403


def test_gpon_admin_can_block(monkeypatch):
    client = _client_for_role("admin", monkeypatch)
    try:
        response = client.post("/api/v1/gpon/onts/100/block")
    finally:
        _clear_overrides()

    assert response.status_code == 200
    assert response.json()["ont"]["status"] == "blocked"
