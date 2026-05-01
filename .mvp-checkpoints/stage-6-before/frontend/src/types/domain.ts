export type ThemeMode = "gradient" | "black-beige";

export type UserRole = "user" | "operator" | "billing" | "noc_engineer" | "admin" | "super_admin";

export type MvpRole = "subscriber" | "support" | "billing" | "noc_engineer" | "admin";

export interface ApiListPayload<T> {
  items: T[];
  total: number;
  page: number;
  page_size?: number;
  pageSize?: number;
  total_pages?: number;
  limit?: number;
  unread_count?: number;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  user_id: number;
  role: UserRole;
  requires_2fa: boolean;
  two_factor_token?: string | null;
  message?: string | null;
  verification_channel?: "email" | "sms" | null;
  verification_target?: string | null;
  verification_expires_in?: number | null;
  resend_available_in?: number | null;
  demo_email_code?: string | null;
  demo_email_address?: string | null;
  demo_email_ttl?: number | null;
  demo_sms_code?: string | null;
  demo_sms_phone?: string | null;
  demo_sms_ttl?: number | null;
}

export interface UserProfile {
  id: number;
  billing_id?: string | null;
  phone: string;
  email?: string | null;
  avatar_url?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  role: UserRole;
  is_active: boolean;
  is_verified: boolean;
  is_2fa_enabled: boolean;
  created_at?: string | null;
  last_login_at?: string | null;
  language?: string | null;
  balance?: number | null;
  current_tariff?: Tariff | Record<string, unknown> | null;
  active_sessions_count?: number;
  recent_activity?: Array<Record<string, unknown>>;
}

export interface Tariff {
  id: number;
  billing_tariff_id: string;
  name: string;
  speed_mbps: number;
  upload_speed_mbps?: number | null;
  price: number;
  setup_fee?: number;
  description?: string | null;
  features?: Array<string | Record<string, unknown>>;
  is_active?: boolean;
  is_popular?: boolean;
  is_unlimited?: boolean;
  traffic_limit_gb?: number | null;
  contract_term_months?: number;
}

export interface Payment {
  id: string;
  user_id: string;
  amount: number;
  fee_amount?: number;
  net_amount?: number | null;
  payment_method?: string | null;
  payment_type: string;
  status: string;
  external_id?: string | null;
  payment_url?: string | null;
  description?: string | null;
  created_at: string;
  completed_at?: string | null;
  provider?: string | null;
  can_retry?: boolean;
  billing_applied?: boolean;
}

export interface PaymentMethod {
  id: number;
  user_id: number;
  method_type: string;
  masked_pan?: string | null;
  card_type?: string | null;
  expiry_month?: string | null;
  expiry_year?: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
}

export interface TicketMessage {
  id: string;
  user_id: string;
  body: string;
  is_internal: boolean;
  attachment_path?: string | null;
  attachment_name?: string | null;
  attachment_size?: number | null;
  attachment_mime?: string | null;
  created_at: string;
  user_display_name?: string | null;
}

export interface Ticket {
  id: string;
  subject: string;
  status: string;
  priority: string;
  category?: string | null;
  created_at: string;
  updated_at?: string | null;
  last_activity_at?: string | null;
  closed_at?: string | null;
  resolved_at?: string | null;
  sla_deadline?: string | null;
  escalated_at?: string | null;
  user_id: string;
  assigned_to?: string | null;
  assignee_name?: string | null;
  user_display_name?: string | null;
  is_overdue?: boolean;
}

export interface TicketDetail extends Ticket {
  messages: TicketMessage[];
  resolution_summary?: string | null;
  satisfaction_rating?: number | null;
  first_response_at?: string | null;
  response_time_seconds?: number | null;
  resolution_time_seconds?: number | null;
}

export interface NotificationItem {
  id: number;
  title: string;
  message: string;
  body: string;
  type: string;
  priority: string;
  event_type: string;
  category: string;
  is_read: boolean;
  is_archived: boolean;
  is_sent: boolean;
  action_url?: string | null;
  action_data?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  sent_at?: string | null;
  read_at?: string | null;
  expires_at?: string | null;
  icon?: string | null;
  color?: string | null;
  priority_label?: string | null;
}

export interface NotificationSettings {
  monitoring_enabled: boolean;
  site_enabled: boolean;
  email_enabled: boolean;
  telegram_enabled: boolean;
  browser_push_enabled: boolean;
  telegram_chat_id?: string | null;
  enabled_event_types: string[];
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  alert_cooldown_minutes: number;
  updated_at?: string;
  vapid_public_key?: string | null;
  push_supported?: boolean;
}

export interface NotificationEventType {
  key: string;
  label: string;
  description: string;
  icon: string;
  color: string;
  default_enabled: boolean;
}

export interface TrafficStats {
  total_gb: number;
  daily_load: Array<Record<string, number | string>>;
  hourly_load: Array<Record<string, number | string>>;
  peak_hour?: string | null;
  average_daily?: number | null;
}

export interface PaymentStats {
  total_amount: number;
  average_amount: number;
  largest_payment: number;
  payment_count: number;
  monthly_totals: Array<Record<string, number | string>>;
  recent_payments: Array<Record<string, unknown>>;
}

export interface TicketStats {
  total_tickets: number;
  open_tickets: number;
  resolved_tickets: number;
  closed_tickets: number;
  average_response_time_hours: number;
  average_resolution_time_hours: number;
  status_breakdown: Record<string, number>;
  monthly_trend: Array<Record<string, number | string>>;
}

export interface SpeedtestSession {
  session_id: string;
  expires_in: number;
  download_size_mb: number;
  upload_size_mb: number;
  max_tests_per_hour: number;
  network_check_enabled: boolean;
}

export interface SpeedtestResult {
  id: number;
  download_mbps: number;
  upload_mbps: number;
  ping_ms: number;
  created_at: string;
}

export interface SpeedtestStats {
  avg_download: number;
  avg_upload: number;
  min_ping: number;
  total_tests: number;
  last_test_at?: string | null;
}

export interface MonitoringMetricPoint {
  timestamp: string;
  ping_ms?: number | null;
  packet_loss_pct?: number | null;
  jitter_ms?: number | null;
  download_mbps?: number | null;
  upload_mbps?: number | null;
  quality_score: number;
  quality_state: string;
}

export interface MonitoringMetrics {
  date_from: string;
  date_to: string;
  interval: string;
  points: MonitoringMetricPoint[];
  charts: Record<string, unknown>;
  totals: Record<string, unknown>;
}

export interface MonitoringAlert {
  id: number;
  type: string;
  severity: string;
  status: string;
  metric_name?: string | null;
  message: string;
  start_time: string;
  end_time?: string | null;
  is_read: boolean;
  current_value?: number | null;
  threshold_value?: number | null;
  duration_minutes?: number | null;
  details?: Record<string, unknown> | null;
  created_at: string;
}

export interface MonitoringSubscription {
  monitoring_enabled: boolean;
  email_enabled: boolean;
  telegram_enabled: boolean;
  browser_push_enabled: boolean;
  telegram_chat_id?: string | null;
  alert_cooldown_minutes: number;
  updated_at?: string;
}

export interface MonitoringSummary {
  quality_state: string;
  quality_label: string;
  quality_score: number;
  alerts_last_24h: number;
  unread_alerts: number;
  active_alerts: number;
  last_collected_at?: string | null;
  current_metrics?: MonitoringMetricPoint | null;
  recent_alerts: MonitoringAlert[];
  monitoring_enabled: boolean;
  notification_channels: Record<string, boolean>;
}

export interface DashboardStats {
  total_users: number;
  new_users_today: number;
  new_users_week?: number;
  blocked_users: number;
  total_tickets: number;
  open_tickets: number;
  overdue_tickets: number;
  tickets_today?: number;
  revenue_month: number;
  revenue_today: number;
  active_users_today: number;
  recent_activities: Array<Record<string, unknown>>;
}

export interface AdminStats {
  total_users: number;
  new_users_today: number;
  blocked_users: number;
  total_tickets: number;
  open_tickets: number;
  overdue_tickets: number;
  resolved_tickets_today: number;
  revenue_month: number;
  revenue_today: number;
  active_users_last_24h: number;
  active_users_today: number;
  total_staff: number;
  active_staff: number;
  tickets_by_status: Array<{ key: string; label: string; value: number }>;
  tickets_by_priority: Array<{ key: string; label: string; value: number }>;
  payments_last_7_days: Array<{ date: string; amount: number; count: number }>;
  recent_activity: Array<Record<string, unknown>>;
  monitoring_monitored_users: number;
  monitoring_disabled_users: number;
  monitoring_users_with_active_alerts: number;
  monitoring_critical_alerts_24h: number;
  monitoring_average_quality_score: number;
  monitoring_quality_breakdown: Array<{ key: string; label: string; value: number }>;
  monitoring_alert_types: Array<{ key: string; label: string; value: number }>;
  monitoring_latest_alerts: Array<Record<string, unknown>>;
  monitoring_worst_users: Array<Record<string, unknown>>;
  system_health: Record<string, unknown>;
}

export interface AdminUserRow {
  id: string;
  phone: string;
  email?: string | null;
  billing_id: string;
  full_name: string;
  role: UserRole;
  role_label?: string;
  is_active: boolean;
  is_blocked: boolean;
  status_label?: string;
  created_at?: string | null;
  last_login_at?: string | null;
  balance?: number | null;
  has_debt?: boolean;
  balance_state?: string;
  open_tickets?: number;
  total_tickets?: number;
  last_payment_at?: string | null;
  monitoring?: Record<string, unknown>;
}

export interface AdminTicketRow {
  id: string;
  subject: string;
  status: string;
  priority: string;
  category?: string | null;
  user_id: string;
  user_phone: string;
  user_email?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  sla_deadline?: string | null;
  is_overdue?: boolean;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
}

export interface AdminStaffRow {
  id: string;
  phone: string;
  email?: string | null;
  billing_id: string;
  role: UserRole;
  role_label: string;
  full_name: string;
  display_name: string;
  is_active: boolean;
  is_blocked: boolean;
  is_2fa_enabled: boolean;
  created_at: string;
  last_login_at?: string | null;
}

export interface AdminSystemInfo {
  app_version: string;
  version?: string;
  environment: string;
  uptime: string;
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  db_connections: number;
  active_users_24h: number;
  error_count_last_log_snapshot: number;
}

export interface AdminSystemSettings {
  maintenance_mode: boolean;
  registration_enabled: boolean;
  payment_enabled: boolean;
  ticket_system_enabled: boolean;
  min_payment_amount: number;
  max_payment_amount: number;
  ticket_auto_close_days: number;
  maintenance_message: string;
}

export interface SubscriberTariff {
  tariff_id?: string | null;
  name?: string | null;
  speed_mbps?: number | null;
  upload_speed_mbps?: number | null;
  price?: number | null;
  is_unlimited?: boolean | null;
  traffic_limit_gb?: number | null;
}

export interface SubscriberPayment {
  id: number;
  amount: number;
  fee_amount: number;
  net_amount?: number | null;
  payment_method?: string | null;
  payment_type: string;
  status: string;
  external_id?: string | null;
  description?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export interface SubscriberTicket {
  id: number;
  subject: string;
  category?: string | null;
  status: string;
  priority: string;
  assigned_to?: number | null;
  assignee_name?: string | null;
  created_at: string;
  updated_at?: string | null;
  last_activity_at?: string | null;
  is_overdue: boolean;
}

export interface SubscriberSummary {
  id: number;
  billing_id: string;
  full_name: string;
  connection_address?: string | null;
  phone: string;
  email?: string | null;
  current_tariff?: SubscriberTariff | null;
  balance?: number | null;
  service_status: string;
  service_status_label: string;
  is_active: boolean;
  is_blocked: boolean;
  open_tickets: number;
  total_tickets: number;
  last_payment_at?: string | null;
  ont?: Record<string, unknown>;
}

export interface SubscriberDetail extends SubscriberSummary {
  first_name?: string | null;
  last_name?: string | null;
  middle_name?: string | null;
  account_info: Record<string, unknown>;
  recent_payments: SubscriberPayment[];
  recent_tickets: SubscriberTicket[];
}

export interface SubscriberBalance {
  subscriber_id: number;
  billing_id: string;
  balance: number;
  currency: string;
  has_debt: boolean;
  updated_at: string;
}

export type RadiusSessionStatus = "active" | "blocked" | "disconnected";
export type RadiusAction = "block" | "unblock" | "disconnect" | "change_speed";

export interface RadiusSubscriberBrief {
  id: number;
  billing_id: string;
  full_name: string;
  phone: string;
  email?: string | null;
}

export interface RadiusSession {
  id: number;
  subscriber_id: number;
  username: string;
  framed_ip_address?: string | null;
  mac_address?: string | null;
  nas_ip_address?: string | null;
  nas_port?: string | null;
  session_id: string;
  status: RadiusSessionStatus;
  tariff_profile?: string | null;
  speed_down: number;
  speed_up: number;
  started_at: string;
  updated_at: string;
  subscriber?: RadiusSubscriberBrief | null;
}

export interface RadiusActionLog {
  id: number;
  subscriber_id: number;
  action: RadiusAction;
  old_status?: RadiusSessionStatus | null;
  new_status?: RadiusSessionStatus | null;
  old_speed_down?: number | null;
  new_speed_down?: number | null;
  old_speed_up?: number | null;
  new_speed_up?: number | null;
  performed_by?: number | null;
  performed_by_name?: string | null;
  result: string;
  created_at: string;
  subscriber?: RadiusSubscriberBrief | null;
}

export interface RadiusActionResult {
  session: RadiusSession;
  action: RadiusActionLog;
}

export type GponOltStatus = "online" | "degraded" | "offline";
export type GponOntStatus = "online" | "offline" | "blocked" | "rogue_suspected";

export interface GponSubscriberBrief {
  id: number;
  billing_id: string;
  full_name: string;
  phone: string;
  email?: string | null;
}

export interface GponOlt {
  id: number;
  name: string;
  vendor: string;
  model: string;
  management_ip: string;
  location?: string | null;
  status: GponOltStatus;
  pon_ports_total: number;
  pon_ports_used: number;
  uplink_status: string;
  created_at: string;
  updated_at: string;
}

export interface GponOnt {
  id: number;
  subscriber_id: number;
  olt_id: number;
  serial_number: string;
  mac_address?: string | null;
  pon_port: number;
  ont_id_on_port: number;
  vlan_id: number;
  status: GponOntStatus;
  rx_power?: number | null;
  tx_power?: number | null;
  last_seen_at?: string | null;
  created_at: string;
  updated_at: string;
  subscriber?: GponSubscriberBrief | null;
  olt?: GponOlt | null;
}

export interface GponOltListPayload {
  items: GponOlt[];
  total: number;
}

export interface GponOntActionResult {
  ont: GponOnt;
  action: string;
  result: string;
  audit_entity_type: string;
}

export type ZabbixAlarmType =
  | "bgp_down"
  | "vrrp_failover"
  | "erps_ring_fault"
  | "olt_offline"
  | "low_optical_power"
  | "ups_low_battery"
  | "ddos_detected"
  | "nat_pool_high";

export type ZabbixSeverity = "info" | "warning" | "high" | "critical";
export type ZabbixAlarmStatus = "active" | "acknowledged" | "resolved";
export type ZabbixSourceType = "core_router" | "aggregation_switch" | "olt" | "ont" | "ups" | "external";

export interface ZabbixAlarm {
  id: number;
  alarm_type: ZabbixAlarmType;
  severity: ZabbixSeverity;
  status: ZabbixAlarmStatus;
  source_type: ZabbixSourceType;
  source_name: string;
  source_id?: number | null;
  title: string;
  description?: string | null;
  metric_name?: string | null;
  metric_value?: number | null;
  threshold?: number | null;
  first_seen_at: string;
  last_seen_at: string;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
  acknowledged_by?: number | null;
  resolved_by?: number | null;
}

export interface ZabbixSummary {
  active: number;
  critical: number;
  high: number;
  warning: number;
  resolved: number;
  acknowledged: number;
  total: number;
  by_type: Record<string, number>;
  by_source_type: Record<string, number>;
}

export interface ZabbixAlarmActionResult {
  alarm: ZabbixAlarm;
  action: string;
  result: string;
  audit_entity_type: string;
}

export interface ZabbixRefreshResult {
  refreshed: number;
  created: number;
  result: string;
}
