from __future__ import annotations

import random
import threading
import time
from datetime import time as dt_time

from sqlalchemy import DateTime, JSON, String, Time
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.types import TypeDecorator


AwareTimestamp = DateTime(timezone=True)
JsonType = JSON


class IpAddressType(TypeDecorator):
    """Store IP addresses portably across PostgreSQL and YDB.

    PostgreSQL benefits from its native `INET` type, while YDB expects
    strings. Keeping the model aligned with both dialects avoids bind-time
    type mismatches on local Postgres and keeps serverless YDB compatible.
    """

    impl = String(45)
    cache_ok = True

    @staticmethod
    def _is_ydb_dialect(dialect) -> bool:
        return getattr(dialect, "name", "") in {"ydb", "yql"} or getattr(dialect, "name", "").startswith("ydb")

    def load_dialect_impl(self, dialect):
        if getattr(dialect, "name", "") == "postgresql":
            return dialect.type_descriptor(INET())
        if self._is_ydb_dialect(dialect):
            return dialect.type_descriptor(String(45))
        return dialect.type_descriptor(String(45))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return str(value).strip() or None

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return str(value)

_CUSTOM_EPOCH_MS = 1704067200000  # 2024-01-01T00:00:00Z
_NODE_BITS = 10
_SEQUENCE_BITS = 12
_MAX_SEQUENCE = (1 << _SEQUENCE_BITS) - 1

_generator_lock = threading.Lock()
_node_id = random.SystemRandom().randrange(1 << _NODE_BITS)
_last_timestamp_ms = -1
_sequence = 0


class TimeOfDayType(TypeDecorator):
    """Store time-of-day values portably across PostgreSQL and YDB.

    YDB serverless does not support SQL TIME, so we persist `HH:MM:SS` strings
    there and transparently convert them back to `datetime.time`.
    """

    impl = String(8)
    cache_ok = True

    @staticmethod
    def _is_ydb_dialect(dialect) -> bool:
        return getattr(dialect, "name", "") in {"ydb", "yql"} or getattr(dialect, "name", "").startswith("ydb")

    def load_dialect_impl(self, dialect):
        if self._is_ydb_dialect(dialect):
            return dialect.type_descriptor(String(8))
        return dialect.type_descriptor(Time(timezone=False))

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, str):
            return value if self._is_ydb_dialect(dialect) else dt_time.fromisoformat(value)
        if isinstance(value, dt_time):
            normalized = value.replace(tzinfo=None)
            return normalized.isoformat() if self._is_ydb_dialect(dialect) else normalized
        raise TypeError(f"Unsupported time value: {value!r}")

    def process_result_value(self, value, dialect):
        if value is None or isinstance(value, dt_time):
            return value
        if isinstance(value, str):
            return dt_time.fromisoformat(value)
        return value


def generate_model_id() -> int:
    """Generate a sortable signed 64-bit integer identifier.

    YDB does not provide PostgreSQL-style BIGSERIAL semantics, so we assign
    primary keys in application code. The layout is timestamp + node + sequence,
    which keeps inserts ordered and collision-free within a process.
    """
    global _last_timestamp_ms, _sequence

    with _generator_lock:
        timestamp_ms = int(time.time() * 1000)
        if timestamp_ms < _last_timestamp_ms:
            timestamp_ms = _last_timestamp_ms

        if timestamp_ms == _last_timestamp_ms:
            _sequence = (_sequence + 1) & _MAX_SEQUENCE
            if _sequence == 0:
                while timestamp_ms <= _last_timestamp_ms:
                    time.sleep(0.001)
                    timestamp_ms = int(time.time() * 1000)
        else:
            _sequence = 0

        _last_timestamp_ms = timestamp_ms

        timestamp_component = timestamp_ms - _CUSTOM_EPOCH_MS
        return (
            (timestamp_component << (_NODE_BITS + _SEQUENCE_BITS))
            | (_node_id << _SEQUENCE_BITS)
            | _sequence
        )


def enum_database_values(enum_cls) -> list[str]:
    """Return enum values as they are defined in Alembic PostgreSQL enums."""
    return [
        item.value if isinstance(item.value, str) else item.name.lower()
        for item in enum_cls
    ]
