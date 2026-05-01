import { useEffect, useMemo, useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Copy, KeyRound, RefreshCw, ShieldAlert } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { authService } from "@/services/endpoints/auth";
import { cn } from "@/utils/cn";

const recoverySchema = z.object({
  phone: z.string().trim().min(5, "Введите телефон"),
  smsCode: z.string().optional(),
  newPassword: z.string().optional(),
});

type RecoveryValues = z.infer<typeof recoverySchema>;

function getErrorMessage(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    error.response &&
    typeof error.response === "object" &&
    "data" in error.response &&
    error.response.data &&
    typeof error.response.data === "object" &&
    "detail" in error.response.data
  ) {
    return String(error.response.data.detail);
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Не удалось восстановить доступ. Попробуйте ещё раз.";
}

function RecoveryPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"request" | "confirm">("request");
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const form = useForm<RecoveryValues>({
    resolver: zodResolver(recoverySchema),
    defaultValues: {
      phone: "",
      smsCode: "",
      newPassword: "",
    },
  });

  const phoneValue = useWatch({ control: form.control, name: "phone" }) ?? "";
  const passwordValue = useWatch({ control: form.control, name: "newPassword" }) ?? "";

  useEffect(() => {
    if (!cooldown) {
      return;
    }

    const timer = window.setTimeout(() => setCooldown((current) => Math.max(current - 1, 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const passwordHint = useMemo(() => {
    if (!passwordValue?.trim()) {
      return "Введите новый пароль, который заменит все старые данные входа.";
    }

    if (passwordValue.length < 8) {
      return "Рекомендуем минимум 8 символов для безопасного пароля.";
    }

    return "После сброса все старые сессии будут отозваны автоматически.";
  }, [passwordValue]);

  const requestMutation = useMutation({
    mutationFn: (phone: string) => authService.resetPassword({ phone }),
    onSuccess: (result) => {
      setPhase("confirm");
      setDemoCode(result.demo_sms_code ?? null);
      setCooldown(result.demo_sms_ttl ? Math.min(result.demo_sms_ttl, 60) : 60);
      toast.success(result.message);
      form.setFocus("smsCode");
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (values: RecoveryValues) =>
      authService.resetPassword({
        phone: values.phone.trim(),
        sms_code: values.smsCode?.trim(),
        new_password: values.newPassword?.trim(),
      }),
    onSuccess: (result) => {
      toast.success(result.message || "Пароль обновлён.");
      navigate("/login", { replace: true });
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  const handleCopyDemoCode = async () => {
    if (!demoCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(demoCode);
      form.setValue("smsCode", demoCode);
      toast.success("Код скопирован и подставлен.");
    } catch {
      form.setValue("smsCode", demoCode);
      toast.success("Код подставлен в форму.");
    }
  };

  const submit = form.handleSubmit((values) => {
    if (phase === "request") {
      requestMutation.mutate(values.phone.trim());
      return;
    }

    if (!values.smsCode?.trim()) {
      form.setError("smsCode", { type: "manual", message: "Введите код из SMS" });
      return;
    }

    if (!values.newPassword?.trim()) {
      form.setError("newPassword", { type: "manual", message: "Введите новый пароль" });
      return;
    }

    confirmMutation.mutate(values);
  });

  return (
    <AuthLayout
      title="Восстановление доступа"
      description="Сбросьте пароль, подтвердите номер и верните доступ к аккаунту MTN в одном защищённом сценарии."
      signalLabel="Безопасное восстановление"
      signalTitle="Новый пароль и отзыв сессий"
      signalDescription="После подтверждения старые сеансы отключаются автоматически, а доступ остаётся только у вас."
    >
      <Card className="auth-form-card stack-lg">
        <div className="auth-form-head">
          <div>
            <p className="section-eyebrow">Восстановление</p>
            <h2 className="auth-form-title">Безопасное восстановление доступа</h2>
            <p className="auth-form-copy">
              Подтверждаем номер, задаём новый пароль и автоматически отзываем старые сессии, чтобы доступ остался только у вас.
            </p>
          </div>
          <div className="auth-head-badge">
            <RefreshCw size={16} />
            <span>Сброс и отзыв сессий</span>
          </div>
        </div>

        <div className="auth-stepper">
          {[
            { id: 1, title: "Проверка номера", description: "Телефон и запрос кода" },
            { id: 2, title: "Новый пароль", description: "SMS и новый секрет" },
            { id: 3, title: "Защита аккаунта", description: "Отзыв старых сессий" },
          ].map((step) => (
            <div
              key={step.id}
              className={cn(
                "auth-step-card",
                (phase === "request" ? 1 : 2) === step.id && "is-active",
                phase === "confirm" && step.id === 1 && "is-complete",
              )}
            >
              <div className="auth-step-index">0{step.id}</div>
              <div>
                <strong>{step.title}</strong>
                <p>{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <form className="stack-md" onSubmit={submit}>
          <div className="field">
            <label htmlFor="phone">Телефон</label>
            <input id="phone" autoComplete="tel" placeholder="+7 (999) 123-45-67" {...form.register("phone")} />
            <span className="muted">{form.formState.errors.phone?.message ?? "Используйте номер, который привязан к вашему аккаунту MTN."}</span>
          </div>

          {phase === "confirm" ? (
            <>
              <Card className="auth-inline-card stack-sm">
                <div className="toolbar-row">
                  <div>
                    <strong>Код подтверждения отправлен</strong>
                    <p className="muted">Проверьте SMS для номера {phoneValue}. После подтверждения старые сессии будут отключены.</p>
                  </div>
                  {demoCode ? (
                    <Button type="button" variant="secondary" size="sm" onClick={handleCopyDemoCode}>
                      <Copy size={14} />
                      Скопировать код
                    </Button>
                  ) : null}
                </div>
                <div className="inline-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={cooldown > 0 || requestMutation.isPending}
                    onClick={() => requestMutation.mutate(phoneValue.trim())}
                  >
                    {requestMutation.isPending ? "Отправляем..." : "Отправить код повторно"}
                  </Button>
                  <span className="muted">
                    {demoCode ? `Демо-код: ${demoCode}` : cooldown > 0 ? `Новый код через ${cooldown} сек.` : "Можно запросить новый код"}
                  </span>
                </div>
              </Card>

              <div className="form-grid">
                <div className="field">
                  <label htmlFor="smsCode">SMS-код</label>
                  <input id="smsCode" inputMode="numeric" autoComplete="one-time-code" placeholder="6 цифр" {...form.register("smsCode")} />
                  <span className="muted">{form.formState.errors.smsCode?.message ?? "Код нужен для подтверждения, что номер всё ещё у вас."}</span>
                </div>
                <div className="field">
                  <label htmlFor="newPassword">Новый пароль</label>
                  <input id="newPassword" type="password" autoComplete="new-password" placeholder="Введите новый пароль" {...form.register("newPassword")} />
                  <span className="muted">{form.formState.errors.newPassword?.message ?? passwordHint}</span>
                </div>
              </div>
            </>
          ) : (
            <Card className="auth-inline-card stack-sm">
              <div className="inline-actions">
                <ShieldAlert size={18} />
                <strong>Что делает сценарий восстановления</strong>
              </div>
              <p className="muted">
                MTN отправит SMS-код на ваш номер, после чего новый пароль заменит старый, а все активные сессии на других устройствах будут аннулированы.
              </p>
            </Card>
          )}

          <div className="inline-actions">
            <Button type="submit" disabled={requestMutation.isPending || confirmMutation.isPending}>
              {requestMutation.isPending || confirmMutation.isPending
                ? "Обрабатываем..."
                : phase === "request"
                  ? "Получить код восстановления"
                  : "Сменить пароль"}
            </Button>
            {phase === "confirm" ? (
              <Button type="button" variant="secondary" onClick={() => setPhase("request")}>
                Изменить номер
              </Button>
            ) : null}
          </div>
        </form>

        <div className="auth-links-grid">
          <Link className="link-line" to="/login">
            Вернуться ко входу
          </Link>
          <Link className="link-line" to="/register">
            Нужен новый аккаунт?
          </Link>
        </div>

        <Card className="auth-inline-card stack-sm">
          <div className="inline-actions">
            <KeyRound size={18} />
            <strong>Результат после сброса</strong>
          </div>
          <p className="muted">
            После успешного завершения вы сразу сможете войти с новым паролем, а старые access и refresh токены станут недействительными.
          </p>
        </Card>
      </Card>
    </AuthLayout>
  );
}

export default RecoveryPage;
