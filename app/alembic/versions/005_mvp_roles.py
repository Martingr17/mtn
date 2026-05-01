"""add MVP staff roles

Revision ID: 005
Revises: 004
Create Date: 2026-04-29 00:00:00.000000
"""

from alembic import op


revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'billing'")
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'noc_engineer'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values without rebuilding the type.
    pass
