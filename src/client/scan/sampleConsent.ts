"use client";

/**
 * The person's choice on the "keep these numbers anonymously" switch
 * (contract: src/lib/contracts/hand-sample.ts, candidate), shared by every
 * screen that sends a scan.
 *
 *   - Default ON. Only an OFF choice is remembered, in localStorage under
 *     `SAMPLE_OPT_OUT_KEY`; turning it back on removes the key.
 *   - Every storage access is wrapped: a store that is missing, blocked or
 *     throws reads as the default (ON), and a write that fails is dropped.
 *   - The choice made on this page is also held in memory and wins over
 *     storage, so a switched-off copy stays off for this page even when it
 *     could not be written down.
 *
 * `withSampleNotice` is the one place that decides whether a submission
 * carries `sampleNotice`: only when the notice was on screen AND the switch is
 * on at the moment of sending. Anything else sends no notice, so the server
 * keeps no sample.
 */
import { useSyncExternalStore } from "react";
import { HAND_SAMPLE_NOTICE_VERSION } from "../../lib/contracts/hand-sample";
import type { ScanSubmission } from "../../lib/contracts/measurement";

/** "1" = the person turned the switch off. Absent (or anything else) = on. */
export const SAMPLE_OPT_OUT_KEY = "palmate.handSample.optOut";

/** The part of `Storage` this module touches. */
export interface SampleConsentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Whether the switch shows ON for this storage. Never throws. */
export function readSampleConsent(
  storage: SampleConsentStorage | null,
): boolean {
  try {
    return storage?.getItem(SAMPLE_OPT_OUT_KEY) !== "1";
  } catch {
    return true;
  }
}

/** Remembers an OFF choice, forgets it on ON. Never throws. */
export function writeSampleConsent(
  storage: SampleConsentStorage | null,
  on: boolean,
): void {
  try {
    if (!storage) return;
    if (on) storage.removeItem(SAMPLE_OPT_OUT_KEY);
    else storage.setItem(SAMPLE_OPT_OUT_KEY, "1");
  } catch {
    // Blocked storage: the in-memory choice still holds for this page.
  }
}

/**
 * The submission as it is sent: with `sampleNotice` only when the notice was
 * shown and the switch is on; otherwise without it, even if the submission
 * passed in carried one.
 */
export function withSampleNotice(
  submission: ScanSubmission,
  state: { readonly noticeShown: boolean; readonly on: boolean },
): ScanSubmission {
  const rest: ScanSubmission = { ...submission };
  delete rest.sampleNotice;
  return state.noticeShown && state.on
    ? { ...rest, sampleNotice: HAND_SAMPLE_NOTICE_VERSION }
    : rest;
}

function browserStorage(): SampleConsentStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

// The choice made on this page, which wins over storage (see the header).
let memoryChoice: boolean | null = null;
const listeners = new Set<() => void>();

/** The switch's current state: this page's choice, else storage, else ON. */
export function sampleConsentOn(): boolean {
  return memoryChoice ?? readSampleConsent(browserStorage());
}

/** Sets the switch for this page and remembers (or forgets) an OFF choice. */
export function setSampleConsent(on: boolean): void {
  memoryChoice = on;
  writeSampleConsent(browserStorage(), on);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For tests: forgets this page's in-memory choice. */
export function resetSampleConsentMemory(): void {
  memoryChoice = null;
}

/**
 * The switch's state for a component. The server render (and hydration)
 * shows the default, ON; the browser then shows the stored choice.
 */
export function useSampleConsent(): readonly [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, sampleConsentOn, () => true);
  return [on, setSampleConsent] as const;
}
