from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import httpx
import logging
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.config import settings
from app.core.exceptions import BillingServiceException, ServiceUnavailableException

logger = logging.getLogger(__name__)

MOCK_TARIFF_LIBRARY: Dict[str, Dict[str, Any]] = {
    "DEMO-100": {
        "tariff_id": "DEMO-100",
        "name": "Старт 100",
        "speed": 100,
        "speed_mbps": 100,
        "upload_speed_mbps": 50,
        "price": 490,
        "is_unlimited": True,
        "traffic_limit_gb": None,
    },
    "DEMO-200-FAMILY": {
        "tariff_id": "DEMO-200-FAMILY",
        "name": "Семейный 200",
        "speed": 200,
        "speed_mbps": 200,
        "upload_speed_mbps": 100,
        "price": 650,
        "is_unlimited": True,
        "traffic_limit_gb": None,
    },
    "DEMO-300": {
        "tariff_id": "DEMO-300",
        "name": "Город 300",
        "speed": 300,
        "speed_mbps": 300,
        "upload_speed_mbps": 150,
        "price": 790,
        "is_unlimited": True,
        "traffic_limit_gb": None,
    },
    "DEMO-500": {
        "tariff_id": "DEMO-500",
        "name": "Сцена 500",
        "speed": 500,
        "speed_mbps": 500,
        "upload_speed_mbps": 300,
        "price": 1090,
        "is_unlimited": True,
        "traffic_limit_gb": None,
    },
    "DEMO-700-TV": {
        "tariff_id": "DEMO-700-TV",
        "name": "Семья 700 + ТВ",
        "speed": 700,
        "speed_mbps": 700,
        "upload_speed_mbps": 400,
        "price": 1490,
        "is_unlimited": True,
        "traffic_limit_gb": None,
    },
    "DEMO-800-WORK": {
        "tariff_id": "DEMO-800-WORK",
        "name": "Офис дома 800",
        "speed": 800,
        "speed_mbps": 800,
        "upload_speed_mbps": 500,
        "price": 1690,
        "is_unlimited": True,
        "traffic_limit_gb": None,
    },
    "DEMO-1000": {
        "tariff_id": "DEMO-1000",
        "name": "Гигабит Премиум",
        "speed": 1000,
        "speed_mbps": 1000,
        "upload_speed_mbps": 700,
        "price": 1990,
        "is_unlimited": True,
        "traffic_limit_gb": None,
    },
    "DEMO-BIZ-1500": {
        "tariff_id": "DEMO-BIZ-1500",
        "name": "Бизнес Канал 1500",
        "speed": 1500,
        "speed_mbps": 1500,
        "upload_speed_mbps": 1000,
        "price": 3490,
        "is_unlimited": True,
        "traffic_limit_gb": None,
    },
}

MOCK_TARIFF_SELECTIONS: Dict[str, str] = {}
MOCK_BALANCES: Dict[str, float] = {}


def _mock_base_balance(billing_id: str) -> float:
    return float(1250 + sum(ord(char) for char in billing_id[-4:]) % 750)


def _mock_balance(billing_id: str) -> float:
    if billing_id not in MOCK_BALANCES:
        MOCK_BALANCES[billing_id] = _mock_base_balance(billing_id)
    return MOCK_BALANCES[billing_id]


def is_retryable_exception(exception):
    return isinstance(exception, (httpx.TimeoutException, httpx.NetworkError, httpx.ConnectError, httpx.HTTPStatusError))


class BillingService:
    def __init__(self):
        self.base_url = settings.billing_api_url
        self.api_key = settings.billing_api_key
        self.timeout = settings.billing_timeout
        self.client = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self.client is None or self.client.is_closed:
            self.client = httpx.AsyncClient(
                timeout=self.timeout,
                limits=httpx.Limits(max_keepalive_connections=20, max_connections=100),
            )
        return self.client

    async def _request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        if settings.demo_mode:
            return self._mock_response(method, endpoint, **kwargs)

        client = await self._get_client()
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-Request-ID": str(datetime.utcnow().timestamp()),
        }
        url = f"{self.base_url}{endpoint}"

        try:
            response = await client.request(method, url, headers=headers, **kwargs)
            response.raise_for_status()
            return response.json()
        except httpx.TimeoutException as exc:
            logger.error("Billing API timeout: %s", exc)
            if settings.debug:
                return self._mock_response(method, endpoint, **kwargs)
            raise ServiceUnavailableException(detail="Billing service timeout") from exc
        except httpx.HTTPStatusError as exc:
            logger.error("Billing API HTTP error: %s - %s", exc.response.status_code, exc.response.text)
            if settings.debug:
                return self._mock_response(method, endpoint, **kwargs)
            if exc.response.status_code == 401:
                raise BillingServiceException(detail="Billing API authentication failed") from exc
            if exc.response.status_code == 404:
                raise BillingServiceException(detail="Billing resource not found") from exc
            if exc.response.status_code >= 500:
                raise ServiceUnavailableException(detail="Billing service unavailable") from exc
            raise BillingServiceException(detail=f"Billing API error: {exc.response.status_code}") from exc
        except Exception as exc:
            logger.error("Billing API unexpected error: %s", exc)
            if settings.debug:
                return self._mock_response(method, endpoint, **kwargs)
            raise BillingServiceException(detail="Billing service communication error") from exc

    def _mock_response(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        path = endpoint.strip("/")
        parts = path.split("/")
        billing_id = parts[3] if len(parts) >= 4 else settings.demo_account_billing_id
        now = datetime.utcnow()
        json_payload = kwargs.get("json") or {}
        params = kwargs.get("params") or {}

        active_tariff_id = MOCK_TARIFF_SELECTIONS.get(billing_id, "DEMO-300")
        active_tariff = MOCK_TARIFF_LIBRARY.get(active_tariff_id, MOCK_TARIFF_LIBRARY["DEMO-300"])

        if endpoint.endswith("/balance"):
            return {"balance": _mock_balance(billing_id)}

        if endpoint.endswith("/tariff"):
            return active_tariff

        if "change_tariff" in endpoint and method.upper() == "POST":
            requested_tariff_id = str(json_payload.get("tariff_id") or active_tariff_id)
            selected_tariff = MOCK_TARIFF_LIBRARY.get(requested_tariff_id, active_tariff)
            MOCK_TARIFF_SELECTIONS[billing_id] = selected_tariff["tariff_id"]
            return {
                "success": True,
                "tariff_id": selected_tariff["tariff_id"],
                "tariff_name": selected_tariff["name"],
                "effective_from": now.isoformat(),
            }

        if endpoint.endswith("/add_payment") and method.upper() == "POST":
            amount = float(json_payload.get("amount") or 0)
            MOCK_BALANCES[billing_id] = round(_mock_balance(billing_id) + amount, 2)
            return {
                "success": True,
                "billing_id": billing_id,
                "payment_id": json_payload.get("payment_id"),
                "amount": amount,
                "balance": MOCK_BALANCES[billing_id],
                "processed_at": now.isoformat(),
            }

        if endpoint.startswith("/api/v2/abonents/") and len(parts) == 4:
            return {
                "billing_id": billing_id,
                "account_status": "active",
                "phone": settings.demo_account_phone if billing_id == settings.demo_account_billing_id else "+79000000000",
                "full_name": "Алина Волкова" if billing_id == settings.demo_account_billing_id else "Локальный абонент",
            }

        if endpoint.endswith("/payments"):
            return {"items": []}

        if endpoint.endswith("/traffic"):
            days = int(params.get("days", 30))
            daily_load = []
            for offset in range(days):
                day = now - timedelta(days=days - offset - 1)
                daily_load.append(
                    {
                        "date": day.strftime("%Y-%m-%d"),
                        "gb": round(8 + (offset % 6) * 2.4 + ((offset * 7) % 5), 1),
                    }
                )

            total_gb = round(sum(item["gb"] for item in daily_load), 1)
            return {
                "total_gb": total_gb,
                "daily_load": daily_load,
                "hourly_load": [],
                "peak_hour": "21:00",
                "average_daily": round(total_gb / max(days, 1), 1),
            }

        return {}

    @retry(
        stop=stop_after_attempt(settings.billing_retry_attempts),
        wait=wait_exponential(multiplier=settings.billing_retry_delay, min=1, max=10),
        retry=retry_if_exception(is_retryable_exception),
    )
    async def get_balance(self, billing_id: str) -> float:
        data = await self._request("GET", f"/api/v2/abonents/{billing_id}/balance")
        return float(data.get("balance", 0.0))

    @retry(
        stop=stop_after_attempt(settings.billing_retry_attempts),
        wait=wait_exponential(multiplier=settings.billing_retry_delay, min=1, max=10),
    )
    async def get_current_tariff(self, billing_id: str) -> Optional[Dict[str, Any]]:
        return await self._request("GET", f"/api/v2/abonents/{billing_id}/tariff")

    @retry(
        stop=stop_after_attempt(settings.billing_retry_attempts),
        wait=wait_exponential(multiplier=settings.billing_retry_delay, min=1, max=10),
    )
    async def change_tariff(self, billing_id: str, tariff_id: str) -> Dict[str, Any]:
        return await self._request(
            "POST",
            f"/api/v2/abonents/{billing_id}/change_tariff",
            json={"tariff_id": tariff_id, "source": "web_portal"},
        )

    @retry(
        stop=stop_after_attempt(settings.billing_retry_attempts),
        wait=wait_exponential(multiplier=settings.billing_retry_delay, min=1, max=10),
    )
    async def add_payment(self, billing_id: str, amount: float, payment_id: str = None) -> Dict[str, Any]:
        return await self._request(
            "POST",
            f"/api/v2/abonents/{billing_id}/add_payment",
            json={"amount": amount, "payment_id": payment_id, "source": "web_portal"},
        )

    async def get_account_info(self, billing_id: str) -> Optional[Dict[str, Any]]:
        try:
            return await self._request("GET", f"/api/v2/abonents/{billing_id}")
        except BillingServiceException:
            return None

    async def get_payment_history(self, billing_id: str, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        data = await self._request(
            "GET",
            f"/api/v2/abonents/{billing_id}/payments",
            params={"limit": limit, "offset": offset},
        )
        return data.get("items", [])

    async def get_traffic_stats(self, billing_id: str, days: int = 30) -> Dict[str, Any]:
        return await self._request(
            "GET",
            f"/api/v2/abonents/{billing_id}/traffic",
            params={"days": days},
        )

    async def check_debt(self, billing_id: str) -> bool:
        balance = await self.get_balance(billing_id)
        return balance < 0

    async def close(self):
        if self.client and not self.client.is_closed:
            await self.client.aclose()
