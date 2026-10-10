"use client";

import { useSyncExternalStore } from "react";

/** The filter is a sidebar from this width (CSS px); below it, a bottom sheet. 200 % zoom on a desktop gets the sheet. */
export const WIDE_QUERY = "(min-width: 1024px)";

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(WIDE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * Whether the window is wide enough for the sidebar. The server and the first
 * static render say no (the phone layout); the results page only renders once
 * its data has loaded in the browser, so nothing is hydrated against it.
 */
export function useWideLayout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => false,
  );
}

/** Whether the person asked for less motion. Read when it is needed, not subscribed. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
