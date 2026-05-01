import ipaddress
import json
import uuid
from datetime import datetime, timedelta
from typing import Any, AsyncIterator, List

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import SpeedtestResult, User
from app.schemas.speedtest import (
    SpeedtestResultResponse,
    SpeedtestRunRequest,
    SpeedtestSessionResponse,
    SpeedtestStatsResponse,
)
from app.services.cache import redis_cache

router = APIRouter(prefix="/speedtest", tags=["speedtest"])

_CHUNK_SIZE = 64 * 1024


def _session_key(user_id: int) -> str:
    return f"speedtest:session:{user_id}"


def _safe_float(value: Any) -> float:
    if value is None:
        return 0.0
    return round(float(value), 2)


def _is_operator_network(client_ip: str) -> bool:
    if settings.demo_mode or not settings.speedtest_enforce_operator_network:
        return True

    try:
        parsed_ip = ipaddress.ip_address(client_ip)
    except ValueError:
        return False

    for cidr in settings.operator_network_cidrs:
        try:
            if parsed_ip in ipaddress.ip_network(cidr, strict=False):
                return True
        except ValueError:
            continue
    return False


async def _get_active_session(user_id: int) -> dict | None:
    raw = await redis_cache.client.get(_session_key(user_id))
    if not raw:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8")
    return json.loads(raw)


async def _require_active_session(user_id: int, session_id: str) -> dict:
    payload = await _get_active_session(user_id)
    if not payload or payload.get("session_id") != session_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Сессия speedtest не найдена или уже завершена. Запустите тест заново.",
        )
    return payload


async def _release_session(user_id: int) -> None:
    await redis_cache.client.delete(_session_key(user_id))


async def _binary_stream(total_bytes: int) -> AsyncIterator[bytes]:
    remaining = total_bytes
    chunk = b"0" * _CHUNK_SIZE
    while remaining > 0:
        current = min(remaining, _CHUNK_SIZE)
        yield chunk[:current]
        remaining -= current


@router.post("/session", response_model=SpeedtestSessionResponse)
async def start_speedtest_session(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_ip = request.client.host if request.client else "unknown"
    if not _is_operator_network(client_ip):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Запуск speedtest разрешён только из сети оператора.",
        )

    one_hour_ago = datetime.utcnow() - timedelta(hours=1)
    tests_in_last_hour = await db.scalar(
        select(func.count())
        .select_from(SpeedtestResult)
        .where(
            SpeedtestResult.user_id == current_user.id,
            SpeedtestResult.created_at >= one_hour_ago,
        ),
    )
    if (tests_in_last_hour or 0) >= settings.speedtest_max_per_hour:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Можно запускать не более {settings.speedtest_max_per_hour} тестов в час.",
        )

    session_payload = {
        "session_id": str(uuid.uuid4()),
        "user_id": current_user.id,
        "ip_address": client_ip,
        "started_at": datetime.utcnow().isoformat(),
    }
    acquired = await redis_cache.client.set(
        _session_key(current_user.id),
        json.dumps(session_payload),
        ex=settings.speedtest_session_ttl_seconds,
        nx=True,
    )
    if not acquired:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Тест уже выполняется. Дождитесь завершения текущего измерения.",
        )

    return SpeedtestSessionResponse(
        session_id=session_payload["session_id"],
        expires_in=settings.speedtest_session_ttl_seconds,
        download_size_mb=settings.speedtest_download_size_mb,
        upload_size_mb=settings.speedtest_upload_size_mb,
        max_tests_per_hour=settings.speedtest_max_per_hour,
        network_check_enabled=settings.speedtest_enforce_operator_network and not settings.demo_mode,
    )


@router.get("/ping")
async def speedtest_ping(
    session_id: str,
    response: Response,
    current_user: User = Depends(get_current_user),
):
    await _require_active_session(current_user.id, session_id)
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True, "server_time": datetime.utcnow().isoformat()}


@router.get("/download")
async def speedtest_download(
    session_id: str,
    size_mb: int = Query(default=settings.speedtest_download_size_mb, ge=1, le=20),
    current_user: User = Depends(get_current_user),
):
    await _require_active_session(current_user.id, session_id)
    total_bytes = size_mb * 1024 * 1024
    headers = {
        "Cache-Control": "no-store",
        "Content-Length": str(total_bytes),
        "X-Speedtest-Size-MB": str(size_mb),
    }
    return StreamingResponse(_binary_stream(total_bytes), media_type="application/octet-stream", headers=headers)


@router.post("/upload")
async def speedtest_upload(
    request: Request,
    session_id: str,
    current_user: User = Depends(get_current_user),
):
    await _require_active_session(current_user.id, session_id)
    total_bytes = 0
    async for chunk in request.stream():
        total_bytes += len(chunk)
    return {"ok": True, "bytes_received": total_bytes}


@router.post("/run", response_model=SpeedtestResultResponse)
async def complete_speedtest_run(
    payload: SpeedtestRunRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_active_session(current_user.id, payload.session_id)

    result = SpeedtestResult(
        user_id=current_user.id,
        download_mbps=round(payload.download_mbps, 2),
        upload_mbps=round(payload.upload_mbps, 2),
        ping_ms=round(payload.ping_ms, 2),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", ""),
        server_meta={
            "download_size_mb": settings.speedtest_download_size_mb,
            "upload_size_mb": settings.speedtest_upload_size_mb,
        },
    )
    db.add(result)
    await db.commit()
    await db.refresh(result)
    await _release_session(current_user.id)
    return result


@router.delete("/session")
async def cancel_speedtest_session(
    current_user: User = Depends(get_current_user),
):
    await _release_session(current_user.id)
    return {"ok": True}


@router.get("/history", response_model=List[SpeedtestResultResponse])
async def get_speedtest_history(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(SpeedtestResult)
        .where(SpeedtestResult.user_id == current_user.id)
        .order_by(desc(SpeedtestResult.created_at))
        .limit(10),
    )
    return result.scalars().all()


@router.get("/stats", response_model=SpeedtestStatsResponse)
async def get_speedtest_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    aggregate = await db.execute(
        select(
            func.avg(SpeedtestResult.download_mbps),
            func.avg(SpeedtestResult.upload_mbps),
            func.min(SpeedtestResult.ping_ms),
            func.count(SpeedtestResult.id),
            func.max(SpeedtestResult.created_at),
        ).where(SpeedtestResult.user_id == current_user.id),
    )
    avg_download, avg_upload, min_ping, total_tests, last_test_at = aggregate.one()

    return SpeedtestStatsResponse(
        avg_download=_safe_float(avg_download),
        avg_upload=_safe_float(avg_upload),
        min_ping=_safe_float(min_ping),
        total_tests=int(total_tests or 0),
        last_test_at=last_test_at,
    )
