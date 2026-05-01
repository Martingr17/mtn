import { useMemo, useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, BellRing, Radar, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CountMetric } from "@/components/ui/CountMetric";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useButtonFeedback } from "@/hooks/use-button-feedback";
import { monitoringService } from "@/services/endpoints/analytics";
import { formatDate, formatPercent, formatRelative, formatSpeed } from "@/utils/format";

type MonitoringFormState = {
  monitoring_enabled: boolean;
  email_enabled: boolean;
  telegram_enabled: boolean;
  browser_push_enabled: boolean;
  telegram_chat_id: string;
  alert_cooldown_minutes: number;
};

const DEFAULT_MONITORING_FORM: MonitoringFormState = {
  monitoring_enabled: true,
  email_enabled: true,
  telegram_enabled: false,
  browser_push_enabled: true,
  telegram_chat_id: "",
  alert_cooldown_minutes: 30,
};

function getAlertSeverityLabel(severity?: string | null) {
  if (severity === "critical") {
    return "Критично";
  }

  if (severity === "warning") {
    return "Предупреждение";
  }

  return "Информация";
}

function getAlertStatusLabel(status?: string | null) {
  if (status === "resolved") {
    return "Решён";
  }

  if (status === "active" || status === "open") {
    return "Активен";
  }

  return "Новый";
}

function MonitoringPage() {
  const saveButton = useButtonFeedback();
  const summaryQuery = useQuery({
    queryKey: ["monitoring-page", "summary"],
    queryFn: monitoringService.summary,
  });
  const metricsQuery = useQuery({
    queryKey: ["monitoring-page", "metrics"],
    queryFn: () => monitoringService.metrics({ interval: "hour", range: "24h" }),
  });
  const alertsQuery = useQuery({
    queryKey: ["monitoring-page", "alerts"],
    queryFn: () => monitoringService.alerts(1, 10),
  });
  const subscriptionQuery = useQuery({
    queryKey: ["monitoring-page", "subscription"],
    queryFn: monitoringService.subscription,
  });

  const [draftState, setDraftState] = useState<Partial<MonitoringFormState>>({});
  const formState = useMemo<MonitoringFormState>(() => {
    if (!subscriptionQuery.data) {
      return { ...DEFAULT_MONITORING_FORM, ...draftState };
    }

    return {
      monitoring_enabled: subscriptionQuery.data.monitoring_enabled,
      email_enabled: subscriptionQuery.data.email_enabled,
      telegram_enabled: subscriptionQuery.data.telegram_enabled,
      browser_push_enabled: subscriptionQuery.data.browser_push_enabled,
      telegram_chat_id: subscriptionQuery.data.telegram_chat_id ?? "",
      alert_cooldown_minutes: subscriptionQuery.data.alert_cooldown_minutes,
      ...draftState,
    };
  }, [draftState, subscriptionQuery.data]);

  const updateSubscriptionMutation = useMutation({
    mutationFn: () =>
      monitoringService.updateSubscription({
        ...formState,
        telegram_chat_id: formState.telegram_chat_id || undefined,
      }),
    onSuccess: () => {
      saveButton.flashFeedback("success");
      toast.success("Настройки мониторинга сохранены.");
      queryClient.invalidateQueries({ queryKey: ["monitoring-page", "subscription"] });
      queryClient.invalidateQueries({ queryKey: ["monitoring-page", "summary"] });
    },
    onError: () => {
      saveButton.flashFeedback("error");
      toast.error("Не удалось обновить настройки мониторинга.");
    },
  });

  const markReadMutation = useMutation({
    mutationFn: (alertId: number) => monitoringService.markAlertRead(alertId),
    onSuccess: () => {
      toast.success("Алерт отмечен как просмотренный.");
      queryClient.invalidateQueries({ queryKey: ["monitoring-page", "alerts"] });
      queryClient.invalidateQueries({ queryKey: ["monitoring-page", "summary"] });
    },
    onError: () => toast.error("Не удалось обновить статус алерта."),
  });

  const metricPoints = metricsQuery.data?.points;
  const recentPoints = useMemo(() => (metricPoints ?? []).slice(-6).reverse(), [metricPoints]);
  const alerts = alertsQuery.data?.items ?? [];

  return (
    <div className="stack-lg">
      <AnimatedReveal delay={0}>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Мониторинг"
            title="Качество сети и контроль инцидентов"
            description="Сводка по качеству соединения, последние алерты и каналы уведомлений собраны в одном рабочем экране."
          />
        </Card>
      </AnimatedReveal>

      <div className="cards-grid">
        <AnimatedReveal className="span-3" delay={70}>
          <Card className="metric-card">
            <div className="inline-actions">
              <ShieldCheck size={18} />
              <span className="metric-label">Индекс качества</span>
            </div>
            <div className="metric-value">
              <CountMetric value={summaryQuery.data?.quality_score ?? 0} suffix=" QI" />
            </div>
            <p className="muted">{summaryQuery.data?.quality_label ?? "Ждём первую выборку"}</p>
          </Card>
        </AnimatedReveal>

        <AnimatedReveal className="span-3" delay={130}>
          <Card className="metric-card">
            <div className="inline-actions">
              <BellRing size={18} />
              <span className="metric-label">Активные алерты</span>
            </div>
            <div className="metric-value">
              <CountMetric value={summaryQuery.data?.active_alerts ?? 0} />
            </div>
            <p className="muted">Непрочитано: {summaryQuery.data?.unread_alerts ?? 0}</p>
          </Card>
        </AnimatedReveal>

        <AnimatedReveal className="span-3" delay={190}>
          <Card className="metric-card">
            <div className="inline-actions">
              <Activity size={18} />
              <span className="metric-label">Пинг сейчас</span>
            </div>
            <div className="metric-value">
              <CountMetric value={summaryQuery.data?.current_metrics?.ping_ms ?? 0} suffix=" ms" />
            </div>
            <p className="muted">Потери: {formatPercent(summaryQuery.data?.current_metrics?.packet_loss_pct ?? 0)}</p>
          </Card>
        </AnimatedReveal>

        <AnimatedReveal className="span-3" delay={250}>
          <Card className="metric-card">
            <div className="inline-actions">
              <Radar size={18} />
              <span className="metric-label">Скорость сейчас</span>
            </div>
            <div className="metric-value">
              <CountMetric value={summaryQuery.data?.current_metrics?.download_mbps ?? 0} suffix=" Мбит/с" />
            </div>
            <p className="muted">Upload: {formatSpeed(summaryQuery.data?.current_metrics?.upload_mbps ?? 0)}</p>
          </Card>
        </AnimatedReveal>
      </div>

      <div className="cards-grid">
        <AnimatedReveal className="span-7" delay={310}>
          <Card className="stack-md">
            <div className="toolbar-row">
              <strong>Последние замеры</strong>
              <span className="muted">Обновлено {formatDate(summaryQuery.data?.last_collected_at, "d MMM, HH:mm")}</span>
            </div>

            {recentPoints.length ? (
              recentPoints.map((point) => (
                <div key={point.timestamp} className="list-item">
                  <div>
                    <strong>{formatDate(point.timestamp, "d MMM, HH:mm")}</strong>
                    <p className="muted">
                      Ping {Math.round(point.ping_ms ?? 0)} ms, Jitter {Math.round(point.jitter_ms ?? 0)} ms
                    </p>
                  </div>
                  <div className="stack-sm align-end-grid">
                    <StatusBadge
                      tone={point.quality_score >= 80 ? "success" : point.quality_score >= 60 ? "warning" : "danger"}
                    >
                      {point.quality_state}
                    </StatusBadge>
                    <div className="minw-180">
                      <div className="progress-bar">
                        <span style={{ width: `${Math.max(6, Math.min(point.quality_score, 100))}%` }} />
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">График заполнится после первых измерений качества канала.</p>
            )}
          </Card>
        </AnimatedReveal>

        <AnimatedReveal className="span-5" delay={370}>
          <Card className="stack-md">
            <div className="toolbar-row">
              <strong>Каналы уведомлений</strong>
              <StatusBadge tone={formState.monitoring_enabled ? "success" : "neutral"}>
                {formState.monitoring_enabled ? "Включено" : "Пауза"}
              </StatusBadge>
            </div>

            <label className="inline-actions">
              <input
                type="checkbox"
                checked={formState.monitoring_enabled}
                onChange={(event) => setDraftState((current) => ({ ...current, monitoring_enabled: event.target.checked }))}
              />
              <span>Автоматический мониторинг линии</span>
            </label>
            <label className="inline-actions">
              <input
                type="checkbox"
                checked={formState.email_enabled}
                onChange={(event) => setDraftState((current) => ({ ...current, email_enabled: event.target.checked }))}
              />
              <span>Email-уведомления</span>
            </label>
            <label className="inline-actions">
              <input
                type="checkbox"
                checked={formState.browser_push_enabled}
                onChange={(event) => setDraftState((current) => ({ ...current, browser_push_enabled: event.target.checked }))}
              />
              <span>Уведомления в браузере</span>
            </label>
            <label className="inline-actions">
              <input
                type="checkbox"
                checked={formState.telegram_enabled}
                onChange={(event) => setDraftState((current) => ({ ...current, telegram_enabled: event.target.checked }))}
              />
              <span>Telegram</span>
            </label>

            <div className="field">
              <label htmlFor="telegramChatId">Telegram chat ID</label>
              <input
                id="telegramChatId"
                value={formState.telegram_chat_id}
                onChange={(event) => setDraftState((current) => ({ ...current, telegram_chat_id: event.target.value }))}
                placeholder="Например: 123456789"
              />
            </div>

            <div className="field">
              <label htmlFor="cooldown">Интервал между алертами, минут</label>
              <input
                id="cooldown"
                type="number"
                min={1}
                value={formState.alert_cooldown_minutes}
                onChange={(event) =>
                  setDraftState((current) => ({
                    ...current,
                    alert_cooldown_minutes: Number(event.target.value) || 1,
                  }))
                }
              />
            </div>

            <Button
              onClick={() => updateSubscriptionMutation.mutate()}
              disabled={updateSubscriptionMutation.isPending}
              isLoading={updateSubscriptionMutation.isPending}
              loadingLabel="Сохраняем..."
              feedbackState={saveButton.feedbackState}
            >
              Сохранить настройки
            </Button>
          </Card>
        </AnimatedReveal>
      </div>

      <AnimatedReveal delay={430}>
        <Card className="stack-md">
          <div className="toolbar-row">
            <strong>Последние инциденты</strong>
            <span className="muted">Последние 10 событий мониторинга</span>
          </div>

          {alerts.length ? (
            alerts.map((alert) => (
              <div key={alert.id} className="list-item">
                <div>
                  <div className="inline-actions">
                    <StatusBadge tone={alert.severity === "critical" ? "danger" : alert.severity === "warning" ? "warning" : "info"}>
                      {getAlertSeverityLabel(alert.severity)}
                    </StatusBadge>
                    <strong>{alert.message}</strong>
                  </div>
                  <p className="muted">{alert.metric_name || "Канал"} · {formatRelative(alert.start_time)}</p>
                </div>
                <div className="inline-actions">
                  {!alert.is_read ? (
                    <Button size="sm" variant="secondary" onClick={() => markReadMutation.mutate(alert.id)}>
                      Отметить
                    </Button>
                  ) : null}
                  <StatusBadge tone={alert.status === "resolved" ? "success" : "warning"}>
                    {getAlertStatusLabel(alert.status)}
                  </StatusBadge>
                </div>
              </div>
            ))
          ) : (
            <p className="muted">Сейчас система не видит активных или недавних инцидентов.</p>
          )}
        </Card>
      </AnimatedReveal>
    </div>
  );
}

export default MonitoringPage;
