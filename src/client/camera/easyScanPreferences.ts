/**
 * Two small pieces of viewer-local state for the easy-scan camera
 * (docs/design/easy-scan-shell-2026-09-25/README.md): the A4/Letter toggle
 * "remembered in localStorage", and the first-run tip's "shown once
 * (localStorage flag; still reachable from a small '?')".
 *
 * Both take a `StorageLike` rather than reaching for `window.localStorage`
 * directly, so the read/decide logic is a pure function of its input and
 * unit-testable without a DOM `localStorage` (private browsing, or a test
 * environment that doesn't provide one, must degrade to the given default
 * rather than throw).
 */
import type { PaperSize } from "../../lib/contracts/measurement";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const PAPER_SIZE_KEY = "openMouse.easyScan.paperSize";
const TIP_SEEN_KEY = "openMouse.easyScan.firstRunTipSeen";

/** `window.localStorage`, or `null` where it's unavailable/throws (private browsing, SSR). */
export function getBrowserStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredPaperSize(
  storage: StorageLike | null,
  fallback: PaperSize = "a4",
): PaperSize {
  if (!storage) return fallback;
  let value: string | null;
  try {
    value = storage.getItem(PAPER_SIZE_KEY);
  } catch {
    return fallback;
  }
  return value === "a4" || value === "letter" ? value : fallback;
}

export function writeStoredPaperSize(
  storage: StorageLike | null,
  size: PaperSize,
): void {
  try {
    storage?.setItem(PAPER_SIZE_KEY, size);
  } catch {
    // Best-effort only — a full or blocked store must not break the toggle.
  }
}

export function readFirstRunTipSeen(storage: StorageLike | null): boolean {
  try {
    return storage?.getItem(TIP_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markFirstRunTipSeen(storage: StorageLike | null): void {
  try {
    storage?.setItem(TIP_SEEN_KEY, "1");
  } catch {
    // Best-effort — worst case the tip shows again next time.
  }
}
