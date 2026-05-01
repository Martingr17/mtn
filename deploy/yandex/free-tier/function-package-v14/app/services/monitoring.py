from __future__ import annotations

import random
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Optional, Sequence

from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.constants import NotificationPriority, NotificationType
from app.models import (
    AlertThreshold,
    MonitoringAlert,
    MonitoringMetric,
    MonitoringNotificationSetting,
    User,
)
from app.schemas.monitoring import MonitoringMetricPoint
from app.services.billing import BillingService
from app.services.cache import redis_cache
from app.services.notification_center import (
    create_notification,
    ensure_notification_settings,
    update_notification_settings as update_unified_notification_settings,
)
from app.services.websocket_manager import websocket_manager


DEFAULT_ALERT_THRESHOLDS: Sequence[Dict[str, Any]] = (
    {
        "metric_name": "ping_ms",
        "condition": ">",
        "warning_value": 100,
        "critical_value": 300,
        "warning_duration_minutes": 5,
        "critical_duration_minutes": 2,
    },
    {
        "metric_name": "packet_loss_pct",
        "condition": ">",
        "warning_value": 2,
        "critical_value": 10,
        "warning_duration_minutes": 3,
        "critical_duration_minutes": 1,
    },
    {
        "metric_name": "download_ratio",
        "condition": "<",
        "warning_value": 0.70,
        "critical_value": 0.30,
        "warning_duration_minutes": 15,
        "critical_duration_minutes": 5,
    },
    {
        "metric_name": "jitter_ms",
        "condition": ">",
        "warning_value": 50,
        "critical_value": 120,
        "warning_duration_minutes": 5,
        "critical_duration_minutes": 2,
    },
    {
        "metric_name": "no_connection",
        "condition": ">=",
        "warning_value": None,
        "critical_value": 100,
        "warning_duration_minutes": 2,
        "critical_duration_minutes": 2,
    },
)

INTERVAL_MAP: Dict[str, timedelta] = {
    "5m": timedelta(minutes=5),
    "15m": timedelta(minutes=15),
    "30m": timedelta(minutes=30),
    "1h": timedelta(hours=1),
    "6h": timedelta(hours=6),
    "12h": timedelta(hours=12),
    "1d": timedelta(days=1),
}

QUALITY_LABELS = {
    "good": "Сейчас всё хорошо",
    "warning": "Обнаружены отклонения",
    "critical": "Связь нестабильна",
    "no_data": "Нет свежих данных",
}

ALERT_TYPE_META = {
    "high_ping": {"title": "Повышенная задержка", "icon": "⚠️"},
    "packet_loss": {"title": "Потеря пакетов", "icon": "⚠️"},
    "slow_speed": {"title": "Снижение скорости", "icon": "⚠️"},
    "high_jitter": {"title": "Высокий джиттер", "icon": "⚠️"},
    "no_connection": {"title": "Нет ответа от линии", "icon": "🚨"},
}


@dataclass
class ThresholdEvaluation:
    severity: Optional[str]
    alert_type: Optional[str]
    metric_name: Optional[str]
    threshold_value: Optional[float]
    current_value: Optional[float]
    duration_minutes: Optional[int]
    message: Optional[str]


def _safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    return round(float(value), 2)


def _utcnow() -> datetime:
    return datetime.utcnow().replace(second=0, microsecond=0)


def _normalize_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _bucket_interval(interval: str) -> timedelta:
    return INTERVAL_MAP.get(interval, timedelta(hours=1))


def _bucket_timestamp(value: datetime, interval: timedelta) -> datetime:
    seconds = max(int(interval.total_seconds()), 1)
    epoch = int(value.timestamp())
    return datetime.utcfromtimestamp(epoch - (epoch % seconds))


def _format_chart_label(value: datetime, total_range: timedelta) -> str:
    if total_range <= timedelta(days=2):
        return value.strftime("%H:%M")
    if total_range <= timedelta(days=8):
        return value.strftime("%d.%m %H:%M")
    return value.strftime("%d.%m")


def _is_staff(user: User) -> bool:
    role = user.role.value if hasattr(user.role, "value") else str(user.role)
    return role in {"operator", "admin", "super_admin"}


def _compare(condition: str, value: Optional[float], threshold: Optional[float]) -> bool:
    if value is None or threshold is None:
        return False
    if condition == ">":
        return value > threshold
    if condition == ">=":
        return value >= threshold
    if condition == "<":
        return value < threshold
    if condition == "<=":
        return value <= threshold
    return False


def _quality_score_from_values(
    *,
    ping_ms: Optional[float],
    packet_loss_pct: Optional[float],
    jitter_ms: Optional[float],
    download_mbps: Optional[float],
    expected_download_mbps: Optional[float],
) -> int:
    if all(value is None for value in (ping_ms, packet_loss_pct, jitter_ms, download_mbps)):
        return 0

    score = 100
    if ping_ms is not None:
        if ping_ms > 300:
            score -= 42
        elif ping_ms > 100:
            score -= 20
        elif ping_ms > 60:
            score -= 8

    if packet_loss_pct is not None:
        if packet_loss_pct >= 100:
            score -= 70
        elif packet_loss_pct > 10:
            score -= 38
        elif packet_loss_pct > 2:
            score -= 18

    if jitter_ms is not None:
        if jitter_ms > 120:
            score -= 28
        elif jitter_ms > 50:
            score -= 14

    if expected_download_mbps and download_mbps is not None:
        ratio = download_mbps / expected_download_mbps if expected_download_mbps > 0 else 1
        if ratio < 0.30:
            score -= 35
        elif ratio < 0.70:
            score -= 16
        elif ratio < 0.85:
            score -= 7

    return max(0, min(100, int(round(score))))


def _quality_state_from_score(score: int) -> str:
    if score <= 0:
        return "no_data"
    if score >= 80:
        return "good"
    if score >= 55:
        return "warning"
    return "critical"


def _latest_label(score: int) -> str:
    return QUALITY_LABELS[_quality_state_from_score(score)]


async def ensure_default_thresholds(db: AsyncSession) -> List[AlertThreshold]:
    result = await db.execute(select(AlertThreshold))
    existing = {row.metric_name: row for row in result.scalars().all()}
    created = False

    for payload in DEFAULT_ALERT_THRESHOLDS:
        current = existing.get(payload["metric_name"])
        if current is None:
            current = AlertThreshold(**payload)
            db.add(current)
            existing[payload["metric_name"]] = current
            created = True
            continue

        for key, value in payload.items():
            if getattr(current, key) in (None, 0, ""):
                setattr(current, key, value)

    if created:
        await db.flush()

    return list(existing.values())


async def ensure_monitoring_settings(
    db: AsyncSession,
    user_id: int,
) -> MonitoringNotificationSetting:
    user = await db.get(User, user_id)
    return await ensure_notification_settings(db, user_id, user=user)


async def get_expected_tariff_profile(user: User) -> Dict[str, float]:
    cache_key = f"monitoring:tariff:{user.id}"
    cached = await redis_cache.get(cache_key)
    if isinstance(cached, dict) and cached.get("download_mbps"):
        return {
            "download_mbps": float(cached["download_mbps"]),
            "upload_mbps": float(cached.get("upload_mbps") or max(float(cached["download_mbps"]) * 0.5, 10)),
        }

    billing = BillingService()
    try:
        tariff = await billing.get_current_tariff(user.billing_id)
    except Exception:
        tariff = None

    download = float((tariff or {}).get("speed_mbps") or (tariff or {}).get("speed") or 300)
    upload = float((tariff or {}).get("upload_speed_mbps") or max(download * 0.5, 20))
    result = {"download_mbps": download, "upload_mbps": upload}
    await redis_cache.set(cache_key, result, expire=300)
    return result


def _synthetic_snapshot(
    user: User,
    *,
    collected_at: datetime,
    expected_download_mbps: float,
    expected_upload_mbps: float,
) -> Dict[str, Any]:
    seed = f"{user.id}:{collected_at.strftime('%Y%m%d%H%M')}"
    rng = random.Random(seed)
    hour = collected_at.hour
    weekday = collected_at.weekday()
    is_evening_peak = 18 <= hour <= 23
    is_business_peak = weekday < 5 and 10 <= hour <= 18

    quality_factor = 0.93 + rng.uniform(-0.06, 0.05)
    if is_evening_peak:
        quality_factor -= 0.18 + rng.uniform(0, 0.05)
    elif is_business_peak:
        quality_factor -= 0.05 + rng.uniform(0, 0.03)

    ping_ms = 18 + rng.uniform(0, 12)
    packet_loss_pct = max(0.0, rng.uniform(0, 0.8))
    jitter_ms = 2 + rng.uniform(0, 8)

    incident_code = (user.id * 17 + int(collected_at.timestamp() // 1800)) % 113
    if incident_code == 7:
        ping_ms = 420 + rng.uniform(20, 110)
        packet_loss_pct = 100
        jitter_ms = 150 + rng.uniform(20, 80)
        quality_factor = 0.02 + rng.uniform(0, 0.06)
    elif incident_code in {11, 12, 13}:
        ping_ms = 160 + rng.uniform(10, 80)
        packet_loss_pct = 6 + rng.uniform(0, 4)
        jitter_ms = 65 + rng.uniform(0, 30)
        quality_factor = 0.22 + rng.uniform(0, 0.12)
    elif incident_code in {22, 23, 24, 25}:
        ping_ms = 115 + rng.uniform(5, 40)
        packet_loss_pct = 2.4 + rng.uniform(0, 3)
        jitter_ms = 40 + rng.uniform(0, 18)
        quality_factor = 0.58 + rng.uniform(0, 0.08)

    quality_factor = max(0.01, quality_factor)
    download_mbps = max(0.1, expected_download_mbps * quality_factor)
    upload_factor = max(0.05, quality_factor + rng.uniform(-0.08, 0.04))
    upload_mbps = max(0.1, expected_upload_mbps * upload_factor)

    if packet_loss_pct >= 100:
        download_mbps = min(download_mbps, expected_download_mbps * 0.04)
        upload_mbps = min(upload_mbps, expected_upload_mbps * 0.03)

    return {
        "ping_ms": round(ping_ms, 2),
        "packet_loss_pct": round(packet_loss_pct, 2),
        "jitter_ms": round(jitter_ms, 2),
        "download_mbps": round(download_mbps, 2),
        "upload_mbps": round(upload_mbps, 2),
        "source": "synthetic",
        "route_snapshot": {
            "probe": "synthetic-demo",
            "expected_download_mbps": expected_download_mbps,
            "expected_upload_mbps": expected_upload_mbps,
            "phase": "evening" if is_evening_peak else "business" if is_business_peak else "steady",
        },
    }


async def collect_metric_for_user(
    db: AsyncSession,
    user: User,
    *,
    collected_at: Optional[datetime] = None,
) -> Optional[MonitoringMetric]:
    settings_row = await ensure_monitoring_settings(db, user.id)
    if not settings.monitoring_enabled or not settings_row.monitoring_enabled:
        return None

    collected_at = collected_at or _utcnow()
    profile = await get_expected_tariff_profile(user)
    snapshot = _synthetic_snapshot(
        user,
        collected_at=collected_at,
        expected_download_mbps=profile["download_mbps"],
        expected_upload_mbps=profile["upload_mbps"],
    )

    metric = MonitoringMetric(
        user_id=user.id,
        ping_ms=Decimal(str(snapshot["ping_ms"])),
        packet_loss_pct=Decimal(str(snapshot["packet_loss_pct"])),
        jitter_ms=Decimal(str(snapshot["jitter_ms"])),
        download_mbps=Decimal(str(snapshot["download_mbps"])),
        upload_mbps=Decimal(str(snapshot["upload_mbps"])),
        source=snapshot["source"],
        route_snapshot=snapshot["route_snapshot"],
        collected_at=collected_at,
    )
    db.add(metric)
    await db.flush()
    return metric


async def seed_demo_monitoring_data(db: AsyncSession, user: User) -> None:
    existing = await db.scalar(
        select(func.count()).select_from(MonitoringMetric).where(MonitoringMetric.user_id == user.id)
    )
    await ensure_default_thresholds(db)
    await ensure_monitoring_settings(db, user.id)
    if existing and existing > 0:
        return

    now = _utcnow()
    profile = await get_expected_tariff_profile(user)
    metrics: List[MonitoringMetric] = []

    cursor = now - timedelta(days=30)
    while cursor < now - timedelta(days=2):
        snapshot = _synthetic_snapshot(
            user,
            collected_at=cursor,
            expected_download_mbps=profile["download_mbps"],
            expected_upload_mbps=profile["upload_mbps"],
        )
        metrics.append(
            MonitoringMetric(
                user_id=user.id,
                ping_ms=Decimal(str(snapshot["ping_ms"])),
                packet_loss_pct=Decimal(str(snapshot["packet_loss_pct"])),
                jitter_ms=Decimal(str(snapshot["jitter_ms"])),
                download_mbps=Decimal(str(snapshot["download_mbps"])),
                upload_mbps=Decimal(str(snapshot["upload_mbps"])),
                source=snapshot["source"],
                route_snapshot=snapshot["route_snapshot"],
                collected_at=cursor,
            )
        )
        cursor += timedelta(hours=1)

    cursor = now - timedelta(days=2)
    while cursor <= now:
        snapshot = _synthetic_snapshot(
            user,
            collected_at=cursor,
            expected_download_mbps=profile["download_mbps"],
            expected_upload_mbps=profile["upload_mbps"],
        )
        metrics.append(
            MonitoringMetric(
                user_id=user.id,
                ping_ms=Decimal(str(snapshot["ping_ms"])),
                packet_loss_pct=Decimal(str(snapshot["packet_loss_pct"])),
                jitter_ms=Decimal(str(snapshot["jitter_ms"])),
                download_mbps=Decimal(str(snapshot["download_mbps"])),
                upload_mbps=Decimal(str(snapshot["upload_mbps"])),
                source=snapshot["source"],
                route_snapshot=snapshot["route_snapshot"],
                collected_at=cursor,
            )
        )
        cursor += timedelta(minutes=5)

    db.add_all(metrics)
    await db.flush()

    recent_alerts_count = await db.scalar(
        select(func.count()).select_from(MonitoringAlert).where(MonitoringAlert.user_id == user.id)
    )
    if recent_alerts_count and recent_alerts_count > 0:
        return

    alerts = [
        MonitoringAlert(
            user_id=user.id,
            type="high_ping",
            severity="warning",
            status="resolved",
            metric_name="ping_ms",
            message="Вечером на линии фиксировалась повышенная задержка выше 100 мс.",
            start_time=now - timedelta(days=5, hours=2),
            end_time=now - timedelta(days=5, hours=1, minutes=20),
            is_read=True,
            current_value=Decimal("146.20"),
            threshold_value=Decimal("100.00"),
            duration_minutes=15,
            details={"source": "demo-seed"},
        ),
        MonitoringAlert(
            user_id=user.id,
            type="packet_loss",
            severity="warning",
            status="resolved",
            metric_name="packet_loss_pct",
            message="Наблюдалась потеря пакетов выше 2% на вечерней нагрузке.",
            start_time=now - timedelta(days=3, hours=5),
            end_time=now - timedelta(days=3, hours=4, minutes=35),
            is_read=False,
            current_value=Decimal("3.40"),
            threshold_value=Decimal("2.00"),
            duration_minutes=25,
            details={"source": "demo-seed"},
        ),
        MonitoringAlert(
            user_id=user.id,
            type="slow_speed",
            severity="critical",
            status="resolved",
            metric_name="download_ratio",
            message="Скорость линии временно просела ниже 30% от параметров тарифа.",
            start_time=now - timedelta(days=1, hours=6),
            end_time=now - timedelta(days=1, hours=5, minutes=42),
            is_read=False,
            current_value=Decimal("0.22"),
            threshold_value=Decimal("0.30"),
            duration_minutes=18,
            details={"source": "demo-seed"},
        ),
        MonitoringAlert(
            user_id=user.id,
            type="high_jitter",
            severity="warning",
            status="active",
            metric_name="jitter_ms",
            message="Зафиксирована нестабильность задержки: джиттер выше комфортного уровня.",
            start_time=now - timedelta(minutes=32),
            end_time=None,
            is_read=False,
            current_value=Decimal("58.10"),
            threshold_value=Decimal("50.00"),
            duration_minutes=30,
            details={"source": "demo-seed"},
        ),
    ]
    db.add_all(alerts)
    await db.flush()


async def _load_recent_metrics(
    db: AsyncSession,
    user_id: int,
    since: datetime,
) -> List[MonitoringMetric]:
    result = await db.execute(
        select(MonitoringMetric)
        .where(
            MonitoringMetric.user_id == user_id,
            MonitoringMetric.collected_at >= since,
        )
        .order_by(MonitoringMetric.collected_at.desc())
    )
    return list(result.scalars().all())


def _average(values: Iterable[Optional[float]]) -> Optional[float]:
    clean = [float(value) for value in values if value is not None]
    if not clean:
        return None
    return round(sum(clean) / len(clean), 2)


def _metric_value_for_rule(
    metric_name: str,
    metrics: Sequence[MonitoringMetric],
    expected_download_mbps: Optional[float],
) -> Optional[float]:
    if not metrics:
        return None

    if metric_name == "download_ratio":
        if not expected_download_mbps:
            return None
        return _average(
            (
                (float(item.download_mbps) / expected_download_mbps)
                if item.download_mbps is not None and expected_download_mbps > 0
                else None
            )
            for item in metrics
        )

    if metric_name == "no_connection":
        return _average(float(item.packet_loss_pct) if item.packet_loss_pct is not None else None for item in metrics)

    return _average(getattr(item, metric_name, None) for item in metrics)


def _build_alert_message(alert_type: str, severity: str, value: Optional[float], threshold: Optional[float]) -> str:
    meta = ALERT_TYPE_META.get(alert_type, {"title": "Проблема связи", "icon": "⚠️"})
    severity_label = {
        "warning": "Предупреждение",
        "critical": "Критический алерт",
        "info": "Информация",
    }.get(severity, "Алерт")
    value_text = f"{value:.2f}" if value is not None else "—"
    threshold_text = f"{threshold:.2f}" if threshold is not None else "—"
    return f"{meta['icon']} {severity_label}: {meta['title']}. Текущее значение {value_text}, порог {threshold_text}."


def _evaluate_thresholds(
    thresholds: Dict[str, AlertThreshold],
    metrics: Sequence[MonitoringMetric],
    expected_download_mbps: Optional[float],
) -> ThresholdEvaluation:
    ordered_rules = (
        ("no_connection", "no_connection", "critical"),
        ("ping_ms", "high_ping", None),
        ("packet_loss_pct", "packet_loss", None),
        ("download_ratio", "slow_speed", None),
        ("jitter_ms", "high_jitter", None),
    )
    now = _utcnow()

    for metric_name, alert_type, forced_severity in ordered_rules:
        threshold = thresholds.get(metric_name)
        if threshold is None or not threshold.is_active:
            continue

        critical_since = now - timedelta(minutes=int(threshold.critical_duration_minutes))
        warning_since = now - timedelta(minutes=int(threshold.warning_duration_minutes))
        critical_metrics = [
            item for item in metrics
            if (_normalize_utc(item.collected_at) or datetime.min.replace(tzinfo=timezone.utc)) >= _normalize_utc(critical_since)
        ]
        warning_metrics = [
            item for item in metrics
            if (_normalize_utc(item.collected_at) or datetime.min.replace(tzinfo=timezone.utc)) >= _normalize_utc(warning_since)
        ]

        critical_value = _metric_value_for_rule(metric_name, critical_metrics, expected_download_mbps)
        warning_value = _metric_value_for_rule(metric_name, warning_metrics, expected_download_mbps)

        if forced_severity == "critical":
            if _compare(threshold.condition, critical_value, _safe_float(threshold.critical_value)):
                threshold_value = _safe_float(threshold.critical_value)
                return ThresholdEvaluation(
                    severity="critical",
                    alert_type=alert_type,
                    metric_name=metric_name,
                    threshold_value=threshold_value,
                    current_value=critical_value,
                    duration_minutes=int(threshold.critical_duration_minutes),
                    message=_build_alert_message(alert_type, "critical", critical_value, threshold_value),
                )
            continue

        if _compare(threshold.condition, critical_value, _safe_float(threshold.critical_value)):
            threshold_value = _safe_float(threshold.critical_value)
            return ThresholdEvaluation(
                severity="critical",
                alert_type=alert_type,
                metric_name=metric_name,
                threshold_value=threshold_value,
                current_value=critical_value,
                duration_minutes=int(threshold.critical_duration_minutes),
                message=_build_alert_message(alert_type, "critical", critical_value, threshold_value),
            )

        if _compare(threshold.condition, warning_value, _safe_float(threshold.warning_value)):
            threshold_value = _safe_float(threshold.warning_value)
            return ThresholdEvaluation(
                severity="warning",
                alert_type=alert_type,
                metric_name=metric_name,
                threshold_value=threshold_value,
                current_value=warning_value,
                duration_minutes=int(threshold.warning_duration_minutes),
                message=_build_alert_message(alert_type, "warning", warning_value, threshold_value),
            )

    return ThresholdEvaluation(None, None, None, None, None, None, None)


async def _create_notification_for_alert(
    db: AsyncSession,
    *,
    user: User,
    user_id: int,
    title: str,
    body: str,
    priority: NotificationPriority,
    action_url: str = "/monitoring/alerts",
) -> Notification:
    event_type = "resolved"
    if priority >= NotificationPriority.URGENT:
        event_type = "critical"
    elif priority >= NotificationPriority.HIGH:
        event_type = "warning"
    return await create_notification(
        db,
        user_id=user_id,
        user=user,
        title=title,
        message=body,
        event_type=event_type,
        category="connection_issues",
        priority=priority,
        delivery_type=NotificationType.PUSH,
        action_url=action_url,
        metadata={"source": "monitoring"},
    )


async def _dispatch_alert_realtime(
    *,
    user_id: int,
    event_type: str,
    alert_payload: Dict[str, Any],
) -> None:
    event_message = {
        "type": event_type,
        "alert": alert_payload,
        "timestamp": datetime.utcnow().isoformat(),
    }
    sent_alert = await websocket_manager.send_personal_message(user_id, event_message)
    if not sent_alert:
        await websocket_manager.store_pending_notification(user_id, event_message)


async def evaluate_alerts_for_user(
    db: AsyncSession,
    user: User,
) -> Optional[MonitoringAlert]:
    settings_row = await ensure_monitoring_settings(db, user.id)
    if not settings.monitoring_enabled or not settings_row.monitoring_enabled:
        return None

    thresholds = {row.metric_name: row for row in await ensure_default_thresholds(db)}
    horizon_minutes = max(
        max(int(row.warning_duration_minutes), int(row.critical_duration_minutes))
        for row in thresholds.values()
    )
    recent_metrics = await _load_recent_metrics(db, user.id, _utcnow() - timedelta(minutes=horizon_minutes + 5))
    if not recent_metrics:
        return None

    profile = await get_expected_tariff_profile(user)
    evaluation = _evaluate_thresholds(thresholds, recent_metrics, profile["download_mbps"])

    active_result = await db.execute(
        select(MonitoringAlert)
        .where(
            MonitoringAlert.user_id == user.id,
            MonitoringAlert.status == "active",
        )
        .order_by(MonitoringAlert.created_at.desc())
    )
    active_alerts = list(active_result.scalars().all())
    active_by_type = {item.type: item for item in active_alerts}

    if evaluation.alert_type is None:
        resolved_any = None
        for active_alert in active_alerts:
            active_alert.status = "resolved"
            active_alert.end_time = datetime.utcnow()
            notification = await _create_notification_for_alert(
                db,
                user=user,
                user_id=user.id,
                title="Качество соединения восстановилось",
                body=f"Линия стабилизировалась после события «{active_alert.message}».",
                priority=NotificationPriority.NORMAL,
            )
            await _dispatch_alert_realtime(
                user_id=user.id,
                event_type="monitoring_alert_resolved",
                alert_payload={"id": active_alert.id, "type": active_alert.type, "status": "resolved"},
            )
            resolved_any = active_alert
        if resolved_any is not None:
            await db.flush()
        return resolved_any

    active_alert = active_by_type.get(evaluation.alert_type)
    if active_alert is not None:
        active_alert.severity = evaluation.severity or active_alert.severity
        active_alert.metric_name = evaluation.metric_name or active_alert.metric_name
        active_alert.message = evaluation.message or active_alert.message
        if evaluation.current_value is not None:
            active_alert.current_value = Decimal(str(evaluation.current_value))
        if evaluation.threshold_value is not None:
            active_alert.threshold_value = Decimal(str(evaluation.threshold_value))
        active_alert.duration_minutes = evaluation.duration_minutes or active_alert.duration_minutes
        return active_alert

    cooldown_minutes = int(settings_row.alert_cooldown_minutes or settings.monitoring_alert_cooldown_minutes)
    cooldown_cutoff = datetime.utcnow() - timedelta(minutes=cooldown_minutes)
    duplicate = await db.execute(
        select(MonitoringAlert)
        .where(
            MonitoringAlert.user_id == user.id,
            MonitoringAlert.type == evaluation.alert_type,
            MonitoringAlert.severity == evaluation.severity,
            or_(
                MonitoringAlert.created_at >= cooldown_cutoff,
                and_(MonitoringAlert.end_time.is_not(None), MonitoringAlert.end_time >= cooldown_cutoff),
            ),
        )
        .order_by(MonitoringAlert.created_at.desc())
        .limit(1)
    )
    if duplicate.scalar_one_or_none() is not None:
        return None

    alert = MonitoringAlert(
        user_id=user.id,
        type=evaluation.alert_type,
        severity=evaluation.severity or "warning",
        status="active",
        metric_name=evaluation.metric_name,
        message=evaluation.message or "Обнаружена проблема с качеством связи.",
        start_time=datetime.utcnow() - timedelta(minutes=int(evaluation.duration_minutes or 1)),
        is_read=False,
        current_value=Decimal(str(evaluation.current_value)) if evaluation.current_value is not None else None,
        threshold_value=Decimal(str(evaluation.threshold_value)) if evaluation.threshold_value is not None else None,
        duration_minutes=evaluation.duration_minutes,
        details={"source": "rule-engine"},
    )
    db.add(alert)
    await db.flush()

    meta = ALERT_TYPE_META.get(evaluation.alert_type, {"title": "Проблема связи"})
    notification = await _create_notification_for_alert(
        db,
        user=user,
        user_id=user.id,
        title=meta["title"],
        body=alert.message,
        priority=NotificationPriority.URGENT if evaluation.severity == "critical" else NotificationPriority.HIGH,
    )
    await _dispatch_alert_realtime(
        user_id=user.id,
        event_type="monitoring_alert_created",
        alert_payload={
            "id": alert.id,
            "type": alert.type,
            "severity": alert.severity,
            "message": alert.message,
        },
    )
    return alert


async def collect_metrics_batch(db: AsyncSession) -> int:
    if not settings.monitoring_enabled:
        return 0

    users_result = await db.execute(select(User).where(User.is_active == True, User.is_blocked == False))
    users = [item for item in users_result.scalars().all() if not _is_staff(item)]
    if not users:
        return 0

    cutoff = _utcnow() - timedelta(minutes=settings.monitoring_collection_interval_minutes)
    collected = 0
    for user in users:
        last_collected = await db.scalar(
            select(func.max(MonitoringMetric.collected_at)).where(MonitoringMetric.user_id == user.id)
        )
        normalized_last_collected = _normalize_utc(last_collected)
        normalized_cutoff = _normalize_utc(cutoff)
        if normalized_last_collected and normalized_cutoff and normalized_last_collected >= normalized_cutoff:
            continue
        metric = await collect_metric_for_user(db, user)
        if metric is not None:
            collected += 1
    return collected


async def evaluate_alerts_batch(db: AsyncSession) -> int:
    if not settings.monitoring_enabled:
        return 0

    users_result = await db.execute(select(User).where(User.is_active == True, User.is_blocked == False))
    users = [item for item in users_result.scalars().all() if not _is_staff(item)]
    total = 0
    for user in users:
        result = await evaluate_alerts_for_user(db, user)
        if result is not None:
            total += 1
    return total


async def cleanup_old_monitoring_data(db: AsyncSession) -> int:
    cutoff = datetime.utcnow() - timedelta(days=settings.monitoring_retention_days)
    stale_ids = await db.scalars(select(MonitoringMetric.id).where(MonitoringMetric.collected_at < cutoff))
    ids = list(stale_ids)
    if not ids:
        return 0

    result = await db.execute(MonitoringMetric.__table__.delete().where(MonitoringMetric.id.in_(ids)))
    return int(result.rowcount or 0)


async def get_or_create_subscription(
    db: AsyncSession,
    user_id: int,
) -> MonitoringNotificationSetting:
    return await ensure_monitoring_settings(db, user_id)


async def update_subscription_settings(
    db: AsyncSession,
    user_id: int,
    payload: Dict[str, Any],
) -> MonitoringNotificationSetting:
    user = await db.get(User, user_id)
    return await update_unified_notification_settings(db, user=user, payload=payload)


async def get_monitoring_summary(
    db: AsyncSession,
    user: User,
) -> Dict[str, Any]:
    settings_row = await ensure_monitoring_settings(db, user.id)
    profile = await get_expected_tariff_profile(user)

    latest_result = await db.execute(
        select(MonitoringMetric)
        .where(MonitoringMetric.user_id == user.id)
        .order_by(MonitoringMetric.collected_at.desc())
        .limit(1)
    )
    latest_metric = latest_result.scalar_one_or_none()

    alerts_24h = await db.scalar(
        select(func.count()).select_from(MonitoringAlert).where(
            MonitoringAlert.user_id == user.id,
            MonitoringAlert.created_at >= datetime.utcnow() - timedelta(hours=24),
        )
    )
    unread_alerts = await db.scalar(
        select(func.count()).select_from(MonitoringAlert).where(
            MonitoringAlert.user_id == user.id,
            MonitoringAlert.is_read == False,
        )
    )
    active_alerts = await db.scalar(
        select(func.count()).select_from(MonitoringAlert).where(
            MonitoringAlert.user_id == user.id,
            MonitoringAlert.status == "active",
        )
    )
    recent_alerts_result = await db.execute(
        select(MonitoringAlert)
        .where(MonitoringAlert.user_id == user.id)
        .order_by(desc(MonitoringAlert.start_time))
        .limit(5)
    )
    recent_alerts = list(recent_alerts_result.scalars().all())

    current_metrics = None
    quality_score = 0
    if latest_metric is not None:
        quality_score = _quality_score_from_values(
            ping_ms=_safe_float(latest_metric.ping_ms),
            packet_loss_pct=_safe_float(latest_metric.packet_loss_pct),
            jitter_ms=_safe_float(latest_metric.jitter_ms),
            download_mbps=_safe_float(latest_metric.download_mbps),
            expected_download_mbps=profile["download_mbps"],
        )
        quality_state = _quality_state_from_score(quality_score)
        current_metrics = MonitoringMetricPoint(
            timestamp=latest_metric.collected_at,
            ping_ms=_safe_float(latest_metric.ping_ms),
            packet_loss_pct=_safe_float(latest_metric.packet_loss_pct),
            jitter_ms=_safe_float(latest_metric.jitter_ms),
            download_mbps=_safe_float(latest_metric.download_mbps),
            upload_mbps=_safe_float(latest_metric.upload_mbps),
            quality_score=quality_score,
            quality_state=quality_state,
        )
    else:
        quality_state = "no_data"

    return {
        "quality_state": quality_state,
        "quality_label": QUALITY_LABELS[quality_state],
        "quality_score": quality_score,
        "alerts_last_24h": int(alerts_24h or 0),
        "unread_alerts": int(unread_alerts or 0),
        "active_alerts": int(active_alerts or 0),
        "last_collected_at": latest_metric.collected_at if latest_metric else None,
        "current_metrics": current_metrics,
        "recent_alerts": recent_alerts,
        "monitoring_enabled": bool(settings_row.monitoring_enabled),
        "notification_channels": {
            "email": bool(settings_row.email_enabled),
            "telegram": bool(settings_row.telegram_enabled),
            "browser_push": bool(settings_row.browser_push_enabled),
        },
    }


def _expected_download_from_metric(metric: Optional[MonitoringMetric]) -> Optional[float]:
    if metric is None or not isinstance(metric.route_snapshot, dict):
        return None
    value = metric.route_snapshot.get("expected_download_mbps")
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _monitoring_snapshot_from_metric(
    metric: Optional[MonitoringMetric],
    *,
    monitoring_enabled: bool,
    active_alerts: int = 0,
    unread_alerts: int = 0,
    highest_severity: Optional[str] = None,
) -> Dict[str, Any]:
    if metric is None:
        return {
            "monitoring_enabled": monitoring_enabled,
            "quality_score": 0,
            "quality_state": "no_data",
            "quality_label": QUALITY_LABELS["no_data"],
            "last_collected_at": None,
            "ping_ms": None,
            "packet_loss_pct": None,
            "jitter_ms": None,
            "download_mbps": None,
            "upload_mbps": None,
            "active_alerts": int(active_alerts or 0),
            "unread_alerts": int(unread_alerts or 0),
            "highest_severity": highest_severity,
        }

    expected_download = _expected_download_from_metric(metric)
    quality_score = _quality_score_from_values(
        ping_ms=_safe_float(metric.ping_ms),
        packet_loss_pct=_safe_float(metric.packet_loss_pct),
        jitter_ms=_safe_float(metric.jitter_ms),
        download_mbps=_safe_float(metric.download_mbps),
        expected_download_mbps=expected_download,
    )
    quality_state = _quality_state_from_score(quality_score)
    return {
        "monitoring_enabled": monitoring_enabled,
        "quality_score": quality_score,
        "quality_state": quality_state,
        "quality_label": QUALITY_LABELS[quality_state],
        "last_collected_at": metric.collected_at.isoformat() if metric.collected_at else None,
        "ping_ms": _safe_float(metric.ping_ms),
        "packet_loss_pct": _safe_float(metric.packet_loss_pct),
        "jitter_ms": _safe_float(metric.jitter_ms),
        "download_mbps": _safe_float(metric.download_mbps),
        "upload_mbps": _safe_float(metric.upload_mbps),
        "active_alerts": int(active_alerts or 0),
        "unread_alerts": int(unread_alerts or 0),
        "highest_severity": highest_severity,
    }


async def get_user_monitoring_snapshots(
    db: AsyncSession,
    user_ids: Sequence[int],
) -> Dict[int, Dict[str, Any]]:
    normalized_user_ids = [int(user_id) for user_id in user_ids if int(user_id) > 0]
    if not normalized_user_ids:
        return {}

    settings_result = await db.execute(
        select(MonitoringNotificationSetting).where(MonitoringNotificationSetting.user_id.in_(normalized_user_ids))
    )
    settings_map = {row.user_id: row for row in settings_result.scalars().all()}

    latest_metric_subquery = (
        select(
            MonitoringMetric.user_id.label("user_id"),
            func.max(MonitoringMetric.collected_at).label("max_collected_at"),
        )
        .where(MonitoringMetric.user_id.in_(normalized_user_ids))
        .group_by(MonitoringMetric.user_id)
        .subquery()
    )
    latest_metrics_result = await db.execute(
        select(MonitoringMetric)
        .join(
            latest_metric_subquery,
            and_(
                MonitoringMetric.user_id == latest_metric_subquery.c.user_id,
                MonitoringMetric.collected_at == latest_metric_subquery.c.max_collected_at,
            ),
        )
        .order_by(MonitoringMetric.user_id.asc(), MonitoringMetric.collected_at.desc())
    )
    latest_metrics_map: Dict[int, MonitoringMetric] = {}
    for metric in latest_metrics_result.scalars().all():
        latest_metrics_map.setdefault(metric.user_id, metric)

    active_alert_counts: Dict[int, Dict[str, Any]] = defaultdict(
        lambda: {"active_alerts": 0, "unread_alerts": 0, "highest_severity": None}
    )
    active_alert_rows = await db.execute(
        select(MonitoringAlert)
        .where(
            MonitoringAlert.user_id.in_(normalized_user_ids),
            MonitoringAlert.status == "active",
        )
        .order_by(MonitoringAlert.user_id.asc(), MonitoringAlert.start_time.desc())
    )
    severity_rank = {"critical": 3, "warning": 2, "info": 1, None: 0}
    for alert in active_alert_rows.scalars().all():
        payload = active_alert_counts[alert.user_id]
        payload["active_alerts"] += 1
        current_highest = payload["highest_severity"]
        if severity_rank.get(alert.severity, 0) > severity_rank.get(current_highest, 0):
            payload["highest_severity"] = alert.severity

    unread_rows = await db.execute(
        select(MonitoringAlert.user_id, func.count())
        .where(
            MonitoringAlert.user_id.in_(normalized_user_ids),
            MonitoringAlert.is_read == False,
        )
        .group_by(MonitoringAlert.user_id)
    )
    unread_map = {user_id: int(count) for user_id, count in unread_rows.all()}

    snapshots: Dict[int, Dict[str, Any]] = {}
    for user_id in normalized_user_ids:
        settings_row = settings_map.get(user_id)
        monitoring_enabled = bool(settings_row.monitoring_enabled) if settings_row else True
        alert_payload = active_alert_counts.get(user_id, {})
        snapshots[user_id] = _monitoring_snapshot_from_metric(
            latest_metrics_map.get(user_id),
            monitoring_enabled=monitoring_enabled,
            active_alerts=int(alert_payload.get("active_alerts") or 0),
            unread_alerts=int(unread_map.get(user_id) or 0),
            highest_severity=alert_payload.get("highest_severity"),
        )

    return snapshots


async def get_admin_monitoring_overview(db: AsyncSession) -> Dict[str, Any]:
    users_result = await db.execute(
        select(User).where(User.is_active == True, User.is_blocked == False)
    )
    abonents = [item for item in users_result.scalars().all() if not _is_staff(item)]
    user_ids = [user.id for user in abonents]
    snapshots = await get_user_monitoring_snapshots(db, user_ids)

    monitored_users = 0
    disabled_users = 0
    users_with_active_alerts = 0
    total_quality_score = 0
    quality_sample_count = 0
    quality_breakdown = {"good": 0, "warning": 0, "critical": 0, "no_data": 0}

    worst_users: List[Dict[str, Any]] = []
    for user in abonents:
        snapshot = snapshots.get(user.id, {})
        monitoring_enabled = bool(snapshot.get("monitoring_enabled", True))
        if monitoring_enabled:
            monitored_users += 1
        else:
            disabled_users += 1

        if int(snapshot.get("active_alerts") or 0) > 0:
            users_with_active_alerts += 1

        quality_state = str(snapshot.get("quality_state") or "no_data")
        quality_breakdown[quality_state] = quality_breakdown.get(quality_state, 0) + 1

        score = int(snapshot.get("quality_score") or 0)
        if score > 0:
            total_quality_score += score
            quality_sample_count += 1

        worst_users.append(
            {
                "user_id": user.id,
                "full_name": getattr(user, "full_name", "") or user.phone,
                "phone": user.phone,
                "billing_id": user.billing_id,
                **snapshot,
            }
        )

    quality_breakdown_items = [
        {"key": "critical", "label": "Критично", "value": int(quality_breakdown.get("critical", 0))},
        {"key": "warning", "label": "Предупреждение", "value": int(quality_breakdown.get("warning", 0))},
        {"key": "good", "label": "Стабильно", "value": int(quality_breakdown.get("good", 0))},
        {"key": "no_data", "label": "Нет данных", "value": int(quality_breakdown.get("no_data", 0))},
    ]

    critical_alerts_24h = await db.scalar(
        select(func.count()).select_from(MonitoringAlert).where(
            MonitoringAlert.created_at >= datetime.utcnow() - timedelta(hours=24),
            MonitoringAlert.severity == "critical",
        )
    ) or 0

    alert_type_rows = await db.execute(
        select(MonitoringAlert.type, func.count())
        .where(MonitoringAlert.created_at >= datetime.utcnow() - timedelta(hours=24))
        .group_by(MonitoringAlert.type)
        .order_by(func.count().desc(), MonitoringAlert.type.asc())
        .limit(5)
    )
    alert_type_items = [
        {
            "key": alert_type,
            "label": ALERT_TYPE_META.get(alert_type, {}).get("title", alert_type),
            "value": int(count),
        }
        for alert_type, count in alert_type_rows.all()
    ]

    latest_alert_rows = await db.execute(
        select(MonitoringAlert, User)
        .join(User, User.id == MonitoringAlert.user_id)
        .where(MonitoringAlert.created_at >= datetime.utcnow() - timedelta(days=7))
        .order_by(MonitoringAlert.start_time.desc())
        .limit(6)
    )
    latest_alerts = [
        {
            "id": alert.id,
            "user_id": alert.user_id,
            "user_name": getattr(user, "full_name", "") or user.phone,
            "phone": user.phone,
            "type": alert.type,
            "severity": alert.severity,
            "status": alert.status,
            "message": alert.message,
            "start_time": alert.start_time.isoformat() if alert.start_time else None,
            "end_time": alert.end_time.isoformat() if alert.end_time else None,
            "is_read": bool(alert.is_read),
        }
        for alert, user in latest_alert_rows.all()
    ]

    state_rank = {"critical": 0, "warning": 1, "no_data": 2, "good": 3}
    severity_rank = {"critical": 0, "warning": 1, "info": 2, None: 3}
    worst_users_sorted = sorted(
        worst_users,
        key=lambda item: (
            0 if item.get("monitoring_enabled", True) else 1,
            0 if int(item.get("active_alerts") or 0) > 0 else 1,
            severity_rank.get(item.get("highest_severity"), 3),
            state_rank.get(str(item.get("quality_state") or "no_data"), 4),
            int(item.get("quality_score") or 0),
            -int(item.get("active_alerts") or 0),
            item.get("full_name") or "",
        ),
    )[:6]

    return {
        "monitoring_monitored_users": int(monitored_users),
        "monitoring_disabled_users": int(disabled_users),
        "monitoring_users_with_active_alerts": int(users_with_active_alerts),
        "monitoring_critical_alerts_24h": int(critical_alerts_24h or 0),
        "monitoring_average_quality_score": round(
            total_quality_score / quality_sample_count, 1
        ) if quality_sample_count else 0,
        "monitoring_quality_breakdown": quality_breakdown_items,
        "monitoring_alert_types": alert_type_items,
        "monitoring_latest_alerts": latest_alerts,
        "monitoring_worst_users": worst_users_sorted,
    }


async def get_metrics_response(
    db: AsyncSession,
    user: User,
    *,
    date_from: datetime,
    date_to: datetime,
    interval: str,
) -> Dict[str, Any]:
    bucket_size = _bucket_interval(interval)
    profile = await get_expected_tariff_profile(user)

    result = await db.execute(
        select(MonitoringMetric)
        .where(
            MonitoringMetric.user_id == user.id,
            MonitoringMetric.collected_at >= date_from,
            MonitoringMetric.collected_at <= date_to,
        )
        .order_by(MonitoringMetric.collected_at.asc())
    )
    metrics = list(result.scalars().all())

    buckets: Dict[datetime, Dict[str, List[Optional[float]]]] = defaultdict(
        lambda: {
            "ping_ms": [],
            "packet_loss_pct": [],
            "jitter_ms": [],
            "download_mbps": [],
            "upload_mbps": [],
        }
    )

    for item in metrics:
        bucket = _bucket_timestamp(item.collected_at, bucket_size)
        buckets[bucket]["ping_ms"].append(_safe_float(item.ping_ms))
        buckets[bucket]["packet_loss_pct"].append(_safe_float(item.packet_loss_pct))
        buckets[bucket]["jitter_ms"].append(_safe_float(item.jitter_ms))
        buckets[bucket]["download_mbps"].append(_safe_float(item.download_mbps))
        buckets[bucket]["upload_mbps"].append(_safe_float(item.upload_mbps))

    ordered_points: List[Dict[str, Any]] = []
    total_range = max(date_to - date_from, timedelta(minutes=1))
    for bucket, values in sorted(buckets.items()):
        point = {
            "timestamp": bucket,
            "ping_ms": _average(values["ping_ms"]),
            "packet_loss_pct": _average(values["packet_loss_pct"]),
            "jitter_ms": _average(values["jitter_ms"]),
            "download_mbps": _average(values["download_mbps"]),
            "upload_mbps": _average(values["upload_mbps"]),
        }
        score = _quality_score_from_values(
            ping_ms=point["ping_ms"],
            packet_loss_pct=point["packet_loss_pct"],
            jitter_ms=point["jitter_ms"],
            download_mbps=point["download_mbps"],
            expected_download_mbps=profile["download_mbps"],
        )
        point["quality_score"] = score
        point["quality_state"] = _quality_state_from_score(score)
        ordered_points.append(point)

    average_score = (
        round(sum(point["quality_score"] for point in ordered_points) / max(len(ordered_points), 1))
        if ordered_points
        else 0
    )
    chart_labels = [_format_chart_label(point["timestamp"], total_range) for point in ordered_points]
    chart_timestamps = [point["timestamp"] for point in ordered_points]

    return {
        "date_from": date_from,
        "date_to": date_to,
        "interval": interval,
        "points": [
            MonitoringMetricPoint(
                timestamp=point["timestamp"],
                ping_ms=point["ping_ms"],
                packet_loss_pct=point["packet_loss_pct"],
                jitter_ms=point["jitter_ms"],
                download_mbps=point["download_mbps"],
                upload_mbps=point["upload_mbps"],
                quality_score=point["quality_score"],
                quality_state=point["quality_state"],
            )
            for point in ordered_points
        ],
        "charts": {
            "labels": chart_labels,
            "timestamps": chart_timestamps,
            "ping_ms": [point["ping_ms"] for point in ordered_points],
            "packet_loss_pct": [point["packet_loss_pct"] for point in ordered_points],
            "jitter_ms": [point["jitter_ms"] for point in ordered_points],
            "download_mbps": [point["download_mbps"] for point in ordered_points],
            "upload_mbps": [point["upload_mbps"] for point in ordered_points],
            "quality_score": [point["quality_score"] for point in ordered_points],
            "quality_state": [point["quality_state"] for point in ordered_points],
        },
        "totals": {
            "expected_download_mbps": round(profile["download_mbps"], 2),
            "expected_upload_mbps": round(profile["upload_mbps"], 2),
            "average_ping_ms": _average(point["ping_ms"] for point in ordered_points),
            "average_packet_loss_pct": _average(point["packet_loss_pct"] for point in ordered_points),
            "average_jitter_ms": _average(point["jitter_ms"] for point in ordered_points),
            "average_download_mbps": _average(point["download_mbps"] for point in ordered_points),
            "average_upload_mbps": _average(point["upload_mbps"] for point in ordered_points),
            "quality_score": average_score,
            "quality_label": _latest_label(average_score) if ordered_points else QUALITY_LABELS["no_data"],
            "samples": len(metrics),
        },
    }


async def get_alerts_response(
    db: AsyncSession,
    user_id: int,
    *,
    page: int,
    page_size: int,
    alert_type: Optional[str] = None,
    severity: Optional[str] = None,
    status_value: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
) -> Dict[str, Any]:
    filters = [MonitoringAlert.user_id == user_id]
    if alert_type:
        filters.append(MonitoringAlert.type == alert_type)
    if severity:
        filters.append(MonitoringAlert.severity == severity)
    if status_value:
        filters.append(MonitoringAlert.status == status_value)
    if date_from:
        filters.append(MonitoringAlert.start_time >= date_from)
    if date_to:
        filters.append(MonitoringAlert.start_time <= date_to)

    total = await db.scalar(select(func.count()).select_from(MonitoringAlert).where(*filters))
    unread = await db.scalar(
        select(func.count()).select_from(MonitoringAlert).where(
            MonitoringAlert.user_id == user_id,
            MonitoringAlert.is_read == False,
        )
    )

    result = await db.execute(
        select(MonitoringAlert)
        .where(*filters)
        .order_by(MonitoringAlert.start_time.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return {
        "total": int(total or 0),
        "items": list(result.scalars().all()),
        "page": page,
        "page_size": page_size,
        "unread_count": int(unread or 0),
    }


async def mark_alert_read(
    db: AsyncSession,
    *,
    user_id: int,
    alert_id: int,
) -> MonitoringAlert | None:
    result = await db.execute(
        select(MonitoringAlert).where(MonitoringAlert.id == alert_id, MonitoringAlert.user_id == user_id)
    )
    alert = result.scalar_one_or_none()
    if alert is None:
        return None
    alert.is_read = True
    await db.flush()
    return alert


async def get_thresholds(db: AsyncSession) -> List[AlertThreshold]:
    return await ensure_default_thresholds(db)


async def replace_thresholds(
    db: AsyncSession,
    items: Sequence[Dict[str, Any]],
) -> List[AlertThreshold]:
    existing = {row.metric_name: row for row in await ensure_default_thresholds(db)}
    seen: set[str] = set()

    for payload in items:
        metric_name = payload["metric_name"]
        seen.add(metric_name)
        row = existing.get(metric_name)
        if row is None:
            row = AlertThreshold(metric_name=metric_name)
            db.add(row)
            existing[metric_name] = row

        row.condition = payload["condition"]
        row.warning_value = payload.get("warning_value")
        row.critical_value = payload.get("critical_value")
        row.warning_duration_minutes = int(payload["warning_duration_minutes"])
        row.critical_duration_minutes = int(payload["critical_duration_minutes"])
        row.is_active = bool(payload.get("is_active", True))
        row.updated_at = datetime.utcnow()

    for metric_name, row in existing.items():
        if metric_name not in seen:
            row.is_active = False

    await db.flush()
    return list(existing.values())
