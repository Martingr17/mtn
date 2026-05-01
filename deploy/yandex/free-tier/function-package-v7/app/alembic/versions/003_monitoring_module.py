"""monitoring module tables

Revision ID: 003
Revises: 002
Create Date: 2026-04-09 20:30:00.000000
"""

from alembic import op


revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS metrics (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            ping_ms NUMERIC(8, 2),
            packet_loss_pct NUMERIC(5, 2),
            jitter_ms NUMERIC(8, 2),
            download_mbps NUMERIC(10, 2),
            upload_mbps NUMERIC(10, 2),
            source VARCHAR(32) NOT NULL DEFAULT 'synthetic',
            route_snapshot JSONB DEFAULT '{}'::jsonb,
            collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS alerts (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type VARCHAR(50) NOT NULL,
            severity VARCHAR(20) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            metric_name VARCHAR(50),
            message TEXT NOT NULL,
            start_time TIMESTAMPTZ NOT NULL,
            end_time TIMESTAMPTZ,
            is_read BOOLEAN NOT NULL DEFAULT FALSE,
            current_value NUMERIC(10, 2),
            threshold_value NUMERIC(10, 2),
            duration_minutes INTEGER,
            details JSONB DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS notification_settings (
            user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            monitoring_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            telegram_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            browser_push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            telegram_chat_id VARCHAR(100),
            alert_cooldown_minutes INTEGER NOT NULL DEFAULT 30,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS alert_thresholds (
            id BIGSERIAL PRIMARY KEY,
            metric_name VARCHAR(50) NOT NULL UNIQUE,
            condition VARCHAR(10) NOT NULL DEFAULT '>',
            warning_value NUMERIC(10, 2),
            critical_value NUMERIC(10, 2),
            warning_duration_minutes INTEGER NOT NULL DEFAULT 5,
            critical_duration_minutes INTEGER NOT NULL DEFAULT 2,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    op.execute("CREATE INDEX IF NOT EXISTS idx_metrics_user_time ON metrics (user_id, collected_at)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_metrics_collected_at ON metrics (collected_at)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_alerts_user_start ON alerts (user_id, start_time)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_alerts_type_status ON alerts (type, status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_alerts_read ON alerts (is_read)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_alert_thresholds_metric ON alert_thresholds (metric_name)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_alert_thresholds_metric")
    op.execute("DROP INDEX IF EXISTS idx_alerts_read")
    op.execute("DROP INDEX IF EXISTS idx_alerts_type_status")
    op.execute("DROP INDEX IF EXISTS idx_alerts_user_start")
    op.execute("DROP INDEX IF EXISTS idx_metrics_collected_at")
    op.execute("DROP INDEX IF EXISTS idx_metrics_user_time")
    op.execute("DROP TABLE IF EXISTS alert_thresholds")
    op.execute("DROP TABLE IF EXISTS notification_settings")
    op.execute("DROP TABLE IF EXISTS alerts")
    op.execute("DROP TABLE IF EXISTS metrics")
