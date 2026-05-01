"""API endpoint module exports."""

from app.api.v1.endpoints import (
    admin,
    auth,
    billing,
    health,
    monitoring,
    notifications,
    payments,
    search,
    speedtest,
    statistics,
    tariffs,
    tickets,
    users,
    websocket,
    webhooks,
)

__all__ = [
    "admin",
    "auth",
    "billing",
    "health",
    "monitoring",
    "notifications",
    "payments",
    "search",
    "speedtest",
    "statistics",
    "tariffs",
    "tickets",
    "users",
    "webhooks",
    "websocket",
]
