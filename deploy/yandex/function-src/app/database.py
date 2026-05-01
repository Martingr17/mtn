from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import text
from sqlalchemy.pool import NullPool
import logging

from app.config import settings

logger = logging.getLogger(__name__)

engine_kwargs = {
    "echo": settings.log_sql_queries,
    "future": True,
    "pool_pre_ping": settings.postgres_pool_pre_ping,
}

if settings.postgres_ssl:
    # Managed PostgreSQL with a public endpoint requires TLS.
    engine_kwargs["connect_args"] = {"ssl": "require"}

if settings.postgres_use_null_pool:
    engine_kwargs["poolclass"] = NullPool
    logger.info("SQLAlchemy async engine initialized with NullPool")
else:
    engine_kwargs["pool_size"] = settings.postgres_pool_size
    engine_kwargs["max_overflow"] = settings.postgres_max_overflow
    engine_kwargs["pool_timeout"] = settings.postgres_pool_timeout

engine = create_async_engine(
    settings.database_url,
    **engine_kwargs,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)

Base = declarative_base()

async def init_db():
    """Initialize database - create all tables"""
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            logger.info("Database tables created successfully")
    except Exception as e:
        logger.error(f"Database initialization error: {e}")
        raise

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
