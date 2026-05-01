import pytest
import asyncio
from typing import AsyncGenerator, Generator
from httpx import AsyncClient
import asyncpg
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.engine import make_url
from app.main import app
from app.database import get_db, Base
from app.models import User, Tariff
from app.core.security import get_password_hash

# Test database URL
TEST_DATABASE_URL = "postgresql+asyncpg://operator:securepassword@localhost:5433/operator_test"
TEST_DATABASE_CONFIG = make_url(TEST_DATABASE_URL)

engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestingSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def ensure_test_database() -> None:
    try:
        connection = await asyncpg.connect(
            host=TEST_DATABASE_CONFIG.host,
            port=TEST_DATABASE_CONFIG.port,
            user=TEST_DATABASE_CONFIG.username,
            password=TEST_DATABASE_CONFIG.password,
            database=TEST_DATABASE_CONFIG.database,
        )
        await connection.close()
        return
    except asyncpg.InvalidCatalogNameError:
        pass

    admin_connection = await asyncpg.connect(
        host=TEST_DATABASE_CONFIG.host,
        port=TEST_DATABASE_CONFIG.port,
        user=TEST_DATABASE_CONFIG.username,
        password=TEST_DATABASE_CONFIG.password,
        database="postgres",
    )
    try:
        exists = await admin_connection.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1",
            TEST_DATABASE_CONFIG.database,
        )
        if not exists:
            await admin_connection.execute(f'CREATE DATABASE "{TEST_DATABASE_CONFIG.database}"')
    finally:
        await admin_connection.close()

async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with TestingSessionLocal() as session:
        yield session

app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(scope="session")
def event_loop() -> Generator:
    """Create event loop for tests"""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()

@pytest.fixture(autouse=True, scope="session")
def setup_database(event_loop):
    """Setup test database"""
    async def _setup():
        await ensure_test_database()
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

    event_loop.run_until_complete(_setup())
    yield

@pytest.fixture()
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Get database session"""
    async with TestingSessionLocal() as session:
        yield session

@pytest.fixture()
async def client() -> AsyncGenerator[AsyncClient, None]:
    """HTTP client for testing"""
    async with AsyncClient(app=app, base_url="http://localhost") as client:
        yield client

@pytest.fixture()
async def test_user(db_session: AsyncSession):
    """Create test user"""
    user = User(
        billing_id="TEST123",
        phone="+79991234567",
        email="test@example.com",
        password_hash=get_password_hash("Test123!@#"),
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user

@pytest.fixture()
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
        is_verified=True,
    )
    db_session.add(admin)
    await db_session.commit()
    await db_session.refresh(admin)
    return admin

@pytest.fixture()
async def test_tariff(db_session: AsyncSession):
    """Create test tariff"""
    tariff = Tariff(
        billing_tariff_id="TEST_TARIFF",
        name="Test Tariff",
        speed_mbps=100,
        price=500.00,
        is_active=True,
    )
    db_session.add(tariff)
    await db_session.commit()
    await db_session.refresh(tariff)
    return tariff

@pytest.fixture()
async def auth_headers(test_user):
    """Get auth headers for test user"""
    from app.core.security import create_access_token
    token = create_access_token(data={"sub": str(test_user.id), "role": test_user.role.value})
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture()
async def admin_headers(test_admin):
    """Get auth headers for admin"""
    from app.core.security import create_access_token
    token = create_access_token(data={"sub": str(test_admin.id), "role": test_admin.role.value})
    return {"Authorization": f"Bearer {token}"}
