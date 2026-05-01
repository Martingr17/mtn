import { useMemo, useRef, useState } from "react";
import type { ButtonHTMLAttributes, MouseEvent, PropsWithChildren } from "react";

import { Check, LoaderCircle, X } from "lucide-react";

import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import type { ButtonFeedbackState } from "@/hooks/use-button-feedback";
import { cn } from "@/utils/cn";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  isLoading?: boolean;
  loadingLabel?: string;
  feedbackState?: ButtonFeedbackState;
}

export function Button({
  children,
  className,
  disabled,
  feedbackState = "idle",
  isLoading = false,
  loadingLabel = "Обработка...",
  onClick,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: PropsWithChildren<ButtonProps>) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [ripples, setRipples] = useState<
    Array<{ id: number; size: number; x: number; y: number }>
  >([]);

  const statusIcon = useMemo(() => {
    if (isLoading) {
      return <LoaderCircle className="is-spinning" />;
    }

    if (feedbackState === "success") {
      return <Check />;
    }

    if (feedbackState === "error") {
      return <X />;
    }

    return null;
  }, [feedbackState, isLoading]);

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (!prefersReducedMotion) {
      const rect = buttonRef.current?.getBoundingClientRect();

      if (rect) {
        const size = Math.max(rect.width, rect.height) * 1.15;
        const ripple = {
          id: Date.now() + Math.random(),
          size,
          x: event.clientX - rect.left - size / 2,
          y: event.clientY - rect.top - size / 2,
        };

        setRipples((current) => [...current, ripple]);
        window.setTimeout(() => {
          setRipples((current) => current.filter((item) => item.id !== ripple.id));
        }, 320);
      }
    }

    onClick?.(event);
  };

  return (
    <button
      ref={buttonRef}
      type={type}
      disabled={disabled || isLoading}
      className={cn(
        "ui-button",
        `is-${variant}`,
        `is-${size}`,
        isLoading && "is-loading",
        feedbackState === "success" && "has-success",
        feedbackState === "error" && "has-error",
        className,
      )}
      onClick={handleClick}
      {...props}
    >
      <span className="ui-button__ripples" aria-hidden="true">
        {ripples.map((ripple) => (
          <span
            key={ripple.id}
            className="ui-button__ripple"
            style={{
              width: ripple.size,
              height: ripple.size,
              left: ripple.x,
              top: ripple.y,
            }}
          />
        ))}
      </span>

      <span className="ui-button__content">
        {statusIcon ? <span className="ui-button__status-icon">{statusIcon}</span> : null}
        <span className="ui-button__label">{isLoading ? loadingLabel : children}</span>
      </span>
    </button>
  );
}
