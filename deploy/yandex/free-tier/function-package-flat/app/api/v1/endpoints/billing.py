from fastapi import APIRouter, Depends, HTTPException

from app.models import User
from app.dependencies import get_current_user
from app.services.billing import BillingService
from app.services.cache import cache_get, cache_set

router = APIRouter(prefix="/billing", tags=["billing"])

@router.get("/balance")
async def get_balance(
    current_user: User = Depends(get_current_user),
):
    """Получить текущий баланс пользователя"""
    cache_key = f"user_balance:{current_user.id}"
    cached = await cache_get(cache_key)
    if cached is not None:
        return {"balance": cached}

    billing = BillingService()
    try:
        balance = await billing.get_balance(current_user.billing_id)
        await cache_set(cache_key, balance, expire=300)
        return {"balance": balance}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Ошибка биллинга: {e!s}")

@router.get("/tariff")
async def get_current_tariff(
    current_user: User = Depends(get_current_user),
):
    """Получить текущий тариф пользователя"""
    cache_key = f"user_tariff:{current_user.id}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    billing = BillingService()
    try:
        tariff = await billing.get_current_tariff(current_user.billing_id)
        await cache_set(cache_key, tariff, expire=3600)
        return tariff
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Ошибка биллинга: {e!s}")
