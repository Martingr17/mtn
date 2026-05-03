from starlette.requests import Request

from app import main


def _build_request(path: str = "/login") -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": path,
            "headers": [],
            "query_string": b"",
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
            "scheme": "http",
        },
    )


def test_render_page_hides_demo_staff_credentials_outside_demo(monkeypatch):
    monkeypatch.setattr(main.settings, "demo_mode", False)
    response = main.render_page(_build_request(), "login.html")
    context = response.context

    assert context["demo_mode"] is False
    assert context["demo_staff_accounts"] == []
    assert context["demo_staff_aliases"] == []


def test_render_page_keeps_demo_staff_credentials_in_demo(monkeypatch):
    monkeypatch.setattr(main.settings, "demo_mode", True)
    response = main.render_page(_build_request(), "login.html")
    context = response.context

    assert context["demo_mode"] is True
    assert len(context["demo_staff_accounts"]) == 2
    assert len(context["demo_staff_aliases"]) == 2


async def test_root_uses_spa_index_in_demo_mode(monkeypatch):
    monkeypatch.setattr(main.settings, "demo_mode", True)
    response = await main.root(_build_request(), current_user=None)

    assert response.path.replace("\\", "/").endswith("static/spa/index.html")


def test_no_duplicate_payments_statement_pdf_route():
    matches = [
        route
        for route in main.app.routes
        if getattr(route, "path", None) == "/api/v1/payments/statement/pdf"
    ]
    assert len(matches) == 1


def test_no_duplicate_ticket_close_route():
    matches = [
        route
        for route in main.app.routes
        if getattr(route, "path", None) == "/api/v1/tickets/{ticket_id}/close"
    ]
    assert len(matches) == 1


def test_tariff_force_change_requires_admin_or_superadmin():
    route = next(
        item
        for item in main.app.routes
        if getattr(item, "path", None) == "/api/v1/tariffs/admin/force-change"
    )
    dependency_names = [getattr(dep.call, "__name__", str(dep.call)) for dep in route.dependant.dependencies]
    assert "get_current_admin" not in dependency_names
    assert "dependency" in dependency_names
