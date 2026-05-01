const PLACEHOLDER_NAME_PATTERN = /^[?\uFFFD\s._-]+$/;
const BROKEN_NAME_FRAGMENT_PATTERN = /[?\uFFFD]/;
const ASCII_TEST_NAME_PATTERN = /(user|test|testov|smoke|prod|demo|check|qa|example|local)/i;

export function getSafeDisplayName(
  name: string | null | undefined,
  fallback: string,
  email?: string | null,
) {
  const normalized = name?.trim();

  if (!normalized) {
    return fallback;
  }

  if (PLACEHOLDER_NAME_PATTERN.test(normalized)) {
    return fallback;
  }

  if (BROKEN_NAME_FRAGMENT_PATTERN.test(normalized)) {
    return fallback;
  }

  const emailValue = (email ?? "").trim().toLowerCase();
  const isExampleMailbox =
    emailValue.endsWith("@example.com") || emailValue.endsWith("@operator.local");
  const hasCyrillic = /[А-Яа-яЁё]/.test(normalized);

  if (!hasCyrillic && isExampleMailbox && ASCII_TEST_NAME_PATTERN.test(normalized)) {
    return fallback;
  }

  return normalized;
}
