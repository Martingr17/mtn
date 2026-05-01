"""subscriber card address field

Revision ID: 006
Revises: 005
Create Date: 2026-04-29 00:30:00.000000
"""

from alembic import op


revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS connection_address VARCHAR(512)")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS connection_address")
