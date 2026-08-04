"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type FontScale = 0.875 | 1 | 1.125 | 1.25;

export const FONT_SCALE_OPTIONS: Array<{ value: FontScale; label: string }> = [
  { value: 0.875, label: "Small" },
  { value: 1, label: "Normal" },
  { value: 1.125, label: "Large" },
  { value: 1.25, label: "Extra large" },
];

const FONT_SCALE_KEY = "behoerden.fontScale";
const REDUCED_MOTION_KEY = "behoerden.reducedMotion";
const HIGH_CONTRAST_KEY = "behoerden.highContrast";
const FONT_SCALE_ATTR = "data-font-scale";
const REDUCED_MOTION_ATTR = "data-force-reduced-motion";
const HIGH_CONTRAST_ATTR = "data-high-contrast";

function readNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readFlag(key: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(key) === "1";
}

interface PreferenceContextValue {
  fontScale: FontScale;
  setFontScale: (scale: FontScale) => void;
  forceReducedMotion: boolean;
  setForceReducedMotion: (value: boolean) => void;
  highContrast: boolean;
  setHighContrast: (value: boolean) => void;
  mounted: boolean;
}

const PreferenceContext = createContext<PreferenceContextValue | null>(null);

/**
 * User-level appearance accessibility: text scaling and an explicit
 * "reduce motion" override (applies regardless of OS setting). Persists to
 * localStorage and reflects onto <html> attributes consumed by globals.css.
 */
export function PreferenceProvider({ children }: { children: ReactNode }) {
  const [fontScale, setFontScaleState] = useState<FontScale>(() => {
    const raw = readNumber(FONT_SCALE_KEY, 1);
    return (FONT_SCALE_OPTIONS.some((option) => option.value === raw) ? raw : 1) as FontScale;
  });
  const [forceReducedMotion, setForceReducedMotionState] = useState<boolean>(() =>
    readFlag(REDUCED_MOTION_KEY),
  );
  const [highContrast, setHighContrastState] = useState<boolean>(() => readFlag(HIGH_CONTRAST_KEY));
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontScale}rem`;
    document.documentElement.setAttribute(FONT_SCALE_ATTR, String(fontScale));
    try {
      window.localStorage.setItem(FONT_SCALE_KEY, String(fontScale));
    } catch {
      // Ignore storage failures.
    }
  }, [fontScale]);

  useEffect(() => {
    document.documentElement.setAttribute(
      REDUCED_MOTION_ATTR,
      forceReducedMotion ? "true" : "false",
    );
    try {
      window.localStorage.setItem(REDUCED_MOTION_KEY, forceReducedMotion ? "1" : "0");
    } catch {
      // Ignore storage failures.
    }
  }, [forceReducedMotion]);

  useEffect(() => {
    document.documentElement.setAttribute(HIGH_CONTRAST_ATTR, highContrast ? "true" : "false");
    try {
      window.localStorage.setItem(HIGH_CONTRAST_KEY, highContrast ? "1" : "0");
    } catch {
      // Ignore storage failures.
    }
  }, [highContrast]);

  const setFontScale = useCallback((scale: FontScale) => setFontScaleState(scale), []);
  const setForceReducedMotion = useCallback(
    (value: boolean) => setForceReducedMotionState(value),
    [],
  );
  const setHighContrast = useCallback((value: boolean) => setHighContrastState(value), []);

  const value = useMemo(
    () => ({
      fontScale,
      setFontScale,
      forceReducedMotion,
      setForceReducedMotion,
      highContrast,
      setHighContrast,
      mounted,
    }),
    [
      fontScale,
      setFontScale,
      forceReducedMotion,
      setForceReducedMotion,
      highContrast,
      setHighContrast,
      mounted,
    ],
  );

  return <PreferenceContext.Provider value={value}>{children}</PreferenceContext.Provider>;
}

export function usePreferences(): PreferenceContextValue {
  const context = useContext(PreferenceContext);
  if (!context) {
    throw new Error("usePreferences must be used within a PreferenceProvider.");
  }
  return context;
}
