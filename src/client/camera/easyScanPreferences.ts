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
  /** Absent on a minimal store; `clearAttempts` then empties the key instead. */
  removeItem?(key: string): void;
}

const PAPER_SIZE_KEY = "openMouse.easyScan.paperSize";
const TIP_SEEN_KEY = "openMouse.easyScan.firstRunTipSeen";

/** Where the scan attempt log is kept (attemptLog.ts). */
export const ATTEMPT_LOG_KEY = "openMouse.easyScan.attempts.v1";

/**
 * Forgets the scan attempt log. Called wherever the person deletes their data
 * (the account page's "Delete everything", the results page's "Delete this
 * scan now"), because the log is kept on this device whether or not they ever
 * open the debug panel. Never throws.
 */
export function clearAttempts(storage: StorageLike | null): void {
  try {
    if (!storage) return;
    if (typeof storage.removeItem === "function")
      storage.removeItem(ATTEMPT_LOG_KEY);
    else storage.setItem(ATTEMPT_LOG_KEY, "[]");
  } catch {
    // Storage may be blocked; there is then nothing of ours in it either.
  }
}

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

/**
 * v3.4 (candidate 未拍板): what the person measures against, kept under the
 * same key as the paper size: `"a4"`, `"letter"` or `"card"` (the card
 * reference, only while `CARD_REFERENCE_ENABLED`). `readStoredPaperSize`
 * keeps reading a paper size only: a stored `"card"` reads as its fallback.
 */
export type ScanReference = PaperSize | "card";

/** The order the reference chip steps through. */
export function referenceChoices(
  cardEnabled: boolean,
): readonly ScanReference[] {
  return cardEnabled ? ["a4", "letter", "card"] : ["a4", "letter"];
}

/** The chip's next choice after `current` (wraps; an unknown one starts over). */
export function nextReference(
  current: ScanReference,
  cardEnabled: boolean,
): ScanReference {
  const list = referenceChoices(cardEnabled);
  const i = list.indexOf(current);
  return list[(i + 1) % list.length] ?? "a4";
}

/**
 * What one tap of the reference chip does (v3.4). Between A4 and Letter it
 * is exactly the old toggle (only the paper size changes; the live loop is
 * not touched). Crossing into or out of the card (`resetLoop`), the live
 * loop starts over: no paper corners, card slot, hand readings or ring of
 * the other mode survive the switch.
 */
export interface ReferenceSwitch {
  readonly next: ScanReference;
  readonly cardMode: boolean;
  /** The paper size to keep (unchanged when the card is chosen). */
  readonly paperSize: PaperSize;
  readonly resetLoop: boolean;
}

export function referenceSwitch(
  current: { readonly cardMode: boolean; readonly paperSize: PaperSize },
  cardEnabled: boolean,
): ReferenceSwitch {
  const next = nextReference(
    current.cardMode ? "card" : current.paperSize,
    cardEnabled,
  );
  const cardMode = next === "card";
  return {
    next,
    cardMode,
    paperSize: next === "card" ? current.paperSize : next,
    resetLoop: cardMode !== current.cardMode,
  };
}

/** The stored reference; `"card"` only when `cardEnabled`, else the fallback. */
export function readStoredReference(
  storage: StorageLike | null,
  cardEnabled: boolean,
  fallback: PaperSize = "a4",
): ScanReference {
  if (!storage) return fallback;
  let value: string | null;
  try {
    value = storage.getItem(PAPER_SIZE_KEY);
  } catch {
    return fallback;
  }
  if (value === "card") return cardEnabled ? "card" : fallback;
  return value === "a4" || value === "letter" ? value : fallback;
}

export function writeStoredReference(
  storage: StorageLike | null,
  reference: ScanReference,
): void {
  try {
    storage?.setItem(PAPER_SIZE_KEY, reference);
  } catch {
    // Best-effort only, as `writeStoredPaperSize`.
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
