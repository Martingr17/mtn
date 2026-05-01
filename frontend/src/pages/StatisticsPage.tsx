import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { Activity, CreditCard, LifeBuoy, TrendingUp } from "lucide-react";

import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Card } from "@/components/ui/Card";
import { CountMetric } from "@/components/ui/CountMetric";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { statisticsService } from "@/services/endpoints/analytics";
import { formatCurrency, formatNumber } from "@/utils/format";

function getTicketStatusLabel(status: string) {
  if (status === "resolved") {
    return "Решены";
  }
  if (status === "closed") {
    return "Закрыты";
  }
  if (status === "pending" || status === "in_progress") {
    return "В работе";
  }
  if (status === "open" || status === "new") {
    return "Открыты";
  }
  return "Без статуса";
}

function StatisticsPage() {
  const trafficQuery = useQuery({
    queryKey: ["statistics-page", "traffic"],
    queryFn: statisticsService.traffic,
  });
  const paymentQuery = useQuery({
    queryKey: ["statistics-page", "payments"],
    queryFn: statisticsService.payments,
  });
  const ticketQuery = useQuery({
    queryKey: ["statistics-page", "tickets"],
    queryFn: statisticsService.tickets,
  });

  const paymentTrend = useMemo(() => {
    const rows = paymentQuery.data?.monthly_totals ?? [];
    if (rows.length < 2) {
      return 0;
    }

    const last = Number(rows[rows.length - 1].amount ?? rows[rows.length - 1].total ?? 0);
    const previous = Number(rows[rows.length - 2].amount ?? rows[rows.length - 2].total ?? 0);
    return last - previous;
  }, [paymentQuery.data?.monthly_totals]);

  const ticketResolutionRate = useMemo(() => {
    const total = ticketQuery.data?.total_tickets ?? 0;
    const resolved = ticketQuery.data?.resolved_tickets ?? 0;
    return total ? Math.round((resolved / total) * 100) : 0;
  }, [ticketQuery.data?.resolved_tickets, ticketQuery.data?.total_tickets]);

  const statusBreakdown = Object.entries(ticketQuery.data?.status_breakdown ?? {});

  return (
    <div className="stack-lg statistics-page">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Статистика"
            title="Статистика по аккаунту"
            description="Трафик, платежи и обращения собраны в одном коротком обзоре."
          />
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.05}>
        <div className="cards-grid">
          <Card className="metric-card">
            <div className="inline-actions">
              <Activity size={18} />
              <span className="metric-label">Трафик за период</span>
            </div>
            <div className="metric-value">
              <CountMetric value={trafficQuery.data?.total_gb ?? 0} suffix=" ГБ" />
            </div>
            <p className="muted">
              Среднесуточная нагрузка: {formatNumber(trafficQuery.data?.average_daily ?? 0, 1)} ГБ
            </p>
          </Card>

          <Card className="metric-card">
            <div className="inline-actions">
              <CreditCard size={18} />
              <span className="metric-label">Платежи</span>
            </div>
            <div className="metric-value">
              <CountMetric value={paymentQuery.data?.total_amount ?? 0} mode="currency" />
            </div>
            <p className="muted">Средний платёж: {formatCurrency(paymentQuery.data?.average_amount ?? 0)}</p>
          </Card>

          <Card className="metric-card">
            <div className="inline-actions">
              <LifeBuoy size={18} />
              <span className="metric-label">Поддержка</span>
            </div>
            <div className="metric-value">
              <CountMetric value={ticketQuery.data?.total_tickets ?? 0} />
            </div>
            <p className="muted">Открыто сейчас: {ticketQuery.data?.open_tickets ?? 0}</p>
          </Card>

          <Card className="metric-card">
            <div className="inline-actions">
              <TrendingUp size={18} />
              <span className="metric-label">Решено в срок</span>
            </div>
            <div className="metric-value">
              <CountMetric value={ticketResolutionRate} suffix="%" />
            </div>
            <p className="muted">
              Среднее время ответа: {formatNumber(ticketQuery.data?.average_response_time_hours ?? 0, 1)} ч
            </p>
          </Card>
        </div>
      </AnimatedReveal>

      <AnimatedReveal delay={0.1}>
        <div className="cards-grid">
          <Card className="span-6 stack-md">
            <div className="toolbar-row">
              <strong>Помесячные платежи</strong>
              <StatusBadge tone={paymentTrend >= 0 ? "success" : "warning"}>
                {paymentTrend >= 0 ? "Рост" : "Снижение"}
              </StatusBadge>
            </div>

            {(paymentQuery.data?.monthly_totals ?? []).length ? (
              (paymentQuery.data?.monthly_totals ?? []).map((item, index) => (
                <div key={index} className="summary-row">
                  <span>{String(item.month ?? item.date ?? `Период ${index + 1}`)}</span>
                  <strong>{formatCurrency(Number(item.amount ?? item.total ?? 0))}</strong>
                </div>
              ))
            ) : (
              <p className="muted">
                Помесячная динамика появится после накопления первых платёжных операций.
              </p>
            )}
          </Card>

          <Card className="span-6 stack-md">
            <div className="toolbar-row">
              <strong>Тренд обращений</strong>
              <span className="muted">История по месяцам</span>
            </div>

            {(ticketQuery.data?.monthly_trend ?? []).length ? (
              (ticketQuery.data?.monthly_trend ?? []).map((item, index) => (
                <div key={index} className="summary-row">
                  <span>{String(item.month ?? item.date ?? `Период ${index + 1}`)}</span>
                  <strong>{formatNumber(Number(item.count ?? item.total ?? 0))}</strong>
                </div>
              ))
            ) : (
              <p className="muted">История обращений станет доступна, когда в системе накопится достаточно данных.</p>
            )}
          </Card>
        </div>
      </AnimatedReveal>

      <AnimatedReveal delay={0.15}>
        <div className="cards-grid">
          <Card className="span-5 stack-md">
            <strong>Статусы заявок</strong>

            {statusBreakdown.length ? (
              statusBreakdown.map(([status, value]) => (
                <div key={status} className="list-item">
                  <div>
                    <strong>{getTicketStatusLabel(status)}</strong>
                    <p className="muted">Распределение по текущему состоянию очереди</p>
                  </div>
                  <strong>{formatNumber(value)}</strong>
                </div>
              ))
            ) : (
              <p className="muted">Детализация по статусам заявок пока недоступна.</p>
            )}
          </Card>

          <Card className="span-7 stack-md">
            <strong>Ключевые выводы</strong>
            <div className="summary-row">
              <span>Пиковый час нагрузки</span>
              <strong>{trafficQuery.data?.peak_hour ?? "нет данных"}</strong>
            </div>
            <div className="summary-row">
              <span>Количество платежей</span>
              <strong>{formatNumber(paymentQuery.data?.payment_count ?? 0)}</strong>
            </div>
            <div className="summary-row">
              <span>Крупнейший платёж</span>
              <strong>{formatCurrency(paymentQuery.data?.largest_payment ?? 0)}</strong>
            </div>
            <div className="summary-row">
              <span>Среднее время решения заявки</span>
              <strong>{formatNumber(ticketQuery.data?.average_resolution_time_hours ?? 0, 1)} ч</strong>
            </div>
          </Card>
        </div>
      </AnimatedReveal>
    </div>
  );
}

export default StatisticsPage;
