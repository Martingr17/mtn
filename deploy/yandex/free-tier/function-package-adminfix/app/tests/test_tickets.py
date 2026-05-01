import pytest
from httpx import AsyncClient

@pytest.mark.asyncio()
async def test_create_ticket(client: AsyncClient, auth_headers, test_user):
    """Test ticket creation"""
    response = await client.post("/api/v1/tickets/",
        headers=auth_headers,
        data={
            "subject": "Test Ticket",
            "body": "This is a test ticket body",
            "priority": "medium",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["subject"] == "Test Ticket"
    assert data["status"] == "new"

@pytest.mark.asyncio()
async def test_list_tickets(client: AsyncClient, auth_headers):
    """Test listing tickets"""
    response = await client.get("/api/v1/tickets/", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data

@pytest.mark.asyncio()
async def test_get_ticket_detail(client: AsyncClient, auth_headers, test_user):
    """Test getting ticket details"""
    # First create a ticket
    create_resp = await client.post("/api/v1/tickets/",
        headers=auth_headers,
        data={
            "subject": "Detail Test",
            "body": "Test body",
            "priority": "low",
        },
    )
    ticket_id = create_resp.json()["id"]

    # Get ticket details
    response = await client.get(f"/api/v1/tickets/{ticket_id}", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == ticket_id
    assert "messages" in data

@pytest.mark.asyncio()
async def test_reply_to_ticket(client: AsyncClient, auth_headers, test_user):
    """Test replying to ticket"""
    # Create ticket
    create_resp = await client.post("/api/v1/tickets/",
        headers=auth_headers,
        data={
            "subject": "Reply Test",
            "body": "Initial message",
            "priority": "medium",
        },
    )
    ticket_id = create_resp.json()["id"]

    # Reply
    response = await client.post(f"/api/v1/tickets/{ticket_id}/reply",
        headers=auth_headers,
        data={"body": "This is a reply"},
    )
    assert response.status_code == 200

@pytest.mark.asyncio()
async def test_ticket_not_found(client: AsyncClient, auth_headers):
    """Test getting non-existent ticket"""
    response = await client.get("/api/v1/tickets/99999", headers=auth_headers)
    assert response.status_code == 404

@pytest.mark.asyncio()
async def test_admin_view_all_tickets(client: AsyncClient, admin_headers):
    """Test admin viewing all tickets"""
    response = await client.get("/api/v1/admin/tickets", headers=admin_headers)
    assert response.status_code == 200
