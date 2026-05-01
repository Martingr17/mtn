"""gpon mock adapter tables

Revision ID: 008
Revises: 007
Create Date: 2026-04-29 00:00:00.000000
"""

from alembic import op


revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS olts (
            id BIGSERIAL PRIMARY KEY,
            name VARCHAR(128) NOT NULL,
            vendor VARCHAR(64) NOT NULL DEFAULT 'Eltex',
            model VARCHAR(64) NOT NULL DEFAULT 'LTP-16X',
            management_ip INET NOT NULL UNIQUE,
            location VARCHAR(255),
            status VARCHAR(24) NOT NULL DEFAULT 'online',
            pon_ports_total INTEGER NOT NULL DEFAULT 16,
            pon_ports_used INTEGER NOT NULL DEFAULT 0,
            uplink_status VARCHAR(24) NOT NULL DEFAULT 'up',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS onts (
            id BIGSERIAL PRIMARY KEY,
            subscriber_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            olt_id BIGINT NOT NULL REFERENCES olts(id) ON DELETE CASCADE,
            serial_number VARCHAR(64) NOT NULL UNIQUE,
            mac_address VARCHAR(32),
            pon_port INTEGER NOT NULL,
            ont_id_on_port INTEGER NOT NULL,
            vlan_id INTEGER NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'online',
            rx_power NUMERIC(6, 2),
            tx_power NUMERIC(6, 2),
            last_seen_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    op.execute("CREATE INDEX IF NOT EXISTS idx_olts_status ON olts (status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_olts_management_ip ON olts (management_ip)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_onts_subscriber ON onts (subscriber_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_onts_olt ON onts (olt_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_onts_status ON onts (status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_onts_vlan ON onts (vlan_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_onts_pon_port ON onts (pon_port)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_onts_rx_power ON onts (rx_power)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_onts_rx_power")
    op.execute("DROP INDEX IF EXISTS idx_onts_pon_port")
    op.execute("DROP INDEX IF EXISTS idx_onts_vlan")
    op.execute("DROP INDEX IF EXISTS idx_onts_status")
    op.execute("DROP INDEX IF EXISTS idx_onts_olt")
    op.execute("DROP INDEX IF EXISTS idx_onts_subscriber")
    op.execute("DROP INDEX IF EXISTS idx_olts_management_ip")
    op.execute("DROP INDEX IF EXISTS idx_olts_status")
    op.execute("DROP TABLE IF EXISTS onts")
    op.execute("DROP TABLE IF EXISTS olts")
