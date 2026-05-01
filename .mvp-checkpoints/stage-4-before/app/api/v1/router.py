from fastapi import APIRouter
from app.api.v1.endpoints import (
    auth, users, tariffs, payments, tickets, notifications,
    statistics, admin, webhooks, billing, health, search, speedtest, monitoring, radius,
    subscribers,
)

api_router = APIRouter()

# Public endpoints
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router)
api_router.include_router(webhooks.router)

# Protected endpoints
api_router.include_router(users.router)
api_router.include_router(tariffs.router)
api_router.include_router(payments.router)
api_router.include_router(tickets.router)
api_router.include_router(notifications.router)
api_router.include_router(notifications.admin_router)
api_router.include_router(statistics.router)
api_router.include_router(speedtest.router)
api_router.include_router(monitoring.router)
api_router.include_router(subscribers.router)
api_router.include_router(radius.router)
api_router.include_router(billing.router)
api_router.include_router(search.router)

# Admin endpoints
api_router.include_router(admin.router)
