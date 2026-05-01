import { forwardRef } from "react";
import type { HTMLAttributes, PropsWithChildren } from "react";

import { cn } from "@/utils/cn";

export const Card = forwardRef<HTMLDivElement, PropsWithChildren<HTMLAttributes<HTMLDivElement>>>(
  ({ children, className, ...props }, ref) => (
    <div ref={ref} className={cn("ui-card", className)} {...props}>
      {children}
    </div>
  ),
);

Card.displayName = "Card";
