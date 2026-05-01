import { useMemo, useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, CreditCard, Shield, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { queryClient } from "@/app/query-client";
import { AnimatedReveal } from "@/components/ui/AnimatedReveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useButtonFeedback } from "@/hooks/use-button-feedback";
import { usersService } from "@/services/endpoints/users";
import { useAuthStore } from "@/store/auth-store";
import type { AuthState } from "@/store/auth-store";
import { formatCurrency, formatDate, formatRelative } from "@/utils/format";

type ProfileFormState = {
  first_name: string;
  last_name: string;
  middle_name: string;
  email: string;
  language: string;
};

function getRoleLabel(role?: string | null) {
  if (role === "super_admin") {
    return "Суперадминистратор";
  }

  if (role === "admin") {
    return "Администратор";
  }

  if (role === "operator") {
    return "Оператор";
  }

  return "Абонент";
}

function ProfilePage() {
  const setUser = useAuthStore((state: AuthState) => state.setUser);
  const profileSaveButton = useButtonFeedback();
  const profileQuery = useQuery({
    queryKey: ["profile-page", "me"],
    queryFn: usersService.me,
  });
  const sessionsQuery = useQuery({
    queryKey: ["profile-page", "sessions"],
    queryFn: usersService.sessions,
  });

  const [draftState, setDraftState] = useState<Partial<ProfileFormState>>({});
  const profileDefaults = useMemo<ProfileFormState>(
    () => ({
      first_name: profileQuery.data?.first_name ?? "",
      last_name: profileQuery.data?.last_name ?? "",
      middle_name: profileQuery.data?.middle_name ?? "",
      email: profileQuery.data?.email ?? "",
      language: profileQuery.data?.language ?? "ru",
    }),
    [profileQuery.data],
  );
  const formState = useMemo(() => ({ ...profileDefaults, ...draftState }), [draftState, profileDefaults]);

  const updateMutation = useMutation({
    mutationFn: () => usersService.updateProfile(formState),
    onSuccess: async () => {
      const freshProfile = await usersService.me();
      setDraftState({});
      setUser(freshProfile);
      queryClient.setQueryData(["profile-page", "me"], freshProfile);
      queryClient.setQueryData(["dashboard", "me"], freshProfile);
      queryClient.setQueryData(["tariffs-page", "me"], freshProfile);
      queryClient.invalidateQueries({ queryKey: ["dashboard", "me"] });
      profileSaveButton.flashFeedback("success");
      toast.success("Профиль обновлён.");
    },
    onError: () => {
      profileSaveButton.flashFeedback("error");
      toast.error("Не удалось сохранить профиль.");
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => usersService.uploadAvatar(file),
    onSuccess: async () => {
      const freshProfile = await usersService.me();
      setUser(freshProfile);
      queryClient.setQueryData(["profile-page", "me"], freshProfile);
      queryClient.setQueryData(["dashboard", "me"], freshProfile);
      toast.success("Аватар обновлён.");
    },
    onError: () => toast.error("Не удалось загрузить аватар."),
  });

  const revokeSessionMutation = useMutation({
    mutationFn: (sessionId: number) => usersService.revokeSession(sessionId),
    onSuccess: () => {
      toast.success("Сессия завершена.");
      queryClient.invalidateQueries({ queryKey: ["profile-page", "sessions"] });
    },
    onError: () => toast.error("Не удалось завершить сессию."),
  });

  const profile = profileQuery.data;
  const sessions = sessionsQuery.data ?? [];

  return (
    <div className="stack-lg profile-page">
      <AnimatedReveal delay={0}>
        <Card className="hero-card">
          <SectionHeading
            eyebrow="Профиль"
            title="Личные данные и безопасность аккаунта"
            description="Редактируйте контактные данные, язык интерфейса, аватар и контролируйте активные сессии в одном разделе."
          />
        </Card>
      </AnimatedReveal>

      <div className="cards-grid">
        <AnimatedReveal className="span-4" delay={70}>
          <Card className="stack-md">
            <div className="stack-sm">
              <div className="brand-mark is-hero">{profile?.first_name?.[0] ?? profile?.phone?.[1] ?? "?"}</div>
              <div>
                <h3 className="title-reset">
                  {[profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || profile?.phone}
                </h3>
                <p className="muted">{profile?.email || "Email не указан"}</p>
              </div>
            </div>

            <div className="summary-row">
              <span>Баланс</span>
              <strong>{formatCurrency(profile?.balance ?? 0)}</strong>
            </div>
            <div className="summary-row">
              <span>Тариф</span>
              <strong>{(profile?.current_tariff as { name?: string } | null)?.name ?? "Не выбран"}</strong>
            </div>
            <div className="summary-row">
              <span>Дата регистрации</span>
              <strong>{formatDate(profile?.created_at, "d MMM yyyy")}</strong>
            </div>
            <div className="summary-row">
              <span>Последний вход</span>
              <strong>{formatRelative(profile?.last_login_at)}</strong>
            </div>

            <label className="ui-button is-secondary upload-button-label">
              <Camera size={16} />
              Загрузить аватар
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    uploadMutation.mutate(file);
                  }
                }}
              />
            </label>
          </Card>
        </AnimatedReveal>

        <AnimatedReveal className="span-8" delay={140}>
          <Card className="stack-md">
            <div className="toolbar-row">
              <strong>Основные данные</strong>
              <StatusBadge tone={profile?.is_verified ? "success" : "warning"}>
                {profile?.is_verified ? "Проверен" : "Нужна проверка"}
              </StatusBadge>
            </div>

            <div className="form-grid">
              <div className="field">
                <label htmlFor="firstName">Имя</label>
                <input
                  id="firstName"
                  value={formState.first_name}
                  onChange={(event) => setDraftState((current) => ({ ...current, first_name: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="lastName">Фамилия</label>
                <input
                  id="lastName"
                  value={formState.last_name}
                  onChange={(event) => setDraftState((current) => ({ ...current, last_name: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="middleName">Отчество</label>
                <input
                  id="middleName"
                  value={formState.middle_name}
                  onChange={(event) => setDraftState((current) => ({ ...current, middle_name: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  value={formState.email}
                  onChange={(event) => setDraftState((current) => ({ ...current, email: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="phone">Телефон</label>
                <input id="phone" value={profile?.phone ?? ""} disabled />
              </div>
              <div className="field">
                <label htmlFor="language">Язык интерфейса</label>
                <select
                  id="language"
                  value={formState.language}
                  onChange={(event) => setDraftState((current) => ({ ...current, language: event.target.value }))}
                >
                  <option value="ru">Русский</option>
                  <option value="en">English</option>
                </select>
              </div>
            </div>

            <Button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
              isLoading={updateMutation.isPending}
              loadingLabel="Сохраняем..."
              feedbackState={profileSaveButton.feedbackState}
            >
              Сохранить профиль
            </Button>
          </Card>
        </AnimatedReveal>
      </div>

      <div className="cards-grid">
        <AnimatedReveal className="span-5" delay={210}>
          <Card className="stack-md">
            <div className="inline-actions">
              <Shield size={18} />
              <strong>Безопасность</strong>
            </div>
            <div className="summary-row">
              <span>2FA</span>
              <StatusBadge tone={profile?.is_2fa_enabled ? "success" : "neutral"}>
                {profile?.is_2fa_enabled ? "Включена" : "Выключена"}
              </StatusBadge>
            </div>
            <div className="summary-row">
              <span>Аккаунт</span>
              <StatusBadge tone={profile?.is_active ? "success" : "danger"}>
                {profile?.is_active ? "Активен" : "Заблокирован"}
              </StatusBadge>
            </div>
            <div className="summary-row">
              <span>Роль</span>
              <strong>{getRoleLabel(profile?.role)}</strong>
            </div>
          </Card>
        </AnimatedReveal>

        <AnimatedReveal className="span-7" delay={280}>
          <Card className="stack-md">
            <div className="toolbar-row">
              <div className="inline-actions">
                <Smartphone size={18} />
                <strong>Активные сессии</strong>
              </div>
              <span className="muted">{sessions.length} устройств</span>
            </div>

            {sessions.length ? (
              sessions.map((session, index) => (
                <div key={String(session.id ?? index)} className="list-item">
                  <div>
                    <strong>{String(session.user_agent ?? session.device_name ?? session.ip_address ?? "Устройство")}</strong>
                    <p className="muted">
                      {String(session.ip_address ?? "IP не определён")} ·{" "}
                      {formatDate(String(session.created_at ?? session.last_seen_at ?? new Date().toISOString()))}
                    </p>
                  </div>
                  <div className="inline-actions">
                    <StatusBadge tone={session.is_current ? "success" : "neutral"}>
                      {session.is_current ? "Текущая" : "Активна"}
                    </StatusBadge>
                    {!session.is_current && typeof session.id === "number" ? (
                      <Button size="sm" variant="secondary" onClick={() => revokeSessionMutation.mutate(session.id as number)}>
                        Завершить
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">Список сессий появится после первого входа с разных устройств.</p>
            )}
          </Card>
        </AnimatedReveal>
      </div>

      <AnimatedReveal delay={340}>
        <Card className="stack-md">
          <div className="inline-actions">
            <CreditCard size={18} />
            <strong>Быстрый обзор аккаунта</strong>
          </div>
          <p className="muted">
            Изменения имени, email и языка интерфейса используются в уведомлениях и во всех основных экранах кабинета.
          </p>
        </Card>
      </AnimatedReveal>
    </div>
  );
}

export default ProfilePage;
