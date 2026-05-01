import pytest
from httpx import AsyncClient

from app.api.v1.endpoints import admin as admin_endpoints


@pytest.mark.asyncio()
async def test_admin_stats_survives_monitoring_failure(client: AsyncClient, admin_headers, monkeypatch):
    async def _broken_monitoring_overview(_db):
        raise RuntimeError("monitoring failed")

    monkeypatch.setattr(admin_endpoints, "get_admin_monitoring_overview", _broken_monitoring_overview)

    response = await client.get("/api/v1/admin/stats", headers=admin_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["monitoring_monitored_users"] == 0
    assert payload["monitoring_quality_breakdown"] == []
    assert payload["monitoring_latest_alerts"] == []


@pytest.mark.asyncio()
async def test_admin_stats_falls_back_on_unexpected_error(client: AsyncClient, admin_headers, monkeypatch):
    def _broken_activity_payload(*_args, **_kwargs):
        raise RuntimeError("activity failed")

    monkeypatch.setattr(admin_endpoints, "_activity_item_payload", _broken_activity_payload)

    response = await client.get("/api/v1/admin/stats", headers=admin_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_users"] == 0
    assert payload["system_health"]["status"] == "degraded"
