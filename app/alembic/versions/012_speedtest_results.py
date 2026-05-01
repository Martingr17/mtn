"""speedtest results table

Revision ID: 012
Revises: 011
Create Date: 2026-05-01 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import INET, JSONB, TIMESTAMP


revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "speedtest_results",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("download_mbps", sa.Numeric(10, 2), nullable=False),
        sa.Column("upload_mbps", sa.Numeric(10, 2), nullable=False),
        sa.Column("ping_ms", sa.Numeric(10, 2), nullable=False),
        sa.Column("ip_address", INET(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("server_meta", JSONB(), nullable=True),
        sa.Column("created_at", TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index("idx_speedtest_results_user_id", "speedtest_results", ["user_id"])
    op.create_index("idx_speedtest_results_created_at", "speedtest_results", ["created_at"])


def downgrade() -> None:
    op.drop_index("idx_speedtest_results_created_at", table_name="speedtest_results")
    op.drop_index("idx_speedtest_results_user_id", table_name="speedtest_results")
    op.drop_table("speedtest_results")
