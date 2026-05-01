from fastapi import FastAPI
from contextlib import asynccontextmanager
import logging
from app.database import engine, AsyncSessionLocal
from app.services.cache import redis_cache
from app.models import Tariff
from sqlalchemy import text, select

logger = logging.getLogger(__name__)

async def startup_event():
    """Actions to perform on application startup"""
    logger.info("Starting application...")

    # Test database connection
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        logger.info("Database connection successful")
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        raise

    # Test Redis connection
    try:
        await redis_cache.client.ping()
        logger.info("Redis connection successful")
    except Exception as e:
        logger.error(f"Redis connection failed: {e}")
        # Don't raise, Redis is optional for some features

    # Initialize default data if needed
    await init_default_data()

    # Warm up cache
    await warmup_cache()

    logger.info("Application startup complete")

async def shutdown_event():
    """Actions to perform on application shutdown"""
    logger.info("Shutting down application...")

    # Close database connections
    await engine.dispose()
    logger.info("Database connections closed")

    # Close Redis connection
    await redis_cache.close()
    logger.info("Redis connection closed")

    # Close WebSocket connections
    # WebSocket manager will handle cleanup

    logger.info("Application shutdown complete")

async def init_default_data():
    """Initialize default data if tables are empty"""
    async with AsyncSessionLocal() as session:
        # Check if tariffs exist
        result = await session.execute(select(Tariff).limit(1))
        if not result.first():
            logger.info("Initializing default tariffs...")
            default_tariffs = [
                Tariff(
                    billing_tariff_id="TARIFF_100",
                    name="Стартовый",
                    speed_mbps=100,
                    price=450.00,
                    setup_fee=0,
                    is_unlimited=True,
                    contract_term_months=12,
                    description="Базовый тариф для домашнего интернета",
                    is_active=True,
                    sort_order=1,
                ),
                Tariff(
                    billing_tariff_id="TARIFF_200",
                    name="Оптимальный",
                    speed_mbps=200,
                    price=650.00,
                    setup_fee=0,
                    is_unlimited=True,
                    contract_term_months=12,
                    description="Скорость до 200 Мбит/с",
                    is_active=True,
                    is_popular=True,
                    sort_order=2,
                ),
                Tariff(
                    billing_tariff_id="TARIFF_500",
                    name="Премиум",
                    speed_mbps=500,
                    price=950.00,
                    setup_fee=0,
                    is_unlimited=True,
                    contract_term_months=12,
                    description="Высокоскоростной интернет",
                    is_active=True,
                    sort_order=3,
                ),
                Tariff(
                    billing_tariff_id="TARIFF_1000",
                    name="Гигабитный",
                    speed_mbps=1000,
                    price=1450.00,
                    setup_fee=500,
                    is_unlimited=False,
                    traffic_limit_gb=5000,
                    contract_term_months=12,
                    description="Гигабитный интернет с ограничением 5 ТБ",
                    is_active=True,
                    sort_order=4,
                ),
            ]
            for tariff in default_tariffs:
                session.add(tariff)
            await session.commit()
            logger.info("Default tariffs initialized")

async def warmup_cache():
    """Warm up frequently accessed data in cache"""
    logger.info("Warming up cache...")

    # Cache tariffs list
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        from app.models import Tariff
        result = await session.execute(select(Tariff).where(Tariff.is_active == True))
        tariffs = result.scalars().all()

        tariffs_data = [
            {
                "id": t.id,
                "billing_tariff_id": t.billing_tariff_id,
                "name": t.name,
                "speed_mbps": t.speed_mbps,
                "price": float(t.price),
                "description": t.description,
                "is_popular": t.is_popular,
            }
            for t in tariffs
        ]
        await redis_cache.set("tariffs:list", tariffs_data, expire=3600)
        logger.info(f"Cached {len(tariffs)} tariffs")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI"""
    await startup_event()
    yield
    await shutdown_event()
