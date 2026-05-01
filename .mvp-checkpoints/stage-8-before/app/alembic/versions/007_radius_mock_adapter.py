"""radius mock adapter tables

Revision ID: 007
Revises: 006
Create Date: 2026-04-29 00:00:00.000000
"""

from alembic import op


revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS radius_sessions (
            id BIGSERIAL PRIMARY KEY,
            subscriber_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            username VARCHAR(128) NOT NULL,
            framed_ip_address INET,
            mac_address VARCHAR(32),
            nas_ip_address INET,
            nas_port VARCHAR(64),
            session_id VARCHAR(128) NOT NULL UNIQUE,
            status VARCHAR(24) NOT NULL DEFAULT 'active',
            tariff_profile VARCHAR(128),
            speed_down INTEGER NOT NULL DEFAULT 100,
            speed_up INTEGER NOT NULL DEFAULT 50,
            started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS radius_action_log (
            id BIGSERIAL PRIMARY KEY,
            subscriber_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            action VARCHAR(32) NOT NULL,
            old_status VARCHAR(24),
            new_status VARCHAR(24),
            old_speed_down INTEGER,
            new_speed_down INTEGER,
            old_speed_up INTEGER,
            new_speed_up INTEGER,
            performed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
            result VARCHAR(32) NOT NULL DEFAULT 'mock_success',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    op.execute("CREATE INDEX IF NOT EXISTS idx_radius_sessions_subscriber ON radius_sessions (subscriber_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_radius_sessions_status ON radius_sessions (status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_radius_sessions_framed_ip ON radius_sessions (framed_ip_address)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_radius_sessions_mac ON radius_sessions (mac_address)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_radius_actions_subscriber ON radius_action_log (subscriber_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_radius_actions_action ON radius_action_log (action)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_radius_actions_created ON radius_action_log (created_at)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_radius_actions_created")
    op.execute("DROP INDEX IF EXISTS idx_radius_actions_action")
    op.execute("DROP INDEX IF EXISTS idx_radius_actions_subscriber")
    op.execute("DROP INDEX IF EXISTS idx_radius_sessions_mac")
    op.execute("DROP INDEX IF EXISTS idx_radius_sessions_framed_ip")
    op.execute("DROP INDEX IF EXISTS idx_radius_sessions_status")
    op.execute("DROP INDEX IF EXISTS idx_radius_sessions_subscriber")
    op.execute("DROP TABLE IF EXISTS radius_action_log")
    op.execute("DROP TABLE IF EXISTS radius_sessions")
