import { useQuery } from "@tanstack/react-query";
import { Activity, CreditCard, Gauge, RadioTower, Ticket, Wallet } from "lucide-react";
import { Link } from "react-router-dom";

import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Card } from "@/components/ui/Card";
import { CountMetric } from "@/components/ui/CountMetric";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { monitoringService, speedtestService, statisticsService } from "@/services/endpoints/analytics";
import { paymentsService } from "@/services/endpoints/payments";
import { ticketsService } from "@/services/endpoints/tickets";
import { usersService } from "@/services/endpoints/users";
import { formatCurrency, formatRelative } from "@/utils/format";

function getPaymentStatusLabel(status?: string | null) {
  if (status === "completed" || status === "succeeded" || status === "success") {
    return "Завершён";
  }
  if (status === "pending" || status === "processing") {
    return "В обработке";
  }
  if (status === "failed" || status === "error") {
    return "Не прошёл";
  }
  if (status === "cancelled" || status === "canceled") {
    return "Отменён";
  }
  return "Платёж";
}

function getTicketStatusLabel(status?: string | null) {
  if (status === "resolved") {
    return "Решена";
  }
  if (status === "closed") {
    return "Закрыта";
  }
  if (status === "pending" || status === "in_progress") {
    return "В работе";
  }
  if (status === "open" || status === "new") {
    return "Открыта";
  }
  return "Без статуса";
}

function getTicketPriorityLabel(priority?: string | null) {
  if (priority === "critical" || priority === "urgent") {
    return "Критичный приоритет";
  }
  if (priority === "high") {
    return "Высокий приоритет";
  }
  if (priority === "medium" || priority === "normal") {
    return "Стандартный приоритет";
  }
  if (priority === "low") {
    return "Низкий приоритет";
  }
  return "Приоритет не задан";
}

function DashboardMetricCard({
  delay = 0,
  hint,
  icon,
  label,
  value,
}: {
  delay?: number;
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint: string;
}) {
  return (
    <AnimatedReveal className="span-3" delay={delay}>
      <Card className="metric-card">
        <div className="inline-actions">
          {icon}
          <span className="metric-label">{label}</span>
        </div>
        <div className="metric-value">{value}</div>
        <p className="muted">{hint}</p>
      </Card>
    </AnimatedReveal>
  );
}

function DashboardPage() {
  const profileQuery = useQuery({ queryKey: ["dashboard", "me"], queryFn: usersService.me });
  const paymentStatsQuery = useQuery({
    queryKey: ["dashboard", "payment-stats"],
    queryFn: statisticsService.payments,
  });
  const ticketStatsQuery = useQuery({
    queryKey: ["dashboard", "ticket-stats"],
    queryFn: statisticsService.tickets,
  });
  const monitoringQuery = useQuery({
    queryKey: ["dashboard", "monitoring"],
    queryFn: monitoringService.summary,
  });
  const speedtestStatsQuery = useQuery({
    queryKey: ["dashboard", "speedtest-stats"],
    queryFn: speedtestService.stats,
  });
  const recentPaymentsQuery = useQuery({
    queryKey: ["dashboard", "recent-payments"],
    queryFn: () => paymentsService.history(5, 0),
  });
  const recentTicketsQuery = useQuery({
    queryKey: ["dashboard", "recent-tickets"],
    queryFn: () => ticketsService.list(1, 5),
  });

  if (profileQuery.isPending) {
    return (
      <div className="stack-lg">
        <Skeleton className="skeleton-title" />
        <div className="cards-grid">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="skeleton-card span-4" />
          ))}
        </div>
      </div>
    );
  }

  const profile = profileQuery.data;
  const dashboardTitle = profile?.first_name ? `${profile.first_name}, всё под контролем.` : "Всё под контролем.";

  return (
    <div className="stack-lg dashboard-page">
      <AnimatedReveal delay={0}>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Личный кабинет"
            title={dashboardTitle}
            description="Баланс, тариф, уведомления, поддержка, speedtest и мониторинг собраны в одном спокойном кабинете без лишних переходов."
            actions={
              <div className="hero-actions">
                <Link to="/payments">
                  <span className="link-line">Пополнить баланс</span>
                </Link>
                <Link to="/support">
                  <span className="link-line">Открыть поддержку</span>
                </Link>
              </div>
            }
          />
        </Card>
      </AnimatedReveal>

      <div className="cards-grid">
        <DashboardMetricCard
          delay={60}
          icon={<Wallet size={18} />}
          label="Баланс"
          value={<CountMetric value={profile?.balance ?? 0} mode="currency" />}
          hint={profile?.billing_id ? `Лицевой счёт: ${profile.billing_id}` : "Лицевой счёт пока не привязан"}
        />
        <DashboardMetricCard
          delay={120}
          icon={<RadioTower size={18} />}
          label="Текущий тариф"
          value={<>{(profile?.current_tariff as { name?: string } | undefined)?.name ?? "Не выбран"}</>}
          hint={
            profile?.current_tariff
              ? `${(profile.current_tariff as { speed_mbps?: number }).speed_mbps ?? "—"} Мбит/с`
              : "Выберите тариф"
          }
        />
        <DashboardMetricCard
          delay={180}
          icon={<Activity size={18} />}
          label="Мониторинг"
          value={<CountMetric value={monitoringQuery.data?.quality_score ?? 0} suffix=" QI" />}
          hint={monitoringQuery.data?.quality_label ?? "Качество канала будет оценено после первых замеров"}
        />
        <DashboardMetricCard
          delay={240}
          icon={<Gauge size={18} />}
          label="Последняя скорость"
          value={<CountMetric value={speedtestStatsQuery.data?.avg_download ?? 0} suffix=" Мбит/с" />}
          hint={`Тестов в истории: ${speedtestStatsQuery.data?.total_tests ?? 0}`}
        />
      </div>

      <div className="cards-grid">
        <AnimatedReveal className="span-7" delay={300}>
          <Card className="stack-md">
            <div className="inline-actions">
              <CreditCard size={18} />
              <strong>Платёжная динамика</strong>
            </div>
            <div className="summary-row">
              <span>Сумма за период</span>
              <strong>{formatCurrency(paymentStatsQuery.data?.total_amount ?? 0)}</strong>
            </div>
            <div className="summary-row">
              <span>Средний платёж</span>
              <strong>{formatCurrency(paymentStatsQuery.data?.average_amount ?? 0)}</strong>
            </div>
            <div className="summary-row">
              <span>Крупнейший платёж</span>
              <strong>{formatCurrency(paymentStatsQuery.data?.largest_payment ?? 0)}</strong>
            </div>
            <div className="summary-row">
              <span>Платежей всего</span>
              <strong>{paymentStatsQuery.data?.payment_count ?? 0}</strong>
            </div>
          </Card>
        </AnimatedReveal>

        <AnimatedReveal className="span-5" delay={360}>
          <Card className="stack-md">
            <div className="inline-actions">
              <Ticket size={18} />
              <strong>Поддержка</strong>
            </div>
            <div className="summary-row">
              <span>Открытых заявок</span>
              <strong>{ticketStatsQuery.data?.open_tickets ?? 0}</strong>
            </div>
            <div className="summary-row">
              <span>Всего обращений</span>
              <strong>{ticketStatsQuery.data?.total_tickets ?? 0}</strong>
            </div>
            <div className="summary-row">
              <span>Среднее время ответа</span>
              <strong>{ticketStatsQuery.data?.average_response_time_hours ?? 0} ч</strong>
            </div>
            <Link to="/support" className="link-line">
              Перейти к обращениям
            </Link>
          </Card>
        </AnimatedReveal>
      </div>

      <div className="cards-grid">
        <AnimatedReveal className="span-6" delay={420}>
          <Card className="stack-md">
            <div className="toolbar-row">
              <strong>Последние платежи</strong>
              <Link to="/payments" className="link-line">
                Все платежи
              </Link>
            </div>
            {(recentPaymentsQuery.data ?? []).length ? (
              recentPaymentsQuery.data?.map((payment) => (
                <div key={payment.id} className="list-item">
                  <div>
                    <strong>{formatCurrency(payment.amount)}</strong>
                    <p className="muted">{payment.payment_method ?? payment.payment_type ?? "Онлайн-платёж"}</p>
                  </div>
                  <div>
                    <p>{getPaymentStatusLabel(payment.status)}</p>
                    <p className="muted">{formatRelative(payment.created_at)}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">История платежей пока пуста.</p>
            )}
          </Card>
        </AnimatedReveal>

        <AnimatedReveal className="span-6" delay={480}>
          <Card className="stack-md">
            <div className="toolbar-row">
              <strong>Свежие обращения</strong>
              <Link to="/support" className="link-line">
                Все обращения
              </Link>
            </div>
            {(recentTicketsQuery.data?.items ?? []).length ? (
              recentTicketsQuery.data?.items.map((ticket) => (
                <div key={ticket.id} className="list-item">
                  <div>
                    <strong>{ticket.subject}</strong>
                    <p className="muted">{getTicketPriorityLabel(ticket.priority)}</p>
                  </div>
                  <div>
                    <p>{getTicketStatusLabel(ticket.status)}</p>
                    <Link className="link-line" to={`/support/${ticket.id}`}>
                      Открыть
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">Открытых заявок пока нет.</p>
            )}
          </Card>
        </AnimatedReveal>
      </div>
    </div>
  );
}

export default DashboardPage;
