"""zabbix mock adapter table

Revision ID: 009
Revises: 008
Create Date: 2026-04-29 00:00:00.000000
"""

from alembic import op


revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS zabbix_alarms (
            id BIGSERIAL PRIMARY KEY,
            alarm_type VARCHAR(48) NOT NULL,
            severity VARCHAR(24) NOT NULL DEFAULT 'warning',
            status VARCHAR(24) NOT NULL DEFAULT 'active',
            source_type VARCHAR(48) NOT NULL,
            source_name VARCHAR(255) NOT NULL,
            source_id BIGINT,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            metric_name VARCHAR(128),
            metric_value NUMERIC(12, 2),
            threshold NUMERIC(12, 2),
            first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            acknowledged_at TIMESTAMPTZ,
            resolved_at TIMESTAMPTZ,
            acknowledged_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
            resolved_by BIGINT REFERENCES users(id) ON DELETE SET NULL
        )
        """
    )

    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zabbix_alarms_type_status "
        "ON zabbix_alarms (alarm_type, status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zabbix_alarms_severity_status "
        "ON zabbix_alarms (severity, status)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_zabbix_alarms_source "
        "ON zabbix_alarms (source_type, source_id)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_zabbix_alarms_last_seen ON zabbix_alarms (last_seen_at)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_zabbix_alarms_last_seen")
    op.execute("DROP INDEX IF EXISTS idx_zabbix_alarms_source")
    op.execute("DROP INDEX IF EXISTS idx_zabbix_alarms_severity_status")
    op.execute("DROP INDEX IF EXISTS idx_zabbix_alarms_type_status")
    op.execute("DROP TABLE IF EXISTS zabbix_alarms")
