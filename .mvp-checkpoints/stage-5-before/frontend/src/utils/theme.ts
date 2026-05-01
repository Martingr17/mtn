import type { ThemeMode } from "@/types/domain";

export const THEME_STORAGE_KEY = "mtn_theme";
export const DEFAULT_THEME: ThemeMode = "gradient";

export const THEME_LABELS: Record<ThemeMode, string> = {
  gradient: "Светлый акцент",
  "black-beige": "Графит и беж",
};

export const THEME_OPTIONS = [
  { value: "gradient", label: THEME_LABELS.gradient },
  { value: "black-beige", label: THEME_LABELS["black-beige"] },
] as const satisfies ReadonlyArray<{ value: ThemeMode; label: string }>;

export function isThemeMode(value: string | null): value is ThemeMode {
  return value === "gradient" || value === "black-beige";
}

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return DEFAULT_THEME;
  }

  const rawTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeMode(rawTheme) ? rawTheme : DEFAULT_THEME;
}

export function saveTheme(theme: ThemeMode) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;
  document.body?.setAttribute("data-theme", theme);
}

export function getThemeToastMessage(theme: ThemeMode) {
  return `Тема изменена: ${THEME_LABELS[theme]}`;
}
