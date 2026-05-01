import type { CSSProperties, HTMLAttributes, PropsWithChildren } from "react";

import { cn } from "@/utils/cn";
import { useRevealOnScroll } from "@/hooks/use-reveal-on-scroll";

interface AnimatedRevealProps extends HTMLAttributes<HTMLDivElement> {
  delay?: number;
  animation?: "fade-in-up" | "scale-in" | "slide-in-right";
  once?: boolean;
}

export function AnimatedReveal({
  animation = "fade-in-up",
  children,
  className,
  delay = 0,
  once = true,
  style,
  ...props
}: PropsWithChildren<AnimatedRevealProps>) {
  const { isVisible, setNodeRef } = useRevealOnScroll<HTMLDivElement>({ once });

  return (
    <div
      ref={setNodeRef}
      className={cn("reveal-block", animation, isVisible && "is-revealed", className)}
      style={
        {
          ...style,
          "--reveal-delay": `${delay}ms`,
        } as CSSProperties
      }
      {...props}
    >
      {children}
    </div>
  );
}
