from sqlalchemy import event
from sqlalchemy.schema import ForeignKeyConstraint, UniqueConstraint
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool
import logging

from app.config import settings
from app.db_compat import generate_model_id

logger = logging.getLogger(__name__)

engine_kwargs = {
    "echo": settings.log_sql_queries,
    "future": True,
}

if settings.is_ydb:
    engine_kwargs["poolclass"] = NullPool
    engine_kwargs["connect_args"] = settings.build_ydb_connect_args()
    logger.info("SQLAlchemy async engine initialized for YDB serverless with NullPool")
else:
    engine_kwargs["pool_pre_ping"] = settings.postgres_pool_pre_ping

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
_ydb_metadata_prepared = False


def _prepare_ydb_metadata(metadata) -> None:
    """
    Strip schema features that YDB serverless does not accept from ORM DDL.

    The application keeps referential and uniqueness checks at the service layer.
    For the free-tier YDB deployment we only need compatible CREATE TABLE
    statements so the function can cold-start successfully.
    """

    global _ydb_metadata_prepared
    if _ydb_metadata_prepared:
        return

    for table in metadata.tables.values():
        table.comment = None
        table.indexes.clear()

        removable_constraints = [
            constraint
            for constraint in list(table.constraints)
            if isinstance(constraint, (ForeignKeyConstraint, UniqueConstraint))
        ]
        for constraint in removable_constraints:
            table.constraints.discard(constraint)

        for column in table.columns:
            column.index = False
            column.unique = False
            column.comment = None

            for foreign_key in list(column.foreign_keys):
                column.foreign_keys.discard(foreign_key)

    _ydb_metadata_prepared = True


@event.listens_for(Base, "before_insert", propagate=True)
def assign_application_primary_keys(mapper, connection, target):
    """
    Fill bigint primary keys in application code.

    This keeps the existing SQLAlchemy models working both with PostgreSQL and
    with YDB, where BIGSERIAL-style autoincrement is not available.
    """

    if hasattr(target, "id") and getattr(target, "id", None) is None:
        setattr(target, "id", generate_model_id())


async def init_db():
    """Initialize database - create all tables"""
    try:
        if settings.is_ydb:
            _prepare_ydb_metadata(Base.metadata)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            logger.info("Database tables created successfully")
    except Exception as e:
        logger.error(f"Database initialization error: {e}")
        raise

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
