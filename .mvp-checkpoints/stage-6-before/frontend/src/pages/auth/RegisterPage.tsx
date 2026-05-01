import { useEffect, useMemo, useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Copy, Eye, EyeOff, ShieldCheck, UserPlus } from "lucide-react";
import { useForm, useWatch } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { authService } from "@/services/endpoints/auth";
import { cn } from "@/utils/cn";

import { LOGIN_PERSONAS, SUBSCRIBER_REGISTER_DRAFT } from "./auth-personas";

const registerSchema = z.object({
  billingId: z.string().trim().min(4, "Введите лицевой счёт"),
  phone: z.string().trim().min(5, "Введите телефон"),
  email: z.string().trim().min(1, "Введите email").email("Введите корректный email"),
  firstName: z.string().trim().min(2, "Введите имя"),
  lastName: z.string().trim().min(2, "Введите фамилию"),
  emailCode: z.string().optional(),
  password: z
    .string()
    .optional()
    .refine((value) => !value || value.trim().length === 0 || value.trim().length >= 8, {
      message: "Если задаёте пароль, используйте минимум 8 символов",
    }),
});

const registerSteps = [
  { id: 1, title: "Договор и контакты", description: "Лицевой счёт, телефон и данные владельца" },
  { id: 2, title: "Подтверждение email", description: "Код из письма для активации аккаунта" },
  { id: 3, title: "Готово к входу", description: "Аккаунт активирован и можно войти в кабинет" },
];

type RegisterValues = z.infer<typeof registerSchema>;

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

  return "Не удалось продолжить регистрацию. Попробуйте ещё раз.";
}

function RegisterPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"request" | "confirm">("request");
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [verificationTarget, setVerificationTarget] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      billingId: "",
      phone: "",
      email: "",
      firstName: "",
      lastName: "",
      emailCode: "",
      password: "",
    },
  });

  const emailValue = useWatch({ control: form.control, name: "email" }) ?? "";
  const billingIdValue = useWatch({ control: form.control, name: "billingId" }) ?? "";
  const firstNameValue = useWatch({ control: form.control, name: "firstName" }) ?? "";
  const lastNameValue = useWatch({ control: form.control, name: "lastName" }) ?? "";
  const passwordValue = useWatch({ control: form.control, name: "password" }) ?? "";
  const emailCodeValue = useWatch({ control: form.control, name: "emailCode" }) ?? "";
  const activeStep = phase === "request" ? 1 : emailCodeValue.trim() ? 3 : 2;
  const billingIdField = form.register("billingId");
  const emailField = form.register("email");

  useEffect(() => {
    if (!cooldown) {
      return;
    }

    const timer = window.setTimeout(() => setCooldown((current) => Math.max(current - 1, 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const passwordHint = useMemo(() => {
    if (!passwordValue?.trim()) {
      return "Пароль можно не задавать сразу. Тогда первый вход останется доступен по коду из письма.";
    }

    if (passwordValue.trim().length < 8) {
      return "Добавьте минимум 8 символов для надёжного пароля.";
    }

    return "Пароль задан. После активации аккаунта можно будет входить и по нему, и по коду из письма.";
  }, [passwordValue]);

  const applySubscriberDraft = () => {
    setPhase("request");
    setDemoCode(null);
    setCooldown(0);
    setVerificationTarget(null);
    setShowPassword(false);
    form.reset({
      billingId: SUBSCRIBER_REGISTER_DRAFT.billingId,
      phone: SUBSCRIBER_REGISTER_DRAFT.phone,
      email: SUBSCRIBER_REGISTER_DRAFT.email,
      firstName: SUBSCRIBER_REGISTER_DRAFT.firstName,
      lastName: SUBSCRIBER_REGISTER_DRAFT.lastName,
      emailCode: "",
      password: SUBSCRIBER_REGISTER_DRAFT.password,
    });
    toast.success("Данные абонента подставлены в форму регистрации.");
  };

  const requestMutation = useMutation({
    mutationFn: (values: RegisterValues) =>
      authService.register({
        billing_id: values.billingId.trim().toUpperCase(),
        phone: values.phone.trim(),
        email: values.email.trim().toLowerCase(),
        first_name: values.firstName.trim(),
        last_name: values.lastName.trim(),
      }),
    onSuccess: (result) => {
      setPhase("confirm");
      setDemoCode(result.demo_email_code ?? null);
      setVerificationTarget(result.verification_target ?? form.getValues("email").trim().toLowerCase());
      setCooldown(result.resend_available_in ?? result.demo_email_ttl ?? 60);
      toast.success(result.message);
      form.setFocus("emailCode");
    },
    onError: (error) => {
      toast.error(getErrorMessage(error));
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (values: RegisterValues) =>
      authService.confirmRegister({
        phone: values.phone.trim(),
        email: values.email.trim().toLowerCase(),
        email_code: values.emailCode?.trim() || "",
        password: values.password?.trim() || undefined,
      }),
    onSuccess: (result) => {
      toast.success(result.message || "Регистрация завершена.");
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
      form.setValue("emailCode", demoCode);
      toast.success("Код скопирован и подставлен в поле.");
    } catch {
      form.setValue("emailCode", demoCode);
      toast.success("Код подставлен в поле.");
    }
  };

  const submit = form.handleSubmit((values) => {
    if (phase === "request") {
      requestMutation.mutate(values);
      return;
    }

    if (!values.emailCode?.trim()) {
      form.setError("emailCode", { type: "manual", message: "Введите код из письма" });
      return;
    }

    if (values.password?.trim() && values.password.trim().length < 8) {
      form.setError("password", { type: "manual", message: "Если задаёте пароль, используйте минимум 8 символов" });
      return;
    }

    confirmMutation.mutate(values);
  });

  const registerSummary = useMemo(
    () => [
      {
        label: "Лицевой счёт",
        value: billingIdValue || "Введите номер договора",
      },
      {
        label: "Email",
        value: emailValue || "Введите email для подтверждения",
      },
      {
        label: "Получатель",
        value: [firstNameValue, lastNameValue].filter(Boolean).join(" ") || "Заполните данные владельца",
      },
    ],
    [billingIdValue, emailValue, firstNameValue, lastNameValue],
  );

  return (
    <AuthLayout
      title="Регистрация MTN ID"
      description="Создайте личный кабинет абонента, подтвердите email и подготовьте аккаунт к первому входу."
      signalLabel="Новый аккаунт"
      signalTitle="Подключение без лишних шагов"
      signalDescription="Договор, контакты и подтверждение email собраны в одном понятном сценарии."
    >
      <Card className="auth-form-card stack-lg">
        <div className="auth-form-head">
          <div>
            <p className="section-eyebrow">Регистрация</p>
            <h2 className="auth-form-title">Регистрация, которая не выглядит как сырой технический экран</h2>
            <p className="auth-form-copy">
              Быстрое заполнение для нового абонента, понятный сценарий подтверждения по email и аккуратные переходы к
              входу для операторов и администраторов.
            </p>
          </div>
          <div className="auth-head-badge">
            <UserPlus size={16} />
            <span>Понятный onboarding</span>
          </div>
        </div>

        <Card className="auth-inline-card stack-sm">
          <div className="toolbar-row">
            <div>
              <strong>Быстрые сценарии</strong>
              <p className="muted">Подставьте демо-данные абонента или сразу перейдите ко входу нужной роли.</p>
            </div>
          </div>
          <div className="auth-preset-grid">
            <button type="button" className="auth-preset-card is-selected" onClick={applySubscriberDraft}>
              <div className="auth-preset-top">
                <span className="auth-preset-badge">Абонент</span>
                <span className="muted">Заполнение формы</span>
              </div>
              <strong>Подставить данные для новой заявки</strong>
              <p>Заполняет лицевой счёт, контакты и пароль, чтобы сразу проверить весь сценарий регистрации.</p>
              <div className="auth-preset-meta">
                <span>{SUBSCRIBER_REGISTER_DRAFT.billingId}</span>
                <span>{SUBSCRIBER_REGISTER_DRAFT.phone}</span>
              </div>
            </button>

            {LOGIN_PERSONAS.filter((persona) => persona.id !== "subscriber").map((persona) => (
              <Link key={persona.id} className="auth-preset-card" to={`/login?preset=${persona.id}`}>
                <div className="auth-preset-top">
                  <span className="auth-preset-badge">{persona.badge}</span>
                  <span className="muted">Перейти ко входу</span>
                </div>
                <strong>{persona.title}</strong>
                <p>{persona.description}</p>
                <div className="auth-preset-meta">
                  <span>{persona.email}</span>
                  <span>{persona.password}</span>
                </div>
              </Link>
            ))}
          </div>
        </Card>

        <div className="auth-stepper">
          {registerSteps.map((step) => (
            <div
              key={step.id}
              className={cn("auth-step-card", activeStep === step.id && "is-active", activeStep > step.id && "is-complete")}
            >
              <div className="auth-step-index">0{step.id}</div>
              <div>
                <strong>{step.title}</strong>
                <p>{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="auth-summary-grid">
          {registerSummary.map((item) => (
            <div key={item.label} className="auth-summary-item">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>

        <form className="stack-md" onSubmit={submit}>
          {phase === "request" ? (
            <>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="billingId">Лицевой счёт</label>
                  <input
                    id="billingId"
                    placeholder="Например, DEMO91021"
                    {...billingIdField}
                    onBlur={(event) => {
                      billingIdField.onBlur(event);
                      const normalized = event.target.value.trim().toUpperCase();
                      form.setValue("billingId", normalized, { shouldValidate: true });
                    }}
                  />
                  <span className="muted">
                    {form.formState.errors.billingId?.message ??
                      "Счёт проверяется в биллинге MTN перед созданием аккаунта."}
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="phone">Телефон</label>
                  <input id="phone" placeholder="+7 (999) 123-45-67" autoComplete="tel" {...form.register("phone")} />
                  <span className="muted">
                    {form.formState.errors.phone?.message ?? "Телефон сохранится в профиле и понадобится для уведомлений и входа по SMS."}
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    placeholder="you@mtn.ru"
                    autoComplete="email"
                    {...emailField}
                    onBlur={(event) => {
                      emailField.onBlur(event);
                      form.setValue("email", event.target.value.trim().toLowerCase(), { shouldValidate: true });
                    }}
                  />
                  <span className="muted">
                    {form.formState.errors.email?.message ?? "На этот email мы отправим код подтверждения и сервисные письма."}
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="firstName">Имя</label>
                  <input id="firstName" placeholder="Алина" autoComplete="given-name" {...form.register("firstName")} />
                  <span className="muted">{form.formState.errors.firstName?.message}</span>
                </div>
                <div className="field">
                  <label htmlFor="lastName">Фамилия</label>
                  <input id="lastName" placeholder="Соколова" autoComplete="family-name" {...form.register("lastName")} />
                  <span className="muted">{form.formState.errors.lastName?.message}</span>
                </div>
              </div>

              <Card className="auth-inline-card stack-sm">
                <div className="inline-actions">
                  <CheckCircle2 size={18} />
                  <strong>Что произойдёт дальше</strong>
                </div>
                <p className="muted">
                  После проверки договора система отправит письмо с кодом подтверждения. Только после подтверждения
                  аккаунт станет активным и готовым ко входу.
                </p>
              </Card>
            </>
          ) : (
            <>
              <Card className="auth-inline-card stack-sm">
                <div className="toolbar-row">
                  <div>
                    <strong>Подтвердите регистрацию</strong>
                    <p className="muted">
                      Код отправлен на {verificationTarget ?? emailValue}. После подтверждения аккаунт станет активным и откроет доступ в
                      личный кабинет.
                    </p>
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
                    onClick={() => requestMutation.mutate(form.getValues())}
                  >
                    {requestMutation.isPending ? "Отправляем..." : "Отправить письмо повторно"}
                  </Button>
                  <span className="muted">
                    {demoCode ? `Демо-код: ${demoCode}` : cooldown > 0 ? `Новое письмо можно запросить через ${cooldown} сек.` : "Можно запросить новое письмо"}
                  </span>
                </div>
              </Card>

              <div className="form-grid">
                <div className="field">
                  <label htmlFor="emailCode">Код из письма</label>
                  <input
                    id="emailCode"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6 цифр"
                    {...form.register("emailCode")}
                  />
                  <span className="muted">
                    {form.formState.errors.emailCode?.message ?? "Введите код, который пришёл на ваш email."}
                  </span>
                </div>
                <div className="field">
                  <label htmlFor="password">Пароль</label>
                  <div className="input-with-action">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Необязательно"
                      {...form.register("password")}
                    />
                    <button
                      type="button"
                      className="input-action"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <span className="muted">{form.formState.errors.password?.message ?? passwordHint}</span>
                </div>
              </div>

              <Card className="auth-inline-card stack-sm">
                <div className="inline-actions">
                  <ShieldCheck size={18} />
                  <strong>Итог после активации</strong>
                </div>
                <p className="muted">
                  Сразу после подтверждения можно будет войти по коду, а если пароль задан уже сейчас — ещё и по паролю
                  без повторной настройки профиля.
                </p>
              </Card>
            </>
          )}

          <div className="inline-actions">
            <Button type="submit" disabled={requestMutation.isPending || confirmMutation.isPending}>
              {requestMutation.isPending || confirmMutation.isPending
                ? "Обрабатываем..."
                : phase === "request"
                  ? "Проверить счёт и отправить код"
                  : "Завершить регистрацию"}
            </Button>
            {phase === "confirm" ? (
              <Button type="button" variant="secondary" onClick={() => setPhase("request")}>
                Вернуться к данным
              </Button>
            ) : null}
          </div>
        </form>

        <div className="auth-links-grid">
          <Link className="link-line" to="/login">
            Уже есть аккаунт? Войти
          </Link>
          <Link className="link-line" to="/recover">
            Нужно восстановить пароль?
          </Link>
        </div>
      </Card>
    </AuthLayout>
  );
}

export default RegisterPage;
