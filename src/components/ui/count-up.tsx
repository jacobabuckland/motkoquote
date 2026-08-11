"use client";

import { useEffect, useRef, useState } from "react";

interface CountUpProps {
  target: number;
  duration: number;
  format: (n: number) => string;
}

export function CountUp({ target, duration, format }: CountUpProps) {
  // Check if user prefers reduced motion
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [currentValue, setCurrentValue] = useState(
    prefersReducedMotion || duration === 0 ? target : 0
  );

  // Track whether the initial animation has completed
  const hasAnimatedRef = useRef(false);

  useEffect(() => {
    if (prefersReducedMotion || duration === 0) {
      hasAnimatedRef.current = true;
      return;
    }

    // If target changes after initial animation, update immediately without re-animating
    if (hasAnimatedRef.current) {
      setCurrentValue(target);
      return;
    }

    // Animate from 0 to target on initial mount
    const startTime = performance.now();
    let animationFrame: number;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic for a smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = target * eased;

      setCurrentValue(value);

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      } else {
        hasAnimatedRef.current = true;
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [target, duration, prefersReducedMotion]);

  return <>{format(currentValue)}</>;
}
