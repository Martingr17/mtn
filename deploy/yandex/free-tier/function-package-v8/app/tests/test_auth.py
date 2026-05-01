import pytest
from httpx import AsyncClient
from app.models import User

@pytest.mark.asyncio
async def test_register(client: AsyncClient):
    """Test user registration"""
    response = await client.post("/api/v1/auth/register", json={
        "billing_id": "TEST456",
        "phone": "+79998765432",
        "email": "newuser@example.com",
        "first_name": "Test",
        "last_name": "User"
    })
    assert response.status_code == 200
    assert "user_id" in response.json()

@pytest.mark.asyncio
async def test_login_request_sms(client: AsyncClient, test_user):
    """Test login request (SMS code sent)"""
    response = await client.post("/api/v1/auth/login", json={
        "phone": test_user.phone
    })
    assert response.status_code == 202
    assert "SMS code sent" in response.json().get("message", "")

@pytest.mark.asyncio
async def test_login_invalid_phone(client: AsyncClient):
    """Test login with invalid phone"""
    response = await client.post("/api/v1/auth/login", json={
        "phone": "+79990000000"
    })
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_refresh_token(client: AsyncClient, test_user):
    """Test token refresh"""
    # First login to get tokens
    from app.core.security import create_access_token, create_refresh_token
    refresh_token = create_refresh_token(data={"sub": str(test_user.id)})
    
    response = await client.post("/api/v1/auth/refresh", json={
        "refresh_token": refresh_token
    })
    assert response.status_code == 200
    assert "access_token" in response.json()

@pytest.mark.asyncio
async def test_logout(client: AsyncClient, auth_headers, test_user):
    """Test logout"""
    response = await client.post("/api/v1/auth/logout", headers=auth_headers)
    assert response.status_code == 200

@pytest.mark.asyncio
async def test_change_password(client: AsyncClient, auth_headers, test_user):
    """Test password change"""
    # First set password for test user
    test_user.set_password("OldPass123!")
    await test_user.save()
    
    response = await client.post("/api/v1/auth/change-password", 
        headers=auth_headers,
        json={
            "old_password": "OldPass123!",
            "new_password": "NewPass456@"
        }
    )
    assert response.status_code == 200

@pytest.mark.asyncio
async def test_rate_limit(client: AsyncClient):
    """Test rate limiting"""
    # Make multiple requests quickly
    for i in range(10):
        response = await client.post("/api/v1/auth/login", json={"phone": "+79991234567"})
        if i >= 5:
            assert response.status_code == 429
            break