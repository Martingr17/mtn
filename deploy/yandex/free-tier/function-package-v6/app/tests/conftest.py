import pytest
import asyncio
from typing import AsyncGenerator, Generator
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from app.main import app
from app.database import get_db, Base
from app.config import settings
from app.models import User, Tariff
from app.core.security import get_password_hash

# Test database URL
TEST_DATABASE_URL = "postgresql+asyncpg://operator:securepassword@localhost:5433/operator_test"

engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestingSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with TestingSessionLocal() as session:
        yield session

app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(scope="session")
def event_loop() -> Generator:
    """Create event loop for tests"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

@pytest.fixture(autouse=True, scope="session")
async def setup_database():
    """Setup test database"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Get database session"""
    async with TestingSessionLocal() as session:
        yield session

@pytest.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    """HTTP client for testing"""
    async with AsyncClient(app=app, base_url="http://test") as client:
        yield client

@pytest.fixture
async def test_user(db_session: AsyncSession):
    """Create test user"""
    user = User(
        billing_id="TEST123",
        phone="+79991234567",
        email="test@example.com",
        password_hash=get_password_hash("Test123!@#"),
        is_active=True,
        is_verified=True
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user

@pytest.fixture
async def test_admin(db_session: AsyncSession):
    """Create test admin"""
    from app.models import UserRole
    admin = User(
        billing_id="ADMIN123",
        phone="+79990000000",
        email="admin@example.com",
        password_hash=get_password_hash("Admin123!@#"),
        role=UserRole.ADMIN,
        is_active=True,
        is_verified=True
    )
    db_session.add(admin)
    await db_session.commit()
    await db_session.refresh(admin)
    return admin

@pytest.fixture
async def test_tariff(db_session: AsyncSession):
    """Create test tariff"""
    tariff = Tariff(
        billing_tariff_id="TEST_TARIFF",
        name="Test Tariff",
        speed_mbps=100,
        price=500.00,
        is_active=True
    )
    db_session.add(tariff)
    await db_session.commit()
    await db_session.refresh(tariff)
    return tariff

@pytest.fixture
def auth_headers(test_user):
    """Get auth headers for test user"""
    from app.core.security import create_access_token
    token = create_access_token(data={"sub": str(test_user.id), "role": test_user.role.value})
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def admin_headers(test_admin):
    """Get auth headers for admin"""
    from app.core.security import create_access_token
    token = create_access_token(data={"sub": str(test_admin.id), "role": test_admin.role.value})
    return {"Authorization": f"Bearer {token}"}