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

function readChoice(): ConsentChoice | null {
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
  } catch {
    // Not stored: the choice is asked again next visit, which is the safe side.
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
    () => readChoice() ?? "unset",
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
