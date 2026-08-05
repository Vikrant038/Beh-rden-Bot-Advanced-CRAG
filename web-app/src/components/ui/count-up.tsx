"use client";

import { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "framer-motion";

interface CountUpProps {
  value: number;
  durationMs?: number;
  suffix?: string;
  decimals?: number;
}

/**
 * Animated count-up that starts when the element scrolls into view.
 * Respects `prefers-reduced-motion` (renders the final value immediately).
 */
export function CountUp({ value, durationMs = 1200, suffix = "", decimals = 0 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView || reduceMotion) {
      setDisplay(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      // ease-out cubic for a satisfying deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Number((eased * value).toFixed(decimals)));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [decimals, durationMs, inView, reduceMotion, value]);

  const formatted =
    decimals > 0
      ? display.toFixed(decimals)
      : display >= 1000
        ? `${(display / 1000).toFixed(1)}k`
        : String(display);

  return (
    <span ref={ref} className="tabular-nums">
      {formatted}
      {suffix}
    </span>
  );
}
