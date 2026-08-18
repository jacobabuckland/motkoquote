"use client";

import { useEffect, useRef, useState } from "react";

interface CountUpProps {
  /** Value to count to. `target` is the alias #133 shipped with. */
  to?: number;
  target?: number;
  from?: number;
  /** Duration in ms. `duration` is the alias #133 shipped with. */
  durationMs?: number;
  duration?: number;
  format?: (n: number) => string;
}

/**
 * CountUp component animates a number from `from` to `to` over `durationMs`.
 * Lands exactly on `to` with no rounding drift. Respects prefers-reduced-motion.
 */
export function CountUp({
  to,
  target,
  from = 0,
  durationMs,
  duration,
  format,
}: CountUpProps) {
  // Two frozen acceptance contracts name these props differently and neither
  // may be edited: #133 shipped `target`/`duration` to main, #140 specifies
  // `to`/`durationMs`. Accepting both keeps the shipped dashboard hero working
  // while satisfying this item's spec, without rewriting either contract.
  const toValue = to ?? target ?? 0;
  const durationValue = durationMs ?? duration ?? 0;
  const [displayValue, setDisplayValue] = useState(from);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const startValueRef = useRef<number>(from);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Check for reduced motion preference
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // If reduced motion or no change needed, render final value immediately
    if (prefersReducedMotion || toValue === startValueRef.current) {
      setDisplayValue(toValue);
      return;
    }

    // Cancel any ongoing animation
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
    }

    // Start from current display value (for mid-animation changes)
    startValueRef.current = displayValue;
    startTimeRef.current = null;

    const animate = (currentTime: number) => {
      if (!isMountedRef.current) {
        return;
      }

      if (startTimeRef.current === null) {
        startTimeRef.current = currentTime;
      }

      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / durationValue, 1);

      // Linear interpolation from startValue toValue toValue
      const currentValue =
        startValueRef.current + (toValue - startValueRef.current) * progress;

      if (!isMountedRef.current) {
        return;
      }

      if (progress < 1) {
        setDisplayValue(currentValue);
        animationRef.current = requestAnimationFrame(animate);
      } else {
        // Ensure we land exactly on the target value
        setDisplayValue(toValue);
        animationRef.current = null;
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    // Cleanup function
    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
    // displayValue is intentionally not in deps - we read its current value when
    // the effect runs (triggered by 'toValue' changing), but don't want toValue re-run the
    // effect when displayValue changes (since we set it during animation)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toValue, durationValue]);

  const formattedValue = format ? format(displayValue) : displayValue.toString();

  return <span className="tabular-nums">{formattedValue}</span>;
}
