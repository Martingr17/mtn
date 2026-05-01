import { useEffect } from "react";
import type { PropsWithChildren, ReactNode } from "react";
import { createPortal } from "react-dom";

import { AnimatePresence, motion } from "framer-motion";

import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

interface AnimatedModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  footer?: ReactNode;
}

export function AnimatedModal({
  children,
  footer,
  onClose,
  open,
  title,
}: PropsWithChildren<AnimatedModalProps>) {
  const prefersReducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="modal-overlay is-open"
          onClick={onClose}
          initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0 }}
          transition={{ duration: 0.22, ease: [0, 0, 0.2, 1] }}
        >
          <motion.div
            className="modal-card scale-in is-revealed"
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === "string" ? title : "Modal dialog"}
            onClick={(event) => event.stopPropagation()}
            initial={
              prefersReducedMotion
                ? { opacity: 1 }
                : { opacity: 0, scale: 0.95, y: 10 }
            }
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.96, y: 8 }
            }
            transition={{ duration: 0.26, ease: [0.2, 0.9, 0.4, 1.1] }}
          >
            {title ? <div className="stack-sm"><h3>{title}</h3></div> : null}
            <div className="stack-md">{children}</div>
            {footer ? <div className="section-actions">{footer}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
