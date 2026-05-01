import { useCallback, useEffect, useState } from "react";

import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

interface RevealOptions {
  once?: boolean;
  threshold?: number;
  rootMargin?: string;
}

export function useRevealOnScroll<T extends HTMLElement>({
  once = true,
  threshold = 0.12,
  rootMargin = "0px 0px -8% 0px",
}: RevealOptions = {}) {
  const [node, setNode] = useState<T | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const [isVisible, setIsVisible] = useState(prefersReducedMotion);
  const resolvedVisible = prefersReducedMotion || isVisible;
  const setNodeRef = useCallback((nextNode: T | null) => {
    setNode(nextNode);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }

    if (!node || resolvedVisible) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            if (once) {
              observer.unobserve(entry.target);
            }
          } else if (!once) {
            setIsVisible(false);
          }
        });
      },
      { threshold, rootMargin },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, [node, once, prefersReducedMotion, resolvedVisible, rootMargin, threshold]);

  return { setNodeRef, isVisible: resolvedVisible, prefersReducedMotion };
}
