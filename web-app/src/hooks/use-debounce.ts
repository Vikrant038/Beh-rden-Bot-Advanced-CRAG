"use client";

import { useEffect, useState } from "react";

/**
 * Returns a value that only updates after `delayMs` of quiet time has passed.
 * Used to debounce search inputs before hitting the tRPC server.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
