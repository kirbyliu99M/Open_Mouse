"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia?.(QUERY);
  if (!query) return () => {};
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return window.matchMedia?.(QUERY).matches === true;
}

/**
 * Whether the person asked for reduced motion, and it follows a change of the
 * setting while the page is open. False on the server, and on the first
 * client render until React reads the setting, so nothing that only exists
 * for motion (the flash, the scan line) is rendered under a wrong guess.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
