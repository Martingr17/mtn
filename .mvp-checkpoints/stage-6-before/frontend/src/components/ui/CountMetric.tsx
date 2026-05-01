import RawCountUp from "react-countup";

import { useRevealOnScroll } from "@/hooks/use-reveal-on-scroll";
import { formatCurrency, formatNumber } from "@/utils/format";

interface CountMetricProps {
  value: number;
  mode?: "number" | "currency";
  suffix?: string;
  duration?: number;
}

const CountUpComponent =
  typeof RawCountUp === "function"
    ? RawCountUp
    : typeof (RawCountUp as { default?: unknown }).default === "function"
      ? ((RawCountUp as { default: typeof RawCountUp }).default as typeof RawCountUp)
      : null;

function formatMetricValue(value: number, mode: "number" | "currency", suffix?: string) {
  if (mode === "currency") {
    return formatCurrency(value);
  }

  const formatted = formatNumber(value, Number.isInteger(value) ? 0 : 1);
  return suffix ? `${formatted} ${suffix}` : formatted;
}

export function CountMetric({
  value,
  mode = "number",
  suffix,
  duration = 0.9,
}: CountMetricProps) {
  const { isVisible, prefersReducedMotion, setNodeRef } = useRevealOnScroll<HTMLSpanElement>({ threshold: 0.35 });

  if (prefersReducedMotion) {
    return <span ref={setNodeRef}>{formatMetricValue(value, mode, suffix)}</span>;
  }

  if (!isVisible) {
    return <span ref={setNodeRef}>{formatMetricValue(0, mode, suffix)}</span>;
  }

  if (!CountUpComponent) {
    return <span ref={setNodeRef}>{formatMetricValue(value, mode, suffix)}</span>;
  }

  return (
    <span ref={setNodeRef}>
      <CountUpComponent
        end={value}
        duration={Math.max(duration, 0)}
        preserveValue
        formattingFn={(nextValue) => formatMetricValue(nextValue, mode, suffix)}
      />
    </span>
  );
}
