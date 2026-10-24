/**
 * The visitor's cookie choice, for Google Analytics (GA4) only. PostHog is
 * cookie-free and never asks (Kirby, 2026-10-24): this choice gates nothing
 * else. The choice lives in localStorage, not in a cookie, so asking about
 * cookies does not set one. No choice yet means "off": GA4 is not even loaded.
 */
import { useSyncExternalStore } from "react";

export const CONSENT_STORAGE_KEY = "palmate-cookie-consent";

export type ConsentChoice = "granted" | "denied";
/** What the UI sees: a choice, `unset` (never asked), or `unknown` (server render). */
export type ConsentState = ConsentChoice | "unset" | "unknown";

/** A stored value to a choice; anything else (missing, edited by hand) is no choice. */
export function parseConsent(raw: string | null): ConsentChoice | null {
  return raw === "granted" || raw === "denied" ? raw : null;
}

/**
 * The choice while the browser refuses to write it (blocked site data, a full
 * quota), so the banner still closes and a withdrawal still takes effect on
 * this page. Null whenever a write succeeded: then storage is the truth, and
 * another tab clearing it means no choice.
 */
let memoryChoice: ConsentChoice | null = null;

/** The stored choice, or null when none was made (or none can be read). */
export function readConsent(): ConsentChoice | null {
  if (memoryChoice) return memoryChoice;
  try {
    return parseConsent(window.localStorage.getItem(CONSENT_STORAGE_KEY));
  } catch {
    // Storage blocked: treated as no choice, so GA4 stays off.
    return null;
  }
}

const listeners = new Set<() => void>();
/** The banner was reopened from the footer to change an earlier choice. */
let reopened = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed the choice.
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONSENT_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Records the choice and closes the banner. A blocked store keeps it for this page only. */
export function setConsent(choice: ConsentChoice): void {
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, choice);
    memoryChoice = null;
  } catch {
    // Not stored: kept in memory for this page, and asked again next visit,
    // which is the safe side.
    memoryChoice = choice;
  }
  reopened = false;
  emit();
}

/** Shows the banner again (the footer's "Cookie settings"). */
export function reopenConsent(): void {
  reopened = true;
  emit();
}

export function useConsent(): ConsentState {
  return useSyncExternalStore(
    subscribe,
    () => readConsent() ?? "unset",
    () => "unknown",
  );
}

/** True while the banner was reopened to change a choice. */
export function useConsentReopened(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => reopened,
    () => false,
  );
}
