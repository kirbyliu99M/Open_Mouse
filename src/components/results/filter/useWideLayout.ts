"use client";

import { useSyncExternalStore } from "react";

/**
 * The filter is a sidebar from 64em, which is 1024 CSS px at the browser's
 * default text size; narrower, a bottom sheet. 200 % zoom on a desktop halves
 * the CSS width and so gets the sheet. It is in `em` (not px) like the rest of
 * the page's breakpoints and the sidebar's own width (20.5rem): with the
 * browser's text size raised to 200 %, 1024 px is no longer wide enough for a
 * 656 px sidebar and the sheet takes over. In a media query `em` follows the
 * browser's default text size, not the page's.
 */
export const WIDE_QUERY = "(min-width: 64em)";

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
