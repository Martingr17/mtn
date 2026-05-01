import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";
import { ru } from "date-fns/locale";

export function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value ?? 0);
}

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits,
  }).format(value ?? 0);
}

export function formatDate(value?: string | null, pattern = "d MMM yyyy, HH:mm") {
  if (!value) {
    return "—";
  }

  const parsed = parseISO(value);
  if (!isValid(parsed)) {
    return "—";
  }

  return format(parsed, pattern, { locale: ru });
}

export function formatRelative(value?: string | null) {
  if (!value) {
    return "только что";
  }

  const parsed = parseISO(value);
  if (!isValid(parsed)) {
    return "только что";
  }

  return formatDistanceToNowStrict(parsed, {
    locale: ru,
    addSuffix: true,
  });
}

export function formatPercent(value: number | null | undefined) {
  return `${formatNumber(value, 0)}%`;
}

export function formatSpeed(value: number | null | undefined) {
  return `${formatNumber(value, 1)} Мбит/с`;
}
