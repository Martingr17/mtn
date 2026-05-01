import { useMemo, useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Database, Server, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useButtonFeedback } from "@/hooks/use-button-feedback";
import { adminService } from "@/services/endpoints/admin";
import type { AdminSystemSettings } from "@/types/domain";
import { formatDate, formatNumber } from "@/utils/format";

const DEFAULT_SYSTEM_SETTINGS: AdminSystemSettings = {
  maintenance_mode: false,
  registration_enabled: true,
  payment_enabled: true,
  ticket_system_enabled: true,
  min_payment_amount: 10,
  max_payment_amount: 100000,
  ticket_auto_close_days: 7,
  maintenance_message: "",
};

function formatLogTitle(log: Record<string, unknown>) {
  return String(log.message ?? log.event ?? "Системное событие");
}

function formatLogMeta(log: Record<string, unknown>) {
  const level = String(log.level ?? "info");
  const component = String(log.component ?? "core");
  const levelLabel =
    level === "error" ? "Ошибка" : level === "warning" ? "Предупреждение" : "Информация";
  const componentLabel = component === "core" ? "Система" : component;
  return `${levelLabel} · ${componentLabel}`;
}

function AdminSettingsPage() {
  const systemInfoQuery = useQuery({
    queryKey: ["admin-settings", "system-info"],
    queryFn: adminService.systemInfo,
  });
  const systemSettingsQuery = useQuery({
    queryKey: ["admin-settings", "system-settings"],
    queryFn: adminService.systemSettings,
  });
  const logsQuery = useQuery({
    queryKey: ["admin-settings", "logs"],
    queryFn: () => adminService.logs(1, 15, "all"),
  });

  const [draftState, setDraftState] = useState<Partial<AdminSystemSettings>>({});
  const updateFeedback = useButtonFeedback();
  const maintenanceFeedback = useButtonFeedback();
  const cacheFeedback = useButtonFeedback();

  const baseSettings = useMemo(() => {
    const rawSettings = (systemSettingsQuery.data ?? {}) as Partial<AdminSystemSettings> & {
      auto_close_ticket_days?: number;
    };

    return {
      ...DEFAULT_SYSTEM_SETTINGS,
      ...rawSettings,
      ticket_auto_close_days:
        rawSettings.ticket_auto_close_days ??
        rawSettings.auto_close_ticket_days ??
        DEFAULT_SYSTEM_SETTINGS.ticket_auto_close_days,
    };
  }, [systemSettingsQuery.data]);

  const formState = useMemo(() => ({ ...baseSettings, ...draftState }), [baseSettings, draftState]);
  const limitsInvalid = formState.min_payment_amount > formState.max_payment_amount;

  const updateMutation = useMutation({
    mutationFn: () => adminService.updateSystemSettings(formState),
    onSuccess: () => {
      updateFeedback.flashFeedback("success");
      toast.success("Системные настройки обновлены.");
      queryClient.invalidateQueries({ queryKey: ["admin-settings", "system-settings"] });
      queryClient.invalidateQueries({ queryKey: ["admin-settings", "system-info"] });
    },
    onError: () => {
      updateFeedback.flashFeedback("error");
      toast.error("Не удалось обновить системные настройки.");
    },
  });

  const maintenanceMutation = useMutation({
    mutationFn: (enabled: boolean) => adminService.maintenance(enabled),
    onSuccess: (_data, enabled) => {
      maintenanceFeedback.flashFeedback("success");
      toast.success(enabled ? "Режим обслуживания включён." : "Режим обслуживания выключен.");
      setDraftState((current) => ({ ...current, maintenance_mode: enabled }));
      queryClient.invalidateQueries({ queryKey: ["admin-settings", "system-settings"] });
      queryClient.invalidateQueries({ queryKey: ["admin-settings", "system-info"] });
    },
    onError: () => {
      maintenanceFeedback.flashFeedback("error");
      toast.error("Не удалось изменить режим обслуживания.");
    },
  });

  const cacheMutation = useMutation({
    mutationFn: adminService.clearCache,
    onSuccess: () => {
      cacheFeedback.flashFeedback("success");
      toast.success("Кэш очищен.");
      queryClient.invalidateQueries({ queryKey: ["admin-settings", "system-info"] });
      queryClient.invalidateQueries({ queryKey: ["admin-settings", "logs"] });
    },
    onError: () => {
      cacheFeedback.flashFeedback("error");
      toast.error("Не удалось очистить кэш.");
    },
  });

  const logs = logsQuery.data?.items ?? [];

  return (
    <div className="stack-lg admin-settings-page">
      <AnimatedReveal>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Админ-панель / Настройки"
            title="Системная конфигурация MTN"
            description="Операционные настройки, сервисные переключатели и журнал последних событий собраны в одном административном разделе."
          />
        </Card>
      </AnimatedReveal>

      <AnimatedReveal delay={0.05}>
        <div className="cards-grid">
          <Card className="span-4 stack-md">
            <div className="inline-actions">
              <Server size={18} />
              <strong>Состояние системы</strong>
            </div>
            <div className="summary-row">
              <span>Версия</span>
              <strong>{systemInfoQuery.data?.app_version ?? systemInfoQuery.data?.version ?? "н/д"}</strong>
            </div>
            <div className="summary-row">
              <span>Среда</span>
              <strong>{systemInfoQuery.data?.environment ?? "н/д"}</strong>
            </div>
            <div className="summary-row">
              <span>CPU</span>
              <strong>{formatNumber(systemInfoQuery.data?.cpu_percent ?? 0)}%</strong>
            </div>
            <div className="summary-row">
              <span>Память</span>
              <strong>{formatNumber(systemInfoQuery.data?.memory_percent ?? 0)}%</strong>
            </div>
            <div className="summary-row">
              <span>Соединения с БД</span>
              <strong>{formatNumber(systemInfoQuery.data?.db_connections ?? 0)}</strong>
            </div>
            <Button
              variant="secondary"
              onClick={() => cacheMutation.mutate()}
              isLoading={cacheMutation.isPending}
              loadingLabel="Очищаем..."
              feedbackState={cacheFeedback.feedbackState}
            >
              <Database size={16} />
              Очистить кэш
            </Button>
          </Card>

          <Card className="span-8 stack-md">
            <div className="toolbar-row">
              <div className="inline-actions">
                <Settings2 size={18} />
                <strong>Системные параметры</strong>
              </div>
              <StatusBadge tone={formState.maintenance_mode ? "warning" : "success"}>
                {formState.maintenance_mode ? "Обслуживание" : "Онлайн"}
              </StatusBadge>
            </div>

            <div className="form-grid">
              <label className="inline-actions">
                <input
                  type="checkbox"
                  checked={formState.registration_enabled}
                  onChange={(event) =>
                    setDraftState((current) => ({ ...current, registration_enabled: event.target.checked }))
                  }
                />
                <span>Регистрация разрешена</span>
              </label>
              <label className="inline-actions">
                <input
                  type="checkbox"
                  checked={formState.payment_enabled}
                  onChange={(event) =>
                    setDraftState((current) => ({ ...current, payment_enabled: event.target.checked }))
                  }
                />
                <span>Платежи активны</span>
              </label>
              <label className="inline-actions">
                <input
                  type="checkbox"
                  checked={formState.ticket_system_enabled}
                  onChange={(event) =>
                    setDraftState((current) => ({
                      ...current,
                      ticket_system_enabled: event.target.checked,
                    }))
                  }
                />
                <span>Тикет-система активна</span>
              </label>
            </div>

            <div className="form-grid">
              <div className="field">
                <label htmlFor="settings-min-payment">Минимальный платёж</label>
                <input
                  id="settings-min-payment"
                  type="number"
                  aria-invalid={limitsInvalid}
                  value={formState.min_payment_amount}
                  onChange={(event) =>
                    setDraftState((current) => ({
                      ...current,
                      min_payment_amount: Number(event.target.value) || 0,
                    }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="settings-max-payment">Максимальный платёж</label>
                <input
                  id="settings-max-payment"
                  type="number"
                  aria-invalid={limitsInvalid}
                  value={formState.max_payment_amount}
                  onChange={(event) =>
                    setDraftState((current) => ({
                      ...current,
                      max_payment_amount: Number(event.target.value) || 0,
                    }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="settings-auto-close">Автозакрытие тикета, дней</label>
                <input
                  id="settings-auto-close"
                  type="number"
                  value={formState.ticket_auto_close_days}
                  onChange={(event) =>
                    setDraftState((current) => ({
                      ...current,
                      ticket_auto_close_days: Number(event.target.value) || 0,
                    }))
                  }
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="settings-maintenance-message">Сообщение режима обслуживания</label>
              <textarea
                id="settings-maintenance-message"
                value={formState.maintenance_message}
                onChange={(event) =>
                  setDraftState((current) => ({ ...current, maintenance_message: event.target.value }))
                }
              />
            </div>

            <div className="inline-actions">
              <Button
                onClick={() => updateMutation.mutate()}
                disabled={limitsInvalid}
                isLoading={updateMutation.isPending}
                loadingLabel="Сохраняем..."
                feedbackState={updateFeedback.feedbackState}
              >
                Сохранить настройки
              </Button>
              <Button
                variant="secondary"
                onClick={() => maintenanceMutation.mutate(!formState.maintenance_mode)}
                isLoading={maintenanceMutation.isPending}
                loadingLabel="Обновляем..."
                feedbackState={maintenanceFeedback.feedbackState}
              >
                {formState.maintenance_mode ? "Выключить режим обслуживания" : "Включить режим обслуживания"}
              </Button>
            </div>
          </Card>
        </div>
      </AnimatedReveal>

      <AnimatedReveal delay={0.1}>
        <Card className="stack-md">
          <strong>Последние системные события</strong>
          {logs.length ? (
            logs.map((log, index) => (
              <div key={index} className="list-item">
                <div>
                  <strong>{formatLogTitle(log)}</strong>
                  <p className="muted">{formatLogMeta(log)}</p>
                </div>
                <span className="muted">
                  {formatDate(String(log.created_at ?? log.timestamp ?? new Date().toISOString()))}
                </span>
              </div>
            ))
          ) : (
            <p className="muted">Логи пока не загружены.</p>
          )}
        </Card>
      </AnimatedReveal>
    </div>
  );
}

export default AdminSettingsPage;
