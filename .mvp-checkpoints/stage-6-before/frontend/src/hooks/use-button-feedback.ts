import { useEffect, useRef, useState } from "react";

export type ButtonFeedbackState = "idle" | "success" | "error";

export function useButtonFeedback(resetDelay = 550) {
  const [feedbackState, setFeedbackState] = useState<ButtonFeedbackState>("idle");
  const timeoutRef = useRef<number | null>(null);

  const clearFeedback = () => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const flashFeedback = (nextState: Exclude<ButtonFeedbackState, "idle">) => {
    clearFeedback();
    setFeedbackState(nextState);
    timeoutRef.current = window.setTimeout(() => {
      setFeedbackState("idle");
      timeoutRef.current = null;
    }, resetDelay);
  };

  useEffect(
    () => () => {
      clearFeedback();
    },
    [],
  );

  return { feedbackState, flashFeedback, setFeedbackState };
}
