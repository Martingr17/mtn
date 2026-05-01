"""notification center, push subscriptions and extended settings

Revision ID: 004
Revises: 003
Create Date: 2026-04-09 23:40:00.000000
"""

from alembic import op


revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


DEFAULT_ENABLED_TYPES_SQL = """
    '["connection_issues","maintenance","news","tariff_changes","payment","tickets"]'::jsonb
"""


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS event_type VARCHAR(50) NOT NULL DEFAULT 'info'
        """
    )
    op.execute(
        """
        ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'system'
        """
    )
    op.execute(
        """
        ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE
        """
    )
    op.execute(
        """
        ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
        """
    )
    op.execute(
        """
        ALTER TABLE notifications
        ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_notifications_archived ON notifications (is_archived)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_notifications_event_type ON notifications (event_type)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_notifications_category ON notifications (category)")

    op.execute(
        """
        ALTER TABLE notification_settings
        ADD COLUMN IF NOT EXISTS site_enabled BOOLEAN NOT NULL DEFAULT TRUE
        """
    )
    op.execute(
        f"""
        ALTER TABLE notification_settings
        ADD COLUMN IF NOT EXISTS enabled_event_types JSONB NOT NULL DEFAULT {DEFAULT_ENABLED_TYPES_SQL}
        """
    )
    op.execute(
        """
        ALTER TABLE notification_settings
        ADD COLUMN IF NOT EXISTS quiet_hours_start TIME
        """
    )
    op.execute(
        """
        ALTER TABLE notification_settings
        ADD COLUMN IF NOT EXISTS quiet_hours_end TIME
        """
    )
    op.execute(
        f"""
        UPDATE notification_settings
        SET enabled_event_types = {DEFAULT_ENABLED_TYPES_SQL}
        WHERE enabled_event_types IS NULL
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            endpoint VARCHAR(500) NOT NULL UNIQUE,
            p256dh_key VARCHAR(200) NOT NULL,
            auth_key VARCHAR(100) NOT NULL,
            user_agent TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            is_active BOOLEAN NOT NULL DEFAULT TRUE
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_active
        ON push_subscriptions (user_id, is_active)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_push_subscriptions_user_active")
    op.execute("DROP TABLE IF EXISTS push_subscriptions")

    op.execute("ALTER TABLE notification_settings DROP COLUMN IF EXISTS quiet_hours_end")
    op.execute("ALTER TABLE notification_settings DROP COLUMN IF EXISTS quiet_hours_start")
    op.execute("ALTER TABLE notification_settings DROP COLUMN IF EXISTS enabled_event_types")
    op.execute("ALTER TABLE notification_settings DROP COLUMN IF EXISTS site_enabled")

    op.execute("DROP INDEX IF EXISTS idx_notifications_category")
    op.execute("DROP INDEX IF EXISTS idx_notifications_event_type")
    op.execute("DROP INDEX IF EXISTS idx_notifications_archived")
    op.execute("ALTER TABLE notifications DROP COLUMN IF EXISTS read_at")
    op.execute("ALTER TABLE notifications DROP COLUMN IF EXISTS expires_at")
    op.execute("ALTER TABLE notifications DROP COLUMN IF EXISTS is_archived")
    op.execute("ALTER TABLE notifications DROP COLUMN IF EXISTS category")
    op.execute("ALTER TABLE notifications DROP COLUMN IF EXISTS event_type")
