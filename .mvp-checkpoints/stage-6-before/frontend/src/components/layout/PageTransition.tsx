import type { PropsWithChildren } from "react";

import { motion } from "framer-motion";

import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

export function PageTransition({ children }: PropsWithChildren) {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 18, scale: 0.99 }}
      animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.99 }}
      transition={{ duration: 0.28, ease: [0.2, 0.9, 0.4, 1.1] }}
      className="page-motion"
    >
      {children}
    </motion.div>
  );
}
