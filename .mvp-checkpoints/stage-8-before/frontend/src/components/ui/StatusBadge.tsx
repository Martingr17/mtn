import { cn } from "@/utils/cn";

interface StatusBadgeProps {
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  children: string;
}

export function StatusBadge({ tone = "neutral", children }: StatusBadgeProps) {
  return (
    <span className={cn("ui-badge", `is-${tone}`)} role="status" aria-live="polite">
      {children}
    </span>
  );
}
