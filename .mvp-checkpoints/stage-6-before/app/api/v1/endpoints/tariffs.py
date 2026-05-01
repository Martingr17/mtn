from fastapi import APIRouter, Depends, HTTPException, status, Request, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from datetime import datetime, timedelta

from app.database import get_db
from app.models import Tariff, User, TariffChangeRequest, UserRole
from app.schemas.tariff import (
    TariffResponse,
    TariffChangeRequest as TariffChangeSchema,
    TariffCompareResponse,
    TariffAdminUpsertRequest,
    TariffAdminUpdateRequest,
)
from app.dependencies import get_current_user, require_roles
from app.services.billing import BillingService
from app.services.cache import cache_get, cache_set, cache_delete
from app.core.logger import log_activity
from app.core.constants import CacheKeys

router = APIRouter(prefix="/tariffs", tags=["tariffs"])


async def _invalidate_tariff_cache(tariff_id: Optional[int] = None) -> None:
    await cache_delete(CacheKeys.TARIFFS_LIST)
    if tariff_id is not None:
        await cache_delete(CacheKeys.tariff_detail_key(tariff_id))


def _next_month_start(now: datetime) -> datetime:
    month_anchor = now.replace(day=28, hour=0, minute=0, second=0, microsecond=0)
    next_month = month_anchor + timedelta(days=4)
    return next_month.replace(day=1)

@router.get("/", response_model=List[TariffResponse])
async def list_tariffs(
    db: AsyncSession = Depends(get_db),
    include_inactive: bool = False,
    limit: Optional[int] = None,
):
    """Получить список тарифов"""
    # Try cache first
    cache_key = CacheKeys.TARIFFS_LIST
    if not include_inactive:
        cached = await cache_get(cache_key)
        if cached:
            return cached

    # Build query
    query = select(Tariff)
    if not include_inactive:
        query = query.where(Tariff.is_active == True)

    query = query.order_by(Tariff.sort_order, Tariff.price)
    if limit and limit > 0:
        query = query.limit(min(limit, 24))

    result = await db.execute(query)
    tariffs = result.scalars().all()

    response = [TariffResponse.model_validate(t) for t in tariffs]

    # Cache only active tariffs
    if not include_inactive:
        await cache_set(cache_key, [r.model_dump() for r in response], expire=3600)

    return response

@router.get("/compare", response_model=List[TariffCompareResponse])
async def compare_tariffs(
    tariff_ids: str,
    db: AsyncSession = Depends(get_db),
):
    """Сравнение нескольких тарифов"""
    ids = [int(x) for x in tariff_ids.split(",") if x.isdigit()]
    if len(ids) < 2 or len(ids) > 4:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Для сравнения выберите от 2 до 4 тарифов")

    result = await db.execute(
        select(Tariff).where(Tariff.id.in_(ids), Tariff.is_active == True),
    )
    tariffs = result.scalars().all()

    if len(tariffs) != len(ids):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Часть выбранных тарифов не найдена")

    return [TariffCompareResponse.model_validate(t) for t in tariffs]

@router.get("/{tariff_id}", response_model=TariffResponse)
async def get_tariff(
    tariff_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Получить тариф по идентификатору"""
    # Try cache
    cache_key = f"{CacheKeys.TARIFF_DETAIL}{tariff_id}"
    cached = await cache_get(cache_key)
    if cached:
        return cached

    result = await db.execute(select(Tariff).where(Tariff.id == tariff_id))
    tariff = result.scalar_one_or_none()

    if not tariff:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Тариф не найден")

    response = TariffResponse.model_validate(tariff)
    await cache_set(cache_key, response.model_dump(), expire=3600)

    return response

@router.post("/change")
async def change_tariff(
    request: Request,
    change_data: TariffChangeSchema,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Сменить тариф пользователя"""
    # Get new tariff from DB
    result = await db.execute(select(Tariff).where(Tariff.id == change_data.tariff_id, Tariff.is_active == True))
    new_tariff = result.scalar_one_or_none()

    if not new_tariff:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Тариф не найден или временно недоступен")

    # Get current tariff from billing
    billing = BillingService()
    try:
        current_tariff_data = await billing.get_current_tariff(current_user.billing_id)
        current_tariff_id = current_tariff_data.get("tariff_id") if current_tariff_data else None

        # Check if already on this tariff
        if current_tariff_id == new_tariff.billing_tariff_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Этот тариф уже подключён")

        # Check for debt
        balance = await billing.get_balance(current_user.billing_id)
        if balance < 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Нельзя сменить тариф при задолженности. Сумма долга: {abs(balance)} ₽",
            )

        activation_mode = change_data.effective_from or "next_month"
        effective_from = datetime.utcnow() if activation_mode == "today" else _next_month_start(datetime.utcnow())

        # Create change request record
        change_request = TariffChangeRequest(
            user_id=current_user.id,
            old_tariff_id=None,  # We don't store old tariff locally
            new_tariff_id=new_tariff.id,
            status="pending",
            requested_at=datetime.utcnow(),
            ip_address=request.client.host,
            user_agent=request.headers.get("user-agent", ""),
        )
        db.add(change_request)
        await db.flush()

        # Execute tariff change via billing API
        result = await billing.change_tariff(current_user.billing_id, new_tariff.billing_tariff_id)

        if result.get("success"):
            change_request.status = "completed"
            change_request.processed_at = datetime.utcnow()
            change_request.effective_from = effective_from
            await db.commit()

            # Invalidate cache
            await cache_delete(CacheKeys.user_tariff_key(current_user.id))

            # Log activity
            await log_activity(
                db, current_user.id, "tariff_change",
                request.client.host, request.headers.get("user-agent", ""),
                extra={
                    "old_tariff": current_tariff_id,
                    "new_tariff": new_tariff.billing_tariff_id,
                    "effective_from": activation_mode,
                },
            )

            # Send notification
            background_tasks.add_task(
                send_tariff_change_notification,
                current_user,
                new_tariff.name,
            )

            return {
                "message": f"Тариф успешно изменён на «{new_tariff.name}»",
                "effective_from": change_request.effective_from,
                "activation_mode": activation_mode,
            }
        else:
            change_request.status = "failed"
            change_request.error_message = result.get("error", "Unknown error")
            await db.commit()

            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=result.get("error", "Не удалось изменить тариф"),
            )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=f"Ошибка биллинга: {e!s}")

@router.get("/history", response_model=List[dict])
async def tariff_change_history(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    limit: int = 50,
):
    """История смены тарифов"""
    result = await db.execute(
        select(TariffChangeRequest)
        .where(TariffChangeRequest.user_id == current_user.id)
        .order_by(TariffChangeRequest.requested_at.desc())
        .limit(limit),
    )
    requests = result.scalars().all()

    history = []
    for req in requests:
        # Get tariff names
        new_tariff_result = await db.execute(select(Tariff).where(Tariff.id == req.new_tariff_id))
        new_tariff = new_tariff_result.scalar_one_or_none()

        history.append({
            "id": req.id,
            "new_tariff_name": new_tariff.name if new_tariff else "Неизвестный тариф",
            "status": req.status,
            "requested_at": req.requested_at,
            "processed_at": req.processed_at,
            "effective_from": req.effective_from,
            "error_message": req.error_message,
        })

    return history

@router.post("/admin/force-change")
async def admin_force_tariff_change(
    request: Request,
    user_id: int,
    tariff_id: int,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_roles([UserRole.ADMIN, UserRole.SUPER_ADMIN])),
):
    """Административная принудительная смена тарифа"""
    # Get user
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Пользователь не найден")

    # Get tariff
    tariff_result = await db.execute(select(Tariff).where(Tariff.id == tariff_id))
    tariff = tariff_result.scalar_one_or_none()
    if not tariff:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Тариф не найден")

    # Execute via billing
    billing = BillingService()
    try:
        result = await billing.change_tariff(user.billing_id, tariff.billing_tariff_id)

        if result.get("success"):
            # Log admin action
            await log_activity(
                db, admin.id, "admin_tariff_force_change",
                request.client.host, request.headers.get("user-agent", ""),
                extra={"target_user": user_id, "new_tariff": tariff.billing_tariff_id},
            )

            return {"message": f"Тариф пользователя {user.phone} изменён на «{tariff.name}»"}
        else:
            raise HTTPException(status_code=400, detail=result.get("error", "Не удалось сменить тариф"))

    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Ошибка биллинга: {e!s}")

@router.get("/admin/list", response_model=List[TariffResponse])
async def admin_list_tariffs(
    include_inactive: bool = True,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_roles([UserRole.ADMIN, UserRole.SUPER_ADMIN])),
):
    query = select(Tariff)
    if not include_inactive:
        query = query.where(Tariff.is_active == True)
    query = query.order_by(Tariff.sort_order, Tariff.price, Tariff.id)
    result = await db.execute(query)
    tariffs = result.scalars().all()
    return [TariffResponse.model_validate(item) for item in tariffs]


@router.post("/admin", response_model=TariffResponse)
async def create_tariff(
    payload: TariffAdminUpsertRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_roles([UserRole.ADMIN, UserRole.SUPER_ADMIN])),
):
    existing = await db.execute(
        select(Tariff).where(Tariff.billing_tariff_id == payload.billing_tariff_id.strip()),
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Тариф с таким billing ID уже существует")

    tariff = Tariff(
        billing_tariff_id=payload.billing_tariff_id.strip(),
        name=payload.name.strip(),
        speed_mbps=payload.speed_mbps,
        upload_speed_mbps=payload.upload_speed_mbps,
        price=payload.price,
        setup_fee=payload.setup_fee,
        description=(payload.description or "").strip() or None,
        features=payload.features,
        is_active=payload.is_active,
        is_popular=payload.is_popular,
        sort_order=payload.sort_order,
        is_unlimited=payload.is_unlimited,
        traffic_limit_gb=payload.traffic_limit_gb if not payload.is_unlimited else None,
        contract_term_months=payload.contract_term_months,
        created_by=admin.id,
    )
    db.add(tariff)
    await db.commit()
    await db.refresh(tariff)

    await _invalidate_tariff_cache(tariff.id)
    await log_activity(
        db,
        admin.id,
        "admin_tariff_create",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"tariff_id": tariff.id, "billing_tariff_id": tariff.billing_tariff_id},
    )
    return TariffResponse.model_validate(tariff)


@router.put("/admin/{tariff_id}", response_model=TariffResponse)
async def update_tariff(
    tariff_id: int,
    payload: TariffAdminUpdateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_roles([UserRole.ADMIN, UserRole.SUPER_ADMIN])),
):
    result = await db.execute(select(Tariff).where(Tariff.id == tariff_id))
    tariff = result.scalar_one_or_none()
    if not tariff:
        raise HTTPException(status_code=404, detail="Тариф не найден")

    data = payload.model_dump(exclude_unset=True)
    if "billing_tariff_id" in data:
        candidate = data["billing_tariff_id"].strip()
        duplicate = await db.execute(
            select(Tariff).where(Tariff.billing_tariff_id == candidate, Tariff.id != tariff_id),
        )
        if duplicate.scalar_one_or_none():
            raise HTTPException(status_code=409, detail="Другой тариф уже использует этот billing ID")
        tariff.billing_tariff_id = candidate

    for field in (
        "name",
        "speed_mbps",
        "upload_speed_mbps",
        "price",
        "setup_fee",
        "features",
        "is_active",
        "is_popular",
        "sort_order",
        "is_unlimited",
        "traffic_limit_gb",
        "contract_term_months",
    ):
        if field in data:
            setattr(tariff, field, data[field])

    if "name" in data and data["name"] is not None:
        tariff.name = data["name"].strip()
    if "description" in data:
        tariff.description = (data["description"] or "").strip() or None
    if tariff.is_unlimited:
        tariff.traffic_limit_gb = None

    await db.commit()
    await db.refresh(tariff)

    await _invalidate_tariff_cache(tariff.id)
    await log_activity(
        db,
        admin.id,
        "admin_tariff_update",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"tariff_id": tariff.id},
    )
    return TariffResponse.model_validate(tariff)


@router.delete("/admin/{tariff_id}")
async def archive_tariff(
    tariff_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_roles([UserRole.ADMIN, UserRole.SUPER_ADMIN])),
):
    result = await db.execute(select(Tariff).where(Tariff.id == tariff_id))
    tariff = result.scalar_one_or_none()
    if not tariff:
        raise HTTPException(status_code=404, detail="Тариф не найден")

    tariff.is_active = False
    await db.commit()

    await _invalidate_tariff_cache(tariff.id)
    await log_activity(
        db,
        admin.id,
        "admin_tariff_archive",
        request.client.host if request.client else None,
        request.headers.get("user-agent", ""),
        extra={"tariff_id": tariff.id},
    )
    return {"message": "Тариф переведён в архив"}


async def send_tariff_change_notification(user: User, tariff_name: str):
    """Уведомление о смене тарифа"""
    from app.services.email import send_email
    from app.services.websocket_manager import websocket_manager

    # Send email
    if user.email:
        await send_email(
            user.email,
            "Тарифный план изменён",
            f"Ваш тарифный план изменён на «{tariff_name}».\n\nНовые условия начнут действовать со следующего расчётного периода.",
        )

    # Send WebSocket notification
    await websocket_manager.send_personal_message(
        user.id,
        {
            "type": "tariff_changed",
            "tariff_name": tariff_name,
            "timestamp": datetime.utcnow().isoformat(),
        },
    )
