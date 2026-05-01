"""spec alignment migration

Revision ID: 002
Revises: 001
Create Date: 2026-04-09 12:00:00.000000
"""

from alembic import op


revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(512)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_settings JSONB DEFAULT '{}'::jsonb")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(32)")
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_2fa_enabled BOOLEAN DEFAULT FALSE")
    op.execute("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ")
    op.execute("ALTER TABLE payments_log ADD COLUMN IF NOT EXISTS payment_url VARCHAR(512)")


def downgrade() -> None:
    op.execute("ALTER TABLE payments_log DROP COLUMN IF EXISTS payment_url")
    op.execute("ALTER TABLE tickets DROP COLUMN IF EXISTS escalated_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS is_2fa_enabled")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS totp_secret")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS notification_settings")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS last_login_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS avatar_url")
