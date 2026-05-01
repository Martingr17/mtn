import { useMemo, useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, Globe2, LogOut, MoonStar, Palette } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { authService } from "@/services/endpoints/auth";
import { notificationsService } from "@/services/endpoints/notifications";
import { useAppStore } from "@/store/app-store";
import type { AppState } from "@/store/app-store";
import { useAuthStore } from "@/store/auth-store";
import type { AuthState } from "@/store/auth-store";
import type { NotificationEventType, NotificationSettings, ThemeMode } from "@/types/domain";
import { getThemeToastMessage, THEME_OPTIONS } from "@/utils/theme";

type NotificationFormState = Omit<
  NotificationSettings,
  "telegram_chat_id" | "quiet_hours_start" | "quiet_hours_end"
> & {
  telegram_chat_id: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
};

const DEFAULT_NOTIFICATION_FORM: NotificationFormState = {
  monitoring_enabled: true,
  site_enabled: true,
  email_enabled: true,
  telegram_enabled: false,
  browser_push_enabled: true,
  telegram_chat_id: "",
  enabled_event_types: [],
  quiet_hours_start: "",
  quiet_hours_end: "",
  alert_cooldown_minutes: 30,
};

function SettingsPage() {
  const navigate = useNavigate();
  const theme = useAppStore((state: AppState) => state.theme);
  const setTheme = useAppStore((state: AppState) => state.setTheme);
  const language = useAppStore((state: AppState) => state.language);
  const setLanguage = useAppStore((state: AppState) => state.setLanguage);
  const clearSession = useAuthStore((state: AuthState) => state.clearSession);

  const settingsQuery = useQuery({
    queryKey: ["settings-page", "notifications"],
    queryFn: notificationsService.settings,
  });
  const eventTypesQuery = useQuery({
    queryKey: ["settings-page", "event-types"],
    queryFn: notificationsService.eventTypes,
  });

  const [notificationDraft, setNotificationDraft] = useState<Partial<NotificationFormState>>({});
  const notificationDefaults = useMemo<NotificationFormState>(() => {
    if (!settingsQuery.data) {
      return DEFAULT_NOTIFICATION_FORM;
    }

    return {
      monitoring_enabled: settingsQuery.data.monitoring_enabled,
      site_enabled: settingsQuery.data.site_enabled,
      email_enabled: settingsQuery.data.email_enabled,
      telegram_enabled: settingsQuery.data.telegram_enabled,
      browser_push_enabled: settingsQuery.data.browser_push_enabled,
      telegram_chat_id: settingsQuery.data.telegram_chat_id ?? "",
      enabled_event_types: settingsQuery.data.enabled_event_types ?? [],
      quiet_hours_start: settingsQuery.data.quiet_hours_start ?? "",
      quiet_hours_end: settingsQuery.data.quiet_hours_end ?? "",
      alert_cooldown_minutes: settingsQuery.data.alert_cooldown_minutes ?? 30,
    };
  }, [settingsQuery.data]);
  const notificationForm = useMemo(
    () => ({ ...notificationDefaults, ...notificationDraft }),
    [notificationDefaults, notificationDraft],
  );

  const updateNotificationsMutation = useMutation({
    mutationFn: () =>
      notificationsService.updateSettings({
        ...notificationForm,
        telegram_chat_id: notificationForm.telegram_chat_id || undefined,
        quiet_hours_start: notificationForm.quiet_hours_start || undefined,
        quiet_hours_end: notificationForm.quiet_hours_end || undefined,
      }),
    onSuccess: () => {
      toast.success("Настройки уведомлений сохранены.");
      queryClient.invalidateQueries({ queryKey: ["settings-page", "notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-page", "list"] });
    },
    onError: () => toast.error("Не удалось обновить настройки уведомлений."),
  });

  const logoutMutation = useMutation({
    mutationFn: authService.logout,
    onSettled: () => {
      clearSession();
      queryClient.clear();
      navigate("/login", { replace: true });
      toast.success("Вы вышли из аккаунта.");
    },
  });

  const enabledEventTypes = useMemo(
    () => new Set(notificationForm.enabled_event_types),
    [notificationForm.enabled_event_types],
  );

  const handleThemeSelect = (nextTheme: ThemeMode) => {
    if (nextTheme === theme) {
      return;
    }

    setTheme(nextTheme);
    toast.success(getThemeToastMessage(nextTheme));
  };

  return (
    <div className="stack-lg">
      <Card className="hero-card">
        <SectionHeading
          eyebrow="Настройки"
          title="Настройки аккаунта и уведомлений"
          description="Управляйте темой, языком и каналами уведомлений в одном разделе."
        />
      </Card>

      <div className="cards-grid">
        <Card className="span-4 stack-md">
          <div className="inline-actions">
            <Palette size={18} />
            <strong>Интерфейс</strong>
          </div>

          <div className="field">
            <label htmlFor="theme">Тема</label>
            <select
              id="theme"
              value={theme}
              onChange={(event) => handleThemeSelect(event.target.value as ThemeMode)}
            >
              {THEME_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="language">Язык</label>
            <select id="language" value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="ru">Русский</option>
              <option value="en">English</option>
            </select>
          </div>

          <div className="inline-actions">
            <MoonStar size={16} />
            <span className="muted">Выбор темы сохраняется локально и применяется без перезагрузки.</span>
          </div>
        </Card>

        <Card className="span-8 stack-md">
          <div className="toolbar-row">
            <div className="inline-actions">
              <Bell size={18} />
              <strong>Уведомления</strong>
            </div>
            <Button
              onClick={() => updateNotificationsMutation.mutate()}
              disabled={updateNotificationsMutation.isPending}
            >
              {updateNotificationsMutation.isPending ? "Сохраняем..." : "Сохранить"}
            </Button>
          </div>

          <div className="form-grid">
            <label className="inline-actions">
              <input
                type="checkbox"
                checked={notificationForm.site_enabled}
                onChange={(event) =>
                  setNotificationDraft((current) => ({ ...current, site_enabled: event.target.checked }))
                }
              />
              <span>Уведомления внутри приложения</span>
            </label>
            <label className="inline-actions">
              <input
                type="checkbox"
                checked={notificationForm.email_enabled}
                onChange={(event) =>
                  setNotificationDraft((current) => ({ ...current, email_enabled: event.target.checked }))
                }
              />
              <span>Email-уведомления</span>
            </label>
            <label className="inline-actions">
              <input
                type="checkbox"
                checked={notificationForm.browser_push_enabled}
                onChange={(event) =>
                  setNotificationDraft((current) => ({
                    ...current,
                    browser_push_enabled: event.target.checked,
                  }))
                }
              />
              <span>Push-уведомления в браузере</span>
            </label>
            <label className="inline-actions">
              <input
                type="checkbox"
                checked={notificationForm.monitoring_enabled}
                onChange={(event) =>
                  setNotificationDraft((current) => ({
                    ...current,
                    monitoring_enabled: event.target.checked,
                  }))
                }
              />
              <span>Алерты мониторинга</span>
            </label>
            <label className="inline-actions">
              <input
                type="checkbox"
                checked={notificationForm.telegram_enabled}
                onChange={(event) =>
                  setNotificationDraft((current) => ({ ...current, telegram_enabled: event.target.checked }))
                }
              />
              <span>Уведомления в Telegram</span>
            </label>
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="chatId">ID чата Telegram</label>
              <input
                id="chatId"
                value={notificationForm.telegram_chat_id}
                onChange={(event) =>
                  setNotificationDraft((current) => ({ ...current, telegram_chat_id: event.target.value }))
                }
              />
            </div>
            <div className="field">
              <label htmlFor="cooldown">Интервал алертов, минут</label>
              <input
                id="cooldown"
                type="number"
                min={1}
                value={notificationForm.alert_cooldown_minutes}
                onChange={(event) =>
                  setNotificationDraft((current) => ({
                    ...current,
                    alert_cooldown_minutes: Number(event.target.value) || 1,
                  }))
                }
              />
            </div>
            <div className="field">
              <label htmlFor="quietStart">Тихие часы: начало</label>
              <input
                id="quietStart"
                type="time"
                value={notificationForm.quiet_hours_start}
                onChange={(event) =>
                  setNotificationDraft((current) => ({
                    ...current,
                    quiet_hours_start: event.target.value,
                  }))
                }
              />
            </div>
            <div className="field">
              <label htmlFor="quietEnd">Тихие часы: конец</label>
              <input
                id="quietEnd"
                type="time"
                value={notificationForm.quiet_hours_end}
                onChange={(event) =>
                  setNotificationDraft((current) => ({
                    ...current,
                    quiet_hours_end: event.target.value,
                  }))
                }
              />
            </div>
          </div>
        </Card>
      </div>

      <Card className="stack-md">
        <div className="inline-actions">
          <Globe2 size={18} />
          <strong>Типы событий</strong>
        </div>
        <div className="cards-grid">
          {(eventTypesQuery.data ?? []).map((eventType, index) => {
            const eventTypeKey =
              eventType.key ||
              (eventType as NotificationEventType & { code?: string }).code ||
              `event-type-${index}`;

            return (
            <Card key={eventTypeKey} className="span-4 stack-sm">
              <div className="toolbar-row">
                <strong>{eventType.label}</strong>
                <input
                  type="checkbox"
                  checked={enabledEventTypes.has(eventTypeKey)}
                  onChange={(event) =>
                    setNotificationDraft((current) => {
                      const enabledItems =
                        current.enabled_event_types ?? notificationForm.enabled_event_types;
                      return {
                        ...current,
                        enabled_event_types: event.target.checked
                          ? [...new Set([...enabledItems, eventTypeKey])]
                          : enabledItems.filter((item) => item !== eventTypeKey),
                      };
                    })
                  }
                />
              </div>
              <p className="muted">{eventType.description}</p>
            </Card>
            );
          })}
        </div>
      </Card>

      <Card className="stack-md">
        <div className="toolbar-row">
          <strong>Сессия</strong>
          <Button
            variant="danger"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
          >
            <LogOut size={16} />
            Выйти
          </Button>
        </div>
        <p className="muted">
          Выход очищает локальные токены и состояние пользователя, после чего приложение возвращает вас на экран авторизации.
        </p>
      </Card>
    </div>
  );
}

export default SettingsPage;
