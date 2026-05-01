from typing import Any, Dict

from app.services.billing import BillingService


class TrafficStatsService:
    async def get_user_traffic(self, billing_id: str, days: int = 30) -> Dict[str, Any]:
        billing = BillingService()
        data = await billing.get_traffic_stats(billing_id, days)
        return {
            "total_gb": data.get("total_gb", 0),
            "daily_load": data.get("daily_load", []),
            "hourly_load": data.get("hourly_load", []),
            "peak_hour": data.get("peak_hour"),
            "average_daily": data.get("average_daily"),
        }
