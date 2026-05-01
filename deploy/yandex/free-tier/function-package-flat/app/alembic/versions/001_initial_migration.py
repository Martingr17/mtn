"""initial migration

Revision ID: 001
Revises: 
Create Date: 2026-04-06 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import INET, JSONB, TIMESTAMP

# revision identifiers, used by Alembic.
revision = '001'
down_revision = None
branch_labels = None
depends_on = None

def upgrade() -> None:
    # Create users table
    op.create_table(
        'users',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('billing_id', sa.String(length=64), nullable=False),
        sa.Column('phone', sa.String(length=20), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=True),
        sa.Column('password_hash', sa.String(length=255), nullable=True),
        sa.Column('first_name', sa.String(length=100), nullable=True),
        sa.Column('last_name', sa.String(length=100), nullable=True),
        sa.Column('middle_name', sa.String(length=100), nullable=True),
        sa.Column('passport_number', sa.String(length=20), nullable=True),
        sa.Column('role', sa.Enum('user', 'operator', 'admin', 'super_admin', name='userrole'), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('is_verified', sa.Boolean(), nullable=False),
        sa.Column('is_blocked', sa.Boolean(), nullable=False),
        sa.Column('block_reason', sa.Text(), nullable=True),
        sa.Column('totp_secret', sa.String(length=32), nullable=True),
        sa.Column('is_2fa_enabled', sa.Boolean(), nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('last_login_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('last_login_ip', INET(), nullable=True),
        sa.Column('language', sa.String(length=2), nullable=False),
        sa.Column('notification_settings', JSONB(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('billing_id'),
        sa.UniqueConstraint('phone')
    )
    
    op.create_index('idx_users_phone', 'users', ['phone'])
    op.create_index('idx_users_billing_id', 'users', ['billing_id'])
    op.create_index('idx_users_email', 'users', ['email'])
    op.create_index('idx_users_role_active', 'users', ['role', 'is_active'])
    
    # Create user_sessions table
    op.create_table(
        'user_sessions',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('token', sa.String(length=500), nullable=False),
        sa.Column('refresh_token', sa.String(length=500), nullable=True),
        sa.Column('ip_address', INET(), nullable=False),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('device_info', JSONB(), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False),
        sa.Column('expires_at', TIMESTAMP(timezone=True), nullable=False),
        sa.Column('last_activity_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('is_revoked', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token'),
        sa.UniqueConstraint('refresh_token')
    )
    
    op.create_index('idx_sessions_user_id', 'user_sessions', ['user_id'])
    op.create_index('idx_sessions_token', 'user_sessions', ['token'])
    op.create_index('idx_sessions_expires_at', 'user_sessions', ['expires_at'])
    
    # Create token_blacklist table
    op.create_table(
        'token_blacklist',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('token', sa.String(length=500), nullable=False),
        sa.Column('token_type', sa.String(length=20), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=True),
        sa.Column('revoked_at', TIMESTAMP(timezone=True), nullable=False),
        sa.Column('expires_at', TIMESTAMP(timezone=True), nullable=False),
        sa.Column('reason', sa.String(length=255), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token')
    )
    
    op.create_index('idx_blacklist_token', 'token_blacklist', ['token'])
    op.create_index('idx_blacklist_expires_at', 'token_blacklist', ['expires_at'])
    
    # Create tariffs table
    op.create_table(
        'tariffs',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('billing_tariff_id', sa.String(length=64), nullable=False),
        sa.Column('name', sa.String(length=128), nullable=False),
        sa.Column('name_en', sa.String(length=128), nullable=True),
        sa.Column('speed_mbps', sa.SmallInteger(), nullable=False),
        sa.Column('upload_speed_mbps', sa.SmallInteger(), nullable=True),
        sa.Column('price', sa.Numeric(10, 2), nullable=False),
        sa.Column('setup_fee', sa.Numeric(10, 2), nullable=False),
        sa.Column('is_unlimited', sa.Boolean(), nullable=False),
        sa.Column('traffic_limit_gb', sa.Integer(), nullable=True),
        sa.Column('contract_term_months', sa.SmallInteger(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('description_en', sa.Text(), nullable=True),
        sa.Column('features', JSONB(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('is_popular', sa.Boolean(), nullable=False),
        sa.Column('sort_order', sa.SmallInteger(), nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('billing_tariff_id')
    )
    
    op.create_index('idx_tariffs_billing_id', 'tariffs', ['billing_tariff_id'])
    op.create_index('idx_tariffs_active', 'tariffs', ['is_active'])
    op.create_index('idx_tariffs_price', 'tariffs', ['price'])
    
    # Create tariff_change_requests table
    op.create_table(
        'tariff_change_requests',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('old_tariff_id', sa.BigInteger(), nullable=True),
        sa.Column('new_tariff_id', sa.BigInteger(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('requested_at', TIMESTAMP(timezone=True), nullable=False),
        sa.Column('processed_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('effective_from', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('ip_address', INET(), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['new_tariff_id'], ['tariffs.id'], ),
        sa.ForeignKeyConstraint(['old_tariff_id'], ['tariffs.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    
    op.create_index('idx_tariff_requests_user', 'tariff_change_requests', ['user_id'])
    op.create_index('idx_tariff_requests_status', 'tariff_change_requests', ['status'])
    op.create_index('idx_tariff_requests_created', 'tariff_change_requests', ['requested_at'])
    
    # Create tickets table
    op.create_table(
        'tickets',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('assigned_to', sa.BigInteger(), nullable=True),
        sa.Column('subject', sa.String(length=255), nullable=False),
        sa.Column('category', sa.String(length=50), nullable=True),
        sa.Column('status', sa.Enum('new', 'in_progress', 'waiting_customer', 'resolved', 'closed', 'escalated', name='ticketstatus'), nullable=False),
        sa.Column('priority', sa.Enum('low', 'medium', 'high', 'urgent', 'critical', name='ticketpriority'), nullable=False),
        sa.Column('sla_deadline', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('first_response_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('resolved_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('closed_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('resolution_summary', sa.Text(), nullable=True),
        sa.Column('satisfaction_rating', sa.SmallInteger(), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('last_activity_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('metadata', JSONB(), nullable=True),
        sa.Column('tags', JSONB(), nullable=True),
        sa.ForeignKeyConstraint(['assigned_to'], ['users.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id')
    )
    
    op.create_index('idx_tickets_user_status', 'tickets', ['user_id', 'status'])
    op.create_index('idx_tickets_status_priority', 'tickets', ['status', 'priority'])
    op.create_index('idx_tickets_assigned_to', 'tickets', ['assigned_to'])
    op.create_index('idx_tickets_created_at', 'tickets', ['created_at'])
    op.create_index('idx_tickets_sla_deadline', 'tickets', ['sla_deadline'])
    
    # Create messages table
    op.create_table(
        'messages',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('ticket_id', sa.BigInteger(), nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('is_internal', sa.Boolean(), nullable=False),
        sa.Column('attachment_path', sa.String(length=512), nullable=True),
        sa.Column('attachment_name', sa.String(length=255), nullable=True),
        sa.Column('attachment_size', sa.Integer(), nullable=True),
        sa.Column('attachment_mime', sa.String(length=100), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False),
        sa.Column('edited_at', TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['ticket_id'], ['tickets.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    op.create_index('idx_messages_ticket_id', 'messages', ['ticket_id'])
    op.create_index('idx_messages_user_id', 'messages', ['user_id'])
    op.create_index('idx_messages_created_at', 'messages', ['created_at'])
    
    # Create payments_log table
    op.create_table(
        'payments_log',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('fee_amount', sa.Numeric(10, 2), nullable=False),
        sa.Column('net_amount', sa.Numeric(10, 2), nullable=True),
        sa.Column('payment_method', sa.String(length=64), nullable=True),
        sa.Column('payment_type', sa.String(length=32), nullable=False),
        sa.Column('status', sa.Enum('pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', name='paymentstatus'), nullable=False),
        sa.Column('external_id', sa.String(length=128), nullable=True),
        sa.Column('gateway_response', JSONB(), nullable=True),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False),
        sa.Column('completed_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('ip_address', INET(), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('external_id')
    )
    
    op.create_index('idx_payments_user_id', 'payments_log', ['user_id'])
    op.create_index('idx_payments_status', 'payments_log', ['status'])
    op.create_index('idx_payments_external_id', 'payments_log', ['external_id'])
    op.create_index('idx_payments_created_at', 'payments_log', ['created_at'])
    
    # Create payment_methods table
    op.create_table(
        'payment_methods',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('method_type', sa.String(length=32), nullable=False),
        sa.Column('token', sa.String(length=255), nullable=False),
        sa.Column('masked_pan', sa.String(length=20), nullable=True),
        sa.Column('card_type', sa.String(length=20), nullable=True),
        sa.Column('expiry_month', sa.String(length=2), nullable=True),
        sa.Column('expiry_year', sa.String(length=4), nullable=True),
        sa.Column('is_default', sa.Boolean(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    
    op.create_index('idx_payment_methods_user_id', 'payment_methods', ['user_id'])
    op.create_index('idx_payment_methods_is_default', 'payment_methods', ['is_default'])
    
    # Create notifications table
    op.create_table(
        'notifications',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('type', sa.Enum('email', 'sms', 'push', 'telegram', 'whatsapp', name='notificationtype'), nullable=False),
        sa.Column('priority', sa.Enum('low', 'normal', 'high', 'urgent', name='notificationpriority'), nullable=False),
        sa.Column('is_read', sa.Boolean(), nullable=False),
        sa.Column('is_sent', sa.Boolean(), nullable=False),
        sa.Column('sent_at', TIMESTAMP(timezone=True), nullable=True),
        sa.Column('action_url', sa.String(length=500), nullable=True),
        sa.Column('action_data', JSONB(), nullable=True),
        sa.Column('metadata', JSONB(), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    
    op.create_index('idx_notifications_user_id', 'notifications', ['user_id'])
    op.create_index('idx_notifications_read', 'notifications', ['is_read'])
    op.create_index('idx_notifications_created_at', 'notifications', ['created_at'])
    op.create_index('idx_notifications_type_priority', 'notifications', ['type', 'priority'])
    
    # Create notification_templates table
    op.create_table(
        'notification_templates',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('type', sa.Enum('email', 'sms', 'push', 'telegram', 'whatsapp', name='notificationtype'), nullable=False),
        sa.Column('subject_template', sa.String(length=255), nullable=True),
        sa.Column('body_template', sa.Text(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False),
        sa.Column('updated_at', TIMESTAMP(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
    )
    
    # Create activity_log table
    op.create_table(
        'activity_log',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=True),
        sa.Column('action', sa.String(length=128), nullable=False),
        sa.Column('action_type', sa.Enum('login', 'logout', 'login_failed', 'register', 'password_change', 'password_reset', 'profile_update', 'profile_view', 'tariff_view', 'tariff_change', 'payment_create', 'payment_success', 'payment_fail', 'ticket_create', 'ticket_view', 'ticket_reply', 'ticket_close', 'ticket_escalate', 'admin_user_block', 'admin_user_unblock', 'admin_tariff_force_change', 'admin_ticket_assign', 'admin_ticket_resolve', 'admin_settings_change', 'backup_created', 'backup_restored', 'system_error', name='actiontype'), nullable=True),
        sa.Column('ip_address', INET(), nullable=False),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('resource_type', sa.String(length=50), nullable=True),
        sa.Column('resource_id', sa.BigInteger(), nullable=True),
        sa.Column('old_value', JSONB(), nullable=True),
        sa.Column('new_value', JSONB(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    
    op.create_index('idx_activity_user_id', 'activity_log', ['user_id'])
    op.create_index('idx_activity_action', 'activity_log', ['action'])
    op.create_index('idx_activity_created_at', 'activity_log', ['created_at'])
    op.create_index('idx_activity_user_action_date', 'activity_log', ['user_id', 'action', 'created_at'])
    
    # Create audit_log table
    op.create_table(
        'audit_log',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.BigInteger(), nullable=True),
        sa.Column('entity_type', sa.String(length=50), nullable=False),
        sa.Column('entity_id', sa.BigInteger(), nullable=False),
        sa.Column('operation', sa.String(length=50), nullable=False),
        sa.Column('changes', JSONB(), nullable=True),
        sa.Column('ip_address', INET(), nullable=False),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('requires_retention', sa.Boolean(), nullable=False),
        sa.Column('created_at', TIMESTAMP(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    
    op.create_index('idx_audit_user_id', 'audit_log', ['user_id'])
    op.create_index('idx_audit_entity', 'audit_log', ['entity_type', 'entity_id'])
    op.create_index('idx_audit_created_at', 'audit_log', ['created_at'])
    
    # Insert default tariffs
    op.execute("""
        INSERT INTO tariffs (billing_tariff_id, name, speed_mbps, price, setup_fee, is_unlimited, contract_term_months, description, is_active, is_popular, sort_order, created_at)
        VALUES 
        ('TARIFF_100', 'Стартовый', 100, 450.00, 0, true, 12, 'Базовый тариф для домашнего интернета', true, false, 1, NOW()),
        ('TARIFF_200', 'Оптимальный', 200, 650.00, 0, true, 12, 'Скорость до 200 Мбит/с', true, true, 2, NOW()),
        ('TARIFF_500', 'Премиум', 500, 950.00, 0, true, 12, 'Высокоскоростной интернет', true, false, 3, NOW()),
        ('TARIFF_1000', 'Гигабитный', 1000, 1450.00, 500, false, 12, 'Гигабитный интернет с ограничением 5 ТБ', true, false, 4, NOW())
    """)

def downgrade() -> None:
    op.drop_index('idx_audit_created_at', table_name='audit_log')
    op.drop_index('idx_audit_entity', table_name='audit_log')
    op.drop_index('idx_audit_user_id', table_name='audit_log')
    op.drop_table('audit_log')
    
    op.drop_index('idx_activity_user_action_date', table_name='activity_log')
    op.drop_index('idx_activity_created_at', table_name='activity_log')
    op.drop_index('idx_activity_action', table_name='activity_log')
    op.drop_index('idx_activity_user_id', table_name='activity_log')
    op.drop_table('activity_log')
    
    op.drop_table('notification_templates')
    
    op.drop_index('idx_notifications_type_priority', table_name='notifications')
    op.drop_index('idx_notifications_created_at', table_name='notifications')
    op.drop_index('idx_notifications_read', table_name='notifications')
    op.drop_index('idx_notifications_user_id', table_name='notifications')
    op.drop_table('notifications')
    
    op.drop_index('idx_payment_methods_is_default', table_name='payment_methods')
    op.drop_index('idx_payment_methods_user_id', table_name='payment_methods')
    op.drop_table('payment_methods')
    
    op.drop_index('idx_payments_created_at', table_name='payments_log')
    op.drop_index('idx_payments_external_id', table_name='payments_log')
    op.drop_index('idx_payments_status', table_name='payments_log')
    op.drop_index('idx_payments_user_id', table_name='payments_log')
    op.drop_table('payments_log')
    
    op.drop_index('idx_messages_created_at', table_name='messages')
    op.drop_index('idx_messages_user_id', table_name='messages')
    op.drop_index('idx_messages_ticket_id', table_name='messages')
    op.drop_table('messages')
    
    op.drop_index('idx_tickets_sla_deadline', table_name='tickets')
    op.drop_index('idx_tickets_created_at', table_name='tickets')
    op.drop_index('idx_tickets_assigned_to', table_name='tickets')
    op.drop_index('idx_tickets_status_priority', table_name='tickets')
    op.drop_index('idx_tickets_user_status', table_name='tickets')
    op.drop_table('tickets')
    
    op.drop_index('idx_tariff_requests_created', table_name='tariff_change_requests')
    op.drop_index('idx_tariff_requests_status', table_name='tariff_change_requests')
    op.drop_index('idx_tariff_requests_user', table_name='tariff_change_requests')
    op.drop_table('tariff_change_requests')
    
    op.drop_index('idx_tariffs_price', table_name='tariffs')
    op.drop_index('idx_tariffs_active', table_name='tariffs')
    op.drop_index('idx_tariffs_billing_id', table_name='tariffs')
    op.drop_table('tariffs')
    
    op.drop_index('idx_blacklist_expires_at', table_name='token_blacklist')
    op.drop_index('idx_blacklist_token', table_name='token_blacklist')
    op.drop_table('token_blacklist')
    
    op.drop_index('idx_sessions_expires_at', table_name='user_sessions')
    op.drop_index('idx_sessions_token', table_name='user_sessions')
    op.drop_index('idx_sessions_user_id', table_name='user_sessions')
    op.drop_table('user_sessions')
    
    op.drop_index('idx_users_role_active', table_name='users')
    op.drop_index('idx_users_email', table_name='users')
    op.drop_index('idx_users_billing_id', table_name='users')
    op.drop_index('idx_users_phone', table_name='users')
    op.drop_table('users')
    
    op.execute('DROP TYPE IF EXISTS actiontype')
    op.execute('DROP TYPE IF EXISTS notificationpriority')
    op.execute('DROP TYPE IF EXISTS notificationtype')
    op.execute('DROP TYPE IF EXISTS paymentstatus')
    op.execute('DROP TYPE IF EXISTS ticketpriority')
    op.execute('DROP TYPE IF EXISTS ticketstatus')
    op.execute('DROP TYPE IF EXISTS userrole')