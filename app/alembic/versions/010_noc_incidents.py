"""noc incidents tables

Revision ID: 010
Revises: 009
Create Date: 2026-04-30 00:00:00.000000
"""

from alembic import op


revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS noc_incidents (
            id BIGSERIAL PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            severity VARCHAR(24) NOT NULL DEFAULT 'medium',
            status VARCHAR(24) NOT NULL DEFAULT 'new',
            source VARCHAR(24) NOT NULL DEFAULT 'manual',
            affected_service VARCHAR(32) NOT NULL DEFAULT 'other',
            affected_subscribers_count INTEGER NOT NULL DEFAULT 0,
            assigned_to BIGINT REFERENCES users(id) ON DELETE SET NULL,
            created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
            acknowledged_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
            resolved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
            closed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            acknowledged_at TIMESTAMPTZ,
            started_at TIMESTAMPTZ,
            resolved_at TIMESTAMPTZ,
            closed_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS incident_alarm_links (
            id BIGSERIAL PRIMARY KEY,
            incident_id BIGINT NOT NULL REFERENCES noc_incidents(id) ON DELETE CASCADE,
            zabbix_alarm_id BIGINT NOT NULL REFERENCES zabbix_alarms(id) ON DELETE CASCADE
        )
        """
    )

    op.execute("CREATE INDEX IF NOT EXISTS idx_noc_incidents_status ON noc_incidents (status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_noc_incidents_severity ON noc_incidents (severity)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_noc_incidents_service ON noc_incidents (affected_service)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_noc_incidents_source ON noc_incidents (source)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_noc_incidents_assigned ON noc_incidents (assigned_to)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_noc_incidents_created_at ON noc_incidents (created_at)")
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_incident_alarm_links_incident "
        "ON incident_alarm_links (incident_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_incident_alarm_links_alarm "
        "ON incident_alarm_links (zabbix_alarm_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_incident_alarm_links_alarm")
    op.execute("DROP INDEX IF EXISTS idx_incident_alarm_links_incident")
    op.execute("DROP INDEX IF EXISTS idx_noc_incidents_created_at")
    op.execute("DROP INDEX IF EXISTS idx_noc_incidents_assigned")
    op.execute("DROP INDEX IF EXISTS idx_noc_incidents_source")
    op.execute("DROP INDEX IF EXISTS idx_noc_incidents_service")
    op.execute("DROP INDEX IF EXISTS idx_noc_incidents_severity")
    op.execute("DROP INDEX IF EXISTS idx_noc_incidents_status")
    op.execute("DROP TABLE IF EXISTS incident_alarm_links")
    op.execute("DROP TABLE IF EXISTS noc_incidents")
