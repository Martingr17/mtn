"""telegram alert log

Revision ID: 011
Revises: 010
Create Date: 2026-04-30 00:00:00.000000
"""

from alembic import op


revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS telegram_alert_log (
            id BIGSERIAL PRIMARY KEY,
            entity_type VARCHAR(32) NOT NULL,
            entity_id BIGINT NOT NULL,
            severity VARCHAR(24) NOT NULL,
            title VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            chat_id VARCHAR(128) NOT NULL,
            status VARCHAR(24) NOT NULL,
            error TEXT,
            sent_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_telegram_alert_entity "
        "ON telegram_alert_log (entity_type, entity_id)"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_telegram_alert_status ON telegram_alert_log (status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_telegram_alert_created_at ON telegram_alert_log (created_at)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_telegram_alert_created_at")
    op.execute("DROP INDEX IF EXISTS idx_telegram_alert_status")
    op.execute("DROP INDEX IF EXISTS idx_telegram_alert_entity")
    op.execute("DROP TABLE IF EXISTS telegram_alert_log")
