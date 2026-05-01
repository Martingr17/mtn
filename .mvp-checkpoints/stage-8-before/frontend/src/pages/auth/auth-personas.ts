export type AuthPersonaId = "subscriber" | "operator" | "admin";
export type LoginMode = "email_code" | "password";

export interface LoginPersonaPreset {
  id: AuthPersonaId;
  badge: string;
  title: string;
  description: string;
  helper: string;
  email: string;
  password?: string;
  mode: LoginMode;
}

export const LOGIN_PERSONAS: LoginPersonaPreset[] = [
  {
    id: "subscriber",
    badge: "Абонент",
    title: "Вход по коду из письма",
    description: "Подставляет email абонента и готовит сценарий входа по одноразовому коду.",
    helper: "Код придёт на email после нажатия кнопки «Получить код».",
    email: "demo@operator.local",
    mode: "email_code",
  },
  {
    id: "operator",
    badge: "Оператор",
    title: "Доступ в операторскую панель",
    description: "Подставляет рабочий email и пароль оператора для входа в административную зону.",
    helper: "Если для демо-аккаунта включена 2FA, после пароля появится поле для кода.",
    email: "operator@operator.local",
    password: "OperatorDemo2026!",
    mode: "password",
  },
  {
    id: "admin",
    badge: "Администратор",
    title: "Полный доступ супер-админа",
    description: "Подставляет демо-данные администратора с максимальным уровнем доступа.",
    helper: "Используйте для проверки полного админского сценария; 2FA появится, если она включена.",
    email: "superadmin@operator.local",
    password: "SuperAdminDemo2026!",
    mode: "password",
  },
];

export interface RegisterDraftPreset {
  billingId: string;
  phone: string;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}

export const SUBSCRIBER_REGISTER_DRAFT: RegisterDraftPreset = {
  billingId: "DEMO91021",
  phone: "+79005553121",
  email: "alina.new@mtn.ru",
  firstName: "Алина",
  lastName: "Соколова",
  password: "AbonentDemo2026!",
};

export function getLoginPersonaById(id: string | null | undefined) {
  return LOGIN_PERSONAS.find((persona) => persona.id === id);
}
