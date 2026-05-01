import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { authService } from "@/services/endpoints/auth";
import { usersService } from "@/services/endpoints/users";
import type { AuthState } from "@/store/auth-store";
import { useAuthStore } from "@/store/auth-store";
import { cn } from "@/utils/cn";

import {
  getLoginPersonaById,
  LOGIN_PERSONAS,
  type AuthPersonaId,
  type LoginMode,
  type LoginPersonaPreset,
} from "./auth-personas";

const loginSchema = z.object({
  email: z.string().trim().email("Введите корректный email"),
  password: z.string().optional(),
  emailCode: z.string().optional(),
  totpCode: z.string().optional(),
});

const EMAIL_CODE_MAX_LENGTH = 8;
const TOTP_CODE_LENGTH = 6;

type LoginValues = z.infer<typeof loginSchema>;
type AuthMethodFlow = "email_code" | "password";
type AuthMethodId =
  | "subscriber_email_code"
  | "subscriber_password"
  | "operator_password_2fa"
  | "admin_secure_login";
type AuthAnalyticsEvent =
  | "role_selected"
  | "auth_method_selected"
  | "email_requested"
  | "email_resend_clicked"
  | "email_code_submit"
  | "login_success"
  | "login_failed"
  | "password_reset_clicked"
  | "registration_clicked"
  | "abandon_before_submit";
type StatusTone = "neutral" | "success" | "warning" | "error";

interface RoleOption {
  id: AuthPersonaId;
  label: string;
  description: string;
  icon: LucideIcon;
}

interface AuthMethodOption {
  id: AuthMethodId;
  role: AuthPersonaId;
  title: string;
  description: string;
  helper: string;
  flow: AuthMethodFlow;
  submitLabel: string;
  icon: LucideIcon;
}

interface StatusPanelState {
  title: string;
  text: string;
  tone: StatusTone;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    id: "subscriber",
    label: "Абонент",
    description: "Личный кабинет",
    icon: Mail,
  },
  {
    id: "operator",
    label: "Оператор",
    description: "Поддержка и операции",
    icon: ShieldCheck,
  },
  {
    id: "admin",
    label: "Администратор",
    description: "Контроль и настройки",
    icon: KeyRound,
  },
];

const LOGIN_BRAND_HIGHLIGHTS = [
  {
    title: "Надёжная защита",
    description: "Коды и 2FA включаются только там, где это нужно.",
    icon: ShieldCheck,
  },
  {
    title: "Один контур доступа",
    description: "Абонент, оператор и администратор входят в одном окне.",
    icon: UsersRound,
  },
];

const AUTH_METHODS: Record<AuthMethodId, AuthMethodOption> = {
  subscriber_email_code: {
    id: "subscriber_email_code",
    role: "subscriber",
    title: "Код из письма",
    description: "Код на email",
    helper: "Введите email и получите код.",
    flow: "email_code",
    submitLabel: "Получить код",
    icon: Mail,
  },
  subscriber_password: {
    id: "subscriber_password",
    role: "subscriber",
    title: "Пароль",
    description: "Email и пароль",
    helper: "Введите email и пароль от кабинета.",
    flow: "password",
    submitLabel: "Войти",
    icon: ShieldCheck,
  },
  operator_password_2fa: {
    id: "operator_password_2fa",
    role: "operator",
    title: "Пароль / 2FA",
    description: "Рабочий доступ",
    helper: "Введите пароль. Если 2FA включена, следующим шагом попросим код из приложения.",
    flow: "password",
    submitLabel: "Продолжить",
    icon: ShieldCheck,
  },
  admin_secure_login: {
    id: "admin_secure_login",
    role: "admin",
    title: "Защищённый вход",
    description: "Пароль и защита",
    helper: "Подтвердите вход паролем. Для аккаунтов с 2FA дополнительно нужен код.",
    flow: "password",
    submitLabel: "Продолжить",
    icon: KeyRound,
  },
};

const METHODS_BY_ROLE: Record<AuthPersonaId, AuthMethodId[]> = {
  subscriber: ["subscriber_email_code", "subscriber_password"],
  operator: ["operator_password_2fa"],
  admin: ["admin_secure_login"],
};

const DEFAULT_METHOD_BY_ROLE: Record<AuthPersonaId, AuthMethodId> = {
  subscriber: "subscriber_email_code",
  operator: "operator_password_2fa",
  admin: "admin_secure_login",
};

function getDefaultMethod(role: AuthPersonaId, mode?: LoginMode): AuthMethodId {
  if (role === "subscriber" && mode === "password") {
    return "subscriber_password";
  }

  return DEFAULT_METHOD_BY_ROLE[role];
}

function resolveNextPath(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return null;
  }

  return next;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeNumericCode(value: string, maxLength: number) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function trackAuthEvent(event: AuthAnalyticsEvent, payload: Record<string, unknown> = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const detail = {
    event,
    ...payload,
    timestamp: new Date().toISOString(),
  };

  window.dispatchEvent(new CustomEvent("mtn:auth-analytics", { detail }));

  const scopedWindow = window as Window & {
    dataLayer?: Array<Record<string, unknown>>;
  };

  scopedWindow.dataLayer?.push(detail);
}

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

  return "Не удалось выполнить вход. Попробуйте ещё раз.";
}

function resolveStatusFromError(message: string): StatusPanelState {
  const normalized = message.toLowerCase();

  if (normalized.includes("истек") || normalized.includes("expired")) {
    return {
      title: "Код больше не действует",
      text: "Запросите новый код из письма и повторите вход.",
      tone: "warning",
    };
  }

  if (normalized.includes("слишком много") || normalized.includes("too many")) {
    return {
      title: "Слишком много попыток",
      text: "Подождите немного и повторите попытку позже.",
      tone: "warning",
    };
  }

  if (normalized.includes("лимит")) {
    return {
      title: "Лимит попыток превышен",
      text: "Для продолжения потребуется новый код или обращение в поддержку.",
      tone: "warning",
    };
  }

  return {
    title: "Не удалось завершить вход",
    text: message,
    tone: "error",
  };
}

function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialPreset = getLoginPersonaById(searchParams.get("preset"));
  const nextPath = resolveNextPath(searchParams.get("next"));
  const initialRole = initialPreset?.id ?? "subscriber";
  const initialMethod = getDefaultMethod(initialRole, initialPreset?.mode);
  const setSession = useAuthStore((state: AuthState) => state.setSession);
  const setUser = useAuthStore((state: AuthState) => state.setUser);
  const [selectedRole, setSelectedRole] = useState<AuthPersonaId>(initialRole);
  const [selectedMethod, setSelectedMethod] = useState<AuthMethodId>(initialMethod);
  const [requestedEmail, setRequestedEmail] = useState<string | null>(null);
  const [verificationTarget, setVerificationTarget] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showTotpCode, setShowTotpCode] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const [statusFeedback, setStatusFeedback] = useState<StatusPanelState | null>(null);
  const [hasInteracted, setHasInteracted] = useState(Boolean(initialPreset));
  const hasInteractedRef = useRef(Boolean(initialPreset));
  const hasSuccessfulAuthRef = useRef(false);
  const latestContextRef = useRef({
    role: initialRole,
    method: initialMethod,
    step: "initial",
  });
  const requestKindRef = useRef<"initial" | "resend">("initial");

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: initialPreset?.email ?? "",
      password: initialPreset?.password ?? "",
      emailCode: "",
      totpCode: "",
    },
  });

  const emailField = form.register("email");
  const passwordField = form.register("password");
  const emailCodeField = form.register("emailCode");
  const totpCodeField = form.register("totpCode");
  const activeMethods = METHODS_BY_ROLE[selectedRole].map((methodId) => AUTH_METHODS[methodId]);
  const activeMethod = AUTH_METHODS[selectedMethod];
  const currentPreset = getLoginPersonaById(selectedRole) ?? LOGIN_PERSONAS[0];
  const isEmailCodeFlow = activeMethod.flow === "email_code";
  const isEmailVerificationStep = isEmailCodeFlow && Boolean(requestedEmail);
  const isTwoFactorStep = Boolean(twoFactorToken);
  const isPasswordStep = activeMethod.flow === "password" && !isTwoFactorStep;
  const currentStepKey = isTwoFactorStep
    ? "two_factor"
    : isEmailVerificationStep
      ? "email_verification"
      : isEmailCodeFlow
        ? "email_request"
        : "credentials";

  useEffect(() => {
    latestContextRef.current = {
      role: selectedRole,
      method: selectedMethod,
      step: currentStepKey,
    };
  }, [currentStepKey, selectedMethod, selectedRole]);

  useEffect(() => {
    hasInteractedRef.current = hasInteracted;
  }, [hasInteracted]);

  useEffect(() => {
    return () => {
      if (!hasInteractedRef.current || hasSuccessfulAuthRef.current) {
        return;
      }

      trackAuthEvent("abandon_before_submit", latestContextRef.current);
    };
  }, []);

  useEffect(() => {
    if (!cooldown) {
      return;
    }

    const timer = window.setTimeout(() => setCooldown((current) => Math.max(current - 1, 0)), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const emailHelpText = useMemo(() => {
    if (isTwoFactorStep) {
      return "Email уже подтверждён.";
    }

    return "";
  }, [isTwoFactorStep]);

  const passwordHelpText = useMemo(() => {
    if (selectedRole === "subscriber") {
      return "Введите пароль от личного кабинета.";
    }

    return "Если для аккаунта включена 2FA, после пароля понадобится код из приложения-аутентификатора.";
  }, [selectedRole]);

  const statusPanel = useMemo<StatusPanelState>(() => {
    if (statusFeedback) {
      return statusFeedback;
    }

    if (isTwoFactorStep) {
      return {
        title: "Подтвердите вход",
        text: "Введите код из приложения-аутентификатора.",
        tone: "warning",
      };
    }

    if (isEmailVerificationStep) {
      const destination = verificationTarget ?? requestedEmail ?? "указанный email";
      return {
        title: "Код отправлен",
        text:
          cooldown > 0
            ? `Проверьте ${destination}. Новый код можно запросить через ${cooldown} сек.`
            : `Проверьте ${destination}. Если письмо не пришло, запросите код повторно.`,
        tone: "success",
      };
    }

    return {
      title: activeMethod.title,
      text: activeMethod.helper,
      tone: "neutral",
    };
  }, [activeMethod.helper, activeMethod.title, cooldown, isEmailVerificationStep, isTwoFactorStep, requestedEmail, statusFeedback, verificationTarget]);

  const submitLabel = useMemo(() => {
    if (isTwoFactorStep) {
      return "Подтвердить вход";
    }

    if (isEmailVerificationStep) {
      return "Войти";
    }

    return activeMethod.submitLabel;
  }, [activeMethod.submitLabel, isEmailVerificationStep, isTwoFactorStep]);

  const shouldShowStatusCard = Boolean(statusFeedback) || isEmailVerificationStep || isTwoFactorStep;
  const secondaryActions = useMemo(() => {
    if (selectedMethod === "subscriber_email_code") {
      return [
        {
          to: "/recover",
          label: isEmailVerificationStep ? "Не приходит письмо?" : "Нет доступа к email?",
          event: "password_reset_clicked" as const,
        },
          {
            to: "/register",
            label: "Создать аккаунт",
            event: "registration_clicked" as const,
          },
        ];
    }

    if (selectedMethod === "subscriber_password") {
      return [
        {
          to: "/recover",
          label: "Забыли пароль?",
          event: "password_reset_clicked" as const,
        },
          {
            to: "/register",
            label: "Создать аккаунт",
            event: "registration_clicked" as const,
          },
        ];
    }

    return [
      {
        to: "/recover",
        label: "Проблемы с 2FA?",
        event: "password_reset_clicked" as const,
      },
      {
        to: "/recover",
        label: "Восстановить доступ",
        event: "password_reset_clicked" as const,
      },
    ];
  }, [isEmailVerificationStep, selectedMethod]);
  const emailNoteText = form.formState.errors.email?.message ?? emailHelpText;

  const resetFlowState = () => {
    setRequestedEmail(null);
    setVerificationTarget(null);
    setCooldown(0);
    setDemoCode(null);
    setTwoFactorToken(null);
    setShowTotpCode(false);
    form.clearErrors();
    form.setValue("emailCode", "");
    form.setValue("totpCode", "");
  };

  const markInteraction = () => {
    setHasInteracted(true);
  };

  const applyPreset = (preset: LoginPersonaPreset, showToast = true) => {
    markInteraction();
    const nextMethod = getDefaultMethod(preset.id, preset.mode);

    setSelectedRole(preset.id);
    setSelectedMethod(nextMethod);
    setStatusFeedback(null);
    resetFlowState();
    setShowPassword(false);

    form.reset({
      email: preset.email,
      password: preset.password ?? "",
      emailCode: "",
      totpCode: "",
    });

    if (showToast) {
      toast.success(`Тестовые данные для роли «${preset.badge}» подставлены.`);
    }

    window.requestAnimationFrame(() => form.setFocus("email"));
  };

  const completeAuth = async (
    result: Awaited<ReturnType<typeof authService.login>>,
    fallbackName: string,
  ) => {
    if (!result.access_token || !result.refresh_token || !result.expires_in) {
      const message = "Сессия не была создана. Повторите попытку входа.";
      setStatusFeedback({
        title: "Не удалось создать сессию",
        text: message,
        tone: "error",
      });
      toast.error(message);
      return;
    }

    hasSuccessfulAuthRef.current = true;
    trackAuthEvent("login_success", {
      role: selectedRole,
      auth_method: selectedMethod,
      target_role: result.role,
    });

    setSession({
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresIn: result.expires_in,
      role: result.role,
    });

    const profile = await usersService.me();
    setUser(profile);
    toast.success(`Добро пожаловать, ${profile.first_name || fallbackName}!`);
    navigate(nextPath ?? (result.role === "user" ? "/dashboard" : "/admin/dashboard"), { replace: true });
  };

  const requestCodeMutation = useMutation({
    mutationFn: (email: string) => authService.login({ email }),
    onSuccess: async (result, email) => {
      if (result.access_token) {
        await completeAuth(result, email);
        return;
      }

      const resendIn = result.resend_available_in ?? result.demo_email_ttl ?? 60;
      const destination = result.verification_target ?? result.demo_email_address ?? email;
      const isResend = requestKindRef.current === "resend";

      if (!isResend) {
        trackAuthEvent("email_requested", {
          role: selectedRole,
          auth_method: selectedMethod,
          email,
        });
      }

      setRequestedEmail(email);
      setVerificationTarget(destination);
      setDemoCode(result.demo_email_code ?? null);
      setCooldown(resendIn);
      setStatusFeedback({
        title: isResend ? "Код отправлен повторно" : "Код отправлен",
        text: `Проверьте ${destination}. Новый код можно запросить через ${resendIn} сек.`,
        tone: "success",
      });
      setLiveMessage(`Код отправлен на ${destination}. Повторная отправка станет доступна через ${resendIn} секунд.`);
      toast.success(result.message ?? "Код отправлен.");
      form.setFocus("emailCode");
    },
    onError: (error) => {
      const message = getErrorMessage(error);
      setStatusFeedback(resolveStatusFromError(message));
      setLiveMessage(message);
      trackAuthEvent("login_failed", {
        role: selectedRole,
        auth_method: selectedMethod,
        step: "email_request",
        reason: message,
      });
      toast.error(message);
    },
  });

  const loginMutation = useMutation({
    mutationFn: async (values: LoginValues) => {
      if (twoFactorToken) {
        return authService.completeTwoFactorLogin(
          twoFactorToken,
          normalizeNumericCode(values.totpCode ?? "", TOTP_CODE_LENGTH),
        );
      }

      return authService.login({
        email: normalizeEmail(values.email),
        password: activeMethod.flow === "password" ? values.password?.trim() : undefined,
        email_code:
          activeMethod.flow === "email_code"
            ? normalizeNumericCode(values.emailCode ?? "", EMAIL_CODE_MAX_LENGTH)
            : undefined,
      });
    },
    onSuccess: async (result, values) => {
      if (result.requires_2fa && result.two_factor_token) {
        setTwoFactorToken(result.two_factor_token);
        form.setValue("totpCode", "");
        setStatusFeedback({
          title: "Нужно подтверждение 2FA",
          text: "Откройте приложение-аутентификатор и введите код.",
          tone: "warning",
        });
        setLiveMessage("Для завершения входа требуется код из приложения-аутентификатора.");
        form.setFocus("totpCode");
        return;
      }

      await completeAuth(result, values.email.trim());
    },
    onError: (error) => {
      const message = getErrorMessage(error);
      setStatusFeedback(resolveStatusFromError(message));
      setLiveMessage(message);
      trackAuthEvent("login_failed", {
        role: selectedRole,
        auth_method: selectedMethod,
        step: currentStepKey,
        reason: message,
      });
      toast.error(message);
    },
  });

  const isAuthBusy = loginMutation.isPending || requestCodeMutation.isPending;

  const handleRoleChange = (role: AuthPersonaId) => {
    if (role === selectedRole || isAuthBusy) {
      return;
    }

    markInteraction();
    trackAuthEvent("role_selected", { role });
    setSelectedRole(role);
    setSelectedMethod(DEFAULT_METHOD_BY_ROLE[role]);
    setStatusFeedback(null);
    resetFlowState();
    setShowPassword(false);
    form.setValue("password", "");
    window.requestAnimationFrame(() => form.setFocus("email"));
  };

  const handleMethodChange = (method: AuthMethodId) => {
    if (method === selectedMethod || isAuthBusy || !METHODS_BY_ROLE[selectedRole].includes(method)) {
      return;
    }

    markInteraction();
    trackAuthEvent("auth_method_selected", { role: selectedRole, method });
    setSelectedMethod(method);
    setStatusFeedback(null);
    resetFlowState();
    setShowPassword(false);

    if (AUTH_METHODS[method].flow === "email_code") {
      form.setValue("password", "");
    }

    window.requestAnimationFrame(() => form.setFocus("email"));
  };

  const triggerEmailRequest = (kind: "initial" | "resend") => {
    if (isAuthBusy) {
      return;
    }

    const email = normalizeEmail(form.getValues("email"));

    if (!email) {
      form.setError("email", {
        type: "manual",
        message: "Введите email",
      });
      form.setFocus("email");
      return;
    }

    markInteraction();
    requestKindRef.current = kind;

    if (kind === "resend") {
      trackAuthEvent("email_resend_clicked", {
        role: selectedRole,
        auth_method: selectedMethod,
        email,
      });
    }

    setStatusFeedback({
      title: kind === "resend" ? "Отправляем код повторно" : "Отправляем код",
      text: "Это займёт несколько секунд.",
      tone: "neutral",
    });
    form.setValue("emailCode", "");

    requestCodeMutation.mutate(email);
  };

  const handleCopyDemoCode = async () => {
    if (!demoCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(demoCode);
      form.setValue("emailCode", demoCode, { shouldValidate: true });
      toast.success("Код подставлен в форму.");
    } catch {
      form.setValue("emailCode", demoCode, { shouldValidate: true });
      toast.success("Код подставлен в форму.");
    }
  };

  const handleChangeEmail = () => {
    resetFlowState();
    setStatusFeedback({
      title: "Введите другой email",
      text: "Проверьте адрес и запросите новый код.",
      tone: "neutral",
    });
    window.requestAnimationFrame(() => form.setFocus("email"));
  };

  const handleSubmitValues = (values: LoginValues) => {
    if (isAuthBusy) {
      return;
    }

    markInteraction();

    if (isTwoFactorStep) {
      const normalizedTotpCode = normalizeNumericCode(values.totpCode ?? "", TOTP_CODE_LENGTH);
      if (normalizedTotpCode.length !== TOTP_CODE_LENGTH) {
        form.setError("totpCode", {
          type: "manual",
          message: "Введите 6 цифр из приложения",
        });
        form.setFocus("totpCode");
        return;
      }

      loginMutation.mutate(values);
      return;
    }

    if (activeMethod.flow === "password") {
      if (!values.password?.trim()) {
        form.setError("password", {
          type: "manual",
          message: "Введите пароль",
        });
        form.setFocus("password");
        return;
      }

      loginMutation.mutate(values);
      return;
    }

    if (!isEmailVerificationStep) {
      triggerEmailRequest("initial");
      return;
    }

    const normalizedEmailCode = normalizeNumericCode(values.emailCode ?? "", EMAIL_CODE_MAX_LENGTH);
    if (normalizedEmailCode.length < 4) {
      form.setError("emailCode", {
        type: "manual",
        message: "Введите код из письма: от 4 до 8 цифр",
      });
      form.setFocus("emailCode");
      return;
    }

    trackAuthEvent("email_code_submit", {
      role: selectedRole,
      auth_method: selectedMethod,
      email: values.email.trim().toLowerCase(),
    });
    loginMutation.mutate(values);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isAuthBusy) {
      return;
    }

    const isValid = await form.trigger();

    if (!isValid) {
      return;
    }

    handleSubmitValues(form.getValues());
  };

  return (
    <AuthLayout
      variant="login"
      title={
        <>
          Единый вход
          <br />
          для абонента
          <br />
          и команды
        </>
      }
      description="Без лишних шагов, с нужным уровнем доступа для каждой роли."
      brandHighlights={LOGIN_BRAND_HIGHLIGHTS}
      hideSignal
    >
      <div className="auth-login-shell auth-login-shell--premium">
        <div className="auth-login-card" aria-label="Форма входа" aria-busy={isAuthBusy}>
          <div className="auth-login-topbar">
            <Link className="auth-link-button auth-link-button--ghost" to="/">
              <ArrowLeft size={14} />
              На главную
            </Link>
            <button
              type="button"
              className="auth-link-button auth-link-button--muted auth-link-button--badge"
              disabled={isAuthBusy}
              aria-label={`Подставить тестовые данные для роли ${currentPreset.badge}`}
              onClick={() => applyPreset(currentPreset)}
            >
              <Sparkles size={14} />
              Тестовые данные
            </button>
          </div>

          <div className="auth-login-heading">
            <h2>Вход в личный кабинет</h2>
            <p>Выберите роль, способ входа и продолжайте в нужном контуре доступа.</p>
          </div>

          <fieldset className="auth-section auth-section--login" disabled={isAuthBusy}>
            <legend className="auth-login-section-head">
              <span className="auth-login-section-kicker">Шаг 1</span>
              <span className="auth-section-title">Кто входит</span>
            </legend>

            <div className="auth-choice-grid auth-choice-grid--login auth-choice-grid--roles">
              {ROLE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isSelected = selectedRole === option.id;

                return (
                  <label
                    key={option.id}
                    className={cn(
                      "auth-choice-card auth-choice-card--role",
                      isSelected && "is-selected",
                    )}
                  >
                    <input
                      type="radio"
                      name="auth-role"
                      className="sr-only"
                      checked={isSelected}
                      disabled={isAuthBusy}
                      onChange={() => handleRoleChange(option.id)}
                    />
                    <span className="auth-choice-icon" aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    <span className="auth-choice-copy">
                      <strong>{option.label}</strong>
                      <span>{option.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="auth-section auth-section--login" disabled={isAuthBusy}>
            <legend className="auth-login-section-head">
              <span className="auth-login-section-kicker">Шаг 2</span>
              <span className="auth-section-title">Способ входа</span>
            </legend>

            <div
              className={cn(
                "auth-choice-grid auth-choice-grid--login auth-choice-grid--method",
                activeMethods.length === 1 && "is-single-column",
              )}
            >
              {activeMethods.map((method) => {
                const Icon = method.icon;
                const isSelected = selectedMethod === method.id;

                return (
                  <label
                    key={method.id}
                    className={cn(
                      "auth-choice-card auth-choice-card--method",
                      isSelected && "is-selected",
                    )}
                  >
                    <input
                      type="radio"
                      name="auth-method"
                      className="sr-only"
                      checked={isSelected}
                      disabled={isAuthBusy}
                      onChange={() => handleMethodChange(method.id)}
                    />
                    <span className="auth-choice-icon" aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    <span className="auth-choice-copy">
                      <strong>{method.title}</strong>
                      <span>{method.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <form
            className="auth-login-form auth-login-form--premium"
            onSubmit={onSubmit}
            aria-busy={isAuthBusy}
            noValidate
          >
            <div className="auth-form-block">
              <div className="auth-login-section-head">
                <span className="auth-login-section-kicker">Шаг 3</span>
                <p className="auth-section-title">Данные для входа</p>
              </div>

              <div className="field">
                <label htmlFor="email">Email</label>
                <div className="auth-input-shell auth-input-shell--icon">
                  <span className="auth-input-leading-icon" aria-hidden="true">
                    <Mail size={18} />
                  </span>
                  <input
                    id="email"
                    className="auth-text-input"
                    type="email"
                    placeholder="name@example.com"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    enterKeyHint="next"
                    readOnly={isEmailVerificationStep || isTwoFactorStep}
                    disabled={isAuthBusy}
                    aria-invalid={Boolean(form.formState.errors.email?.message)}
                    aria-describedby={emailNoteText ? "login-email-note" : undefined}
                    {...emailField}
                    onChange={(event) => {
                      markInteraction();
                      emailField.onChange(event);

                      const nextValue = normalizeEmail(event.target.value);
                      if (requestedEmail && nextValue !== normalizeEmail(requestedEmail)) {
                        setRequestedEmail(null);
                        setVerificationTarget(null);
                        setCooldown(0);
                        setDemoCode(null);
                        form.setValue("emailCode", "");
                        setStatusFeedback(null);
                      }
                    }}
                  />
                </div>
                {emailNoteText ? (
                  <span
                    id="login-email-note"
                    className={cn("auth-field-note", !form.formState.errors.email?.message && "is-muted")}
                  >
                    {emailNoteText}
                  </span>
                ) : null}
              </div>

              {shouldShowStatusCard ? (
                <div
                  className={cn("auth-status-card auth-status-card--login", `is-${statusPanel.tone}`)}
                  role={statusPanel.tone === "error" ? "alert" : "status"}
                  aria-live="polite"
                >
                  <div className="auth-status-card-copy">
                    <strong>{statusPanel.title}</strong>
                    <p>{statusPanel.text}</p>
                  </div>

                  {isEmailVerificationStep && demoCode ? (
                    <button
                      type="button"
                      className="auth-link-button auth-link-button--muted"
                      onClick={handleCopyDemoCode}
                    >
                      <Copy size={14} />
                      Подставить демо-код
                    </button>
                  ) : null}
                </div>
              ) : null}

              {isPasswordStep ? (
                <div className="field">
                  <label htmlFor="password">Пароль</label>
                  <div className="input-with-action auth-input-shell auth-input-shell--icon auth-input-shell--action">
                    <span className="auth-input-leading-icon" aria-hidden="true">
                      <KeyRound size={18} />
                    </span>
                    <input
                      id="password"
                      className="auth-text-input"
                      type={showPassword ? "text" : "password"}
                      placeholder="Введите пароль"
                      autoComplete="current-password"
                      enterKeyHint="done"
                      disabled={isAuthBusy}
                      aria-invalid={Boolean(form.formState.errors.password?.message)}
                      aria-describedby="login-password-note"
                      {...passwordField}
                      onChange={(event) => {
                        markInteraction();
                        passwordField.onChange(event);
                      }}
                    />
                    <button
                      type="button"
                      className="input-action"
                      disabled={isAuthBusy}
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <span
                    id="login-password-note"
                    className={cn(
                      "auth-field-note",
                      !form.formState.errors.password?.message && "is-muted",
                    )}
                  >
                    {form.formState.errors.password?.message ?? passwordHelpText}
                  </span>
                </div>
              ) : null}

              {isEmailVerificationStep ? (
                <div className="field">
                  <label htmlFor="emailCode">Код из письма</label>
                  <input
                    id="emailCode"
                    className="auth-text-input auth-otp-input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    maxLength={EMAIL_CODE_MAX_LENGTH}
                    pattern="[0-9]*"
                    enterKeyHint="done"
                    disabled={isAuthBusy}
                    aria-invalid={Boolean(form.formState.errors.emailCode?.message)}
                    aria-describedby={form.formState.errors.emailCode?.message ? "login-email-code-note" : undefined}
                    {...emailCodeField}
                    onChange={(event) => {
                      event.target.value = normalizeNumericCode(event.target.value, EMAIL_CODE_MAX_LENGTH);
                      markInteraction();
                      emailCodeField.onChange(event);
                    }}
                  />
                  {form.formState.errors.emailCode?.message ? (
                    <span id="login-email-code-note" className="auth-field-note">
                      {form.formState.errors.emailCode.message}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {isTwoFactorStep ? (
                <div className="field">
                  <label htmlFor="totpCode">Код 2FA</label>
                  <div className="input-with-action auth-input-shell auth-input-shell--action">
                    <input
                      id="totpCode"
                      className="auth-text-input auth-otp-input"
                      type={showTotpCode ? "text" : "password"}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6 цифр"
                      maxLength={TOTP_CODE_LENGTH}
                      pattern="[0-9]*"
                      enterKeyHint="done"
                      disabled={isAuthBusy}
                      aria-invalid={Boolean(form.formState.errors.totpCode?.message)}
                      aria-describedby="login-totp-note"
                      {...totpCodeField}
                      onChange={(event) => {
                        event.target.value = normalizeNumericCode(event.target.value, TOTP_CODE_LENGTH);
                        markInteraction();
                        totpCodeField.onChange(event);
                      }}
                    />
                    <button
                      type="button"
                      className="input-action"
                      disabled={isAuthBusy}
                      onClick={() => setShowTotpCode((current) => !current)}
                      aria-label={showTotpCode ? "Скрыть код" : "Показать код"}
                    >
                      {showTotpCode ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <span
                    id="login-totp-note"
                    className={cn(
                      "auth-field-note",
                      !form.formState.errors.totpCode?.message && "is-muted",
                    )}
                  >
                    {form.formState.errors.totpCode?.message ??
                      "Откройте приложение-аутентификатор и введите шестизначный код."}
                  </span>
                </div>
              ) : null}

              {isEmailVerificationStep ? (
                <div className="auth-inline-actions auth-inline-actions--login">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="auth-resend-button"
                    disabled={cooldown > 0 || requestCodeMutation.isPending}
                    onClick={() => triggerEmailRequest("resend")}
                  >
                    <RefreshCw size={14} />
                    {requestCodeMutation.isPending
                      ? "Отправляем..."
                      : cooldown > 0
                        ? `Повтор через ${cooldown} сек.`
                        : "Отправить ещё раз"}
                  </Button>
                  <button
                    type="button"
                    className="auth-link-button auth-link-button--muted"
                    disabled={isAuthBusy}
                    onClick={handleChangeEmail}
                  >
                    Изменить email
                  </button>
                </div>
              ) : null}
            </div>

            <div className="auth-submit-section">
              <Button
                type="submit"
                className="auth-submit-button"
                isLoading={loginMutation.isPending || requestCodeMutation.isPending}
                loadingLabel="Проверяем данные..."
              >
                {submitLabel}
              </Button>

              <div className="auth-login-footer auth-login-footer--compact">
                {secondaryActions.map((action) => (
                  <Link
                    key={`${action.to}-${action.label}`}
                    className="auth-secondary-link"
                    to={action.to}
                    onClick={() =>
                      trackAuthEvent(action.event, {
                        role: selectedRole,
                        auth_method: selectedMethod,
                      })
                    }
                  >
                    {action.label}
                  </Link>
                ))}
              </div>
            </div>
          </form>

          <p className="sr-only" aria-live="polite">
            {liveMessage}
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}

export default LoginPage;
