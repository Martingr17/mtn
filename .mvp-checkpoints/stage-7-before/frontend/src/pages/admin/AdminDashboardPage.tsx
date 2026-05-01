import type { ReactNode } from "react";

import { useQuery } from "@tanstack/react-query";
import { Activity, CreditCard, Shield, Users } from "lucide-react";

import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Card } from "@/components/ui/Card";
import { CountMetric } from "@/components/ui/CountMetric";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { adminService } from "@/services/endpoints/admin";
import { formatCurrency, formatDate, formatNumber } from "@/utils/format";

function MetricCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint: string;
}) {
  return (
    <Card className="metric-card">
      <div className="inline-actions">
        {icon}
        <span className="metric-label">{label}</span>
      </div>
      <div className="metric-value">{value}</div>
      <p className="muted">{hint}</p>
    </Card>
  );
}

function formatActivityTitle(item: Record<string, unknown>) {
  return String(item.title ?? item.action ?? item.description ?? "Системное событие");
}

function formatActivityMeta(item: Record<string, unknown>) {
  const actor = String(item.user_name ?? item.actor ?? item.user_phone ?? "MTN");
  const details = String(item.message ?? item.details ?? "Детали доступны в журнале событий.");
  return `${actor} · ${details}`;
}

function AdminDashboardPage() {
  const statsQuery = useQuery({
    queryKey: ["admin-dashboard", "stats"],
    queryFn: adminService.stats,
  });
  const systemInfoQuery = useQuery({
    queryKey: ["admin-dashboard", "system"],
    queryFn: adminService.systemInfo,
  });

  const stats = statsQuery.data;
  const systemInfo = systemInfoQuery.data;
  const activity = stats?.recent_activity ?? [];

  return (
    <div className="stack-lg admin-dashboard-page">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Админ-панель"
            title="Операционный обзор MTN"
            description="Абонентская база, финансы, поддержка и состояние платформы собраны в одной панели без визуального шума."
          />
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.05}>
        <div className="cards-grid">
          <MetricCard
            icon={<Users size={18} />}
            label="Абоненты"
            value={<CountMetric value={stats?.total_users ?? 0} />}
            hint={`Новых сегодня: ${formatNumber(stats?.new_users_today ?? 0)}`}
          />
          <MetricCard
            icon={<CreditCard size={18} />}
            label="Выручка месяца"
            value={<CountMetric value={stats?.revenue_month ?? 0} mode="currency" />}
            hint={`Сегодня: ${formatCurrency(stats?.revenue_today ?? 0)}`}
          />
          <MetricCard
            icon={<Shield size={18} />}
            label="Открытые заявки"
            value={<CountMetric value={stats?.open_tickets ?? 0} />}
            hint={`Просрочено: ${formatNumber(stats?.overdue_tickets ?? 0)}`}
          />
          <MetricCard
            icon={<Activity size={18} />}
            label="Средний quality score"
            value={<CountMetric value={stats?.monitoring_average_quality_score ?? 0} suffix=" QI" />}
            hint={`Критических алертов за 24 ч: ${formatNumber(stats?.monitoring_critical_alerts_24h ?? 0)}`}
          />
        </div>
      </AnimatedReveal>

      <AnimatedReveal delay={0.1}>
        <div className="cards-grid">
          <Card className="span-7 stack-md">
            <div className="toolbar-row">
              <strong>Последняя активность</strong>
              <span className="muted">{activity.length} событий</span>
            </div>

            {activity.length ? (
              activity.map((item, index) => (
                <div key={index} className="list-item">
                  <div>
                    <strong>{formatActivityTitle(item)}</strong>
                    <p className="muted">{formatActivityMeta(item)}</p>
                  </div>
                  <span className="muted">
                    {formatDate(String(item.created_at ?? item.timestamp ?? new Date().toISOString()))}
                  </span>
                </div>
              ))
            ) : (
              <p className="muted">Журнал заполнится после первых действий операторов и системных событий.</p>
            )}
          </Card>

          <Card className="span-5 stack-md">
            <div className="toolbar-row">
              <strong>Состояние платформы</strong>
              <StatusBadge tone={(systemInfo?.cpu_percent ?? 0) < 85 ? "success" : "warning"}>
                {systemInfo?.environment ?? "production"}
              </StatusBadge>
            </div>

            <div className="summary-row">
              <span>Версия приложения</span>
              <strong>{systemInfo?.app_version ?? "н/д"}</strong>
            </div>
            <div className="summary-row">
              <span>Время работы</span>
              <strong>{systemInfo?.uptime ?? "н/д"}</strong>
            </div>
            <div className="summary-row">
              <span>CPU</span>
              <strong>{formatNumber(systemInfo?.cpu_percent ?? 0)}%</strong>
            </div>
            <div className="summary-row">
              <span>Память</span>
              <strong>{formatNumber(systemInfo?.memory_percent ?? 0)}%</strong>
            </div>
            <div className="summary-row">
              <span>Диск</span>
              <strong>{formatNumber(systemInfo?.disk_percent ?? 0)}%</strong>
            </div>
            <div className="summary-row">
              <span>Соединения с БД</span>
              <strong>{formatNumber(systemInfo?.db_connections ?? 0)}</strong>
            </div>
          </Card>
        </div>
      </AnimatedReveal>

      <AnimatedReveal delay={0.15}>
        <div className="cards-grid">
          <Card className="span-6 stack-md">
            <div className="toolbar-row">
              <strong>Статусы заявок</strong>
              <span className="muted">Распределение</span>
            </div>
            {(stats?.tickets_by_status ?? []).map((row) => (
              <div key={row.key} className="list-item">
                <span>{row.label}</span>
                <strong>{formatNumber(row.value)}</strong>
              </div>
            ))}
          </Card>

          <Card className="span-6 stack-md">
            <div className="toolbar-row">
              <strong>Приоритеты заявок</strong>
              <span className="muted">Фокус команды</span>
            </div>
            {(stats?.tickets_by_priority ?? []).map((row) => (
              <div key={row.key} className="list-item">
                <span>{row.label}</span>
                <strong>{formatNumber(row.value)}</strong>
              </div>
            ))}
          </Card>
        </div>
      </AnimatedReveal>
    </div>
  );
}

export default AdminDashboardPage;
