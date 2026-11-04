/**
 * The tour's PostHog events (Kirby 2026-11-05: "接 PostHog", through the
 * existing `track()`; names are candidates).
 *
 * `track()` only sends events listed in `src/lib/contracts/analytics.ts`, and
 * the contract is Claude's to change ("Change this file only in a PR of its
 * own"). So this file does NOT register them: it checks the contract at send
 * time and sends nothing until the five events are there. Registering them is
 * one decision for Kirby/Claude; `PROPOSED_SCAN_TOUR_EVENT_SCHEMAS` below is
 * the entry to copy into `analyticsEventSchemas` (strict objects, enums and
 * small integers only, nothing about the hand or the photo).
 */
import { z } from "zod";
import { analyticsEventSchemas } from "@/lib/contracts/analytics";
import { track } from "../../analytics/track";
import type {
  TourAnalyticsEvent,
  TourReference,
  TourStepId,
} from "./tourModel";

export const SCAN_TOUR_EVENT_NAMES = [
  "scan_tour_started",
  "scan_tour_step_viewed",
  "scan_tour_completed",
  "scan_tour_skipped",
  "scan_tour_first_use_answer",
] as const;

const reference = z.enum(["a4", "letter", "card"]);
const step = z.int().min(0).max(4);
const stepId = z.enum(["reference", "placement", "cue", "shutter"]);

/** Proposed contract entries (candidate, not registered). */
export const PROPOSED_SCAN_TOUR_EVENT_SCHEMAS = {
  scan_tour_started: z.strictObject({
    trigger: z.enum(["auto", "help"]),
    reference,
  }),
  scan_tour_step_viewed: z.strictObject({ step, stepId, reference }),
  scan_tour_completed: z.strictObject({ reference }),
  /** `step` 0: skipped on the first-use question. */
  scan_tour_skipped: z.strictObject({ step, reference }),
  scan_tour_first_use_answer: z.strictObject({
    answer: z.enum(["first", "returning"]),
    reference,
  }),
} as const;

export type TourEventProps = Record<
  string,
  string | number | TourReference | TourStepId
>;

/** The props an event carries: the event's own fields plus the reference. */
export function tourEventProps(
  event: TourAnalyticsEvent,
  ref: TourReference,
): { name: TourAnalyticsEvent["name"]; props: TourEventProps } {
  const { name, ...rest } = event;
  return { name, props: { ...rest, reference: ref } };
}

export interface TourSendDeps {
  readonly schemas: Readonly<Record<string, unknown>>;
  readonly send: (name: string, props: TourEventProps) => void;
}

const defaultDeps: TourSendDeps = {
  schemas: analyticsEventSchemas,
  // The event names are not in `AnalyticsEventName` yet; the check below is
  // what keeps an unregistered name from reaching `track` (which would drop
  // it anyway). Once registered, this cast can go.
  send: track as unknown as TourSendDeps["send"],
};

/** Sends one tour event if, and only if, the contract lists it. Never throws. */
export function sendTourEvent(
  event: TourAnalyticsEvent,
  ref: TourReference,
  deps: TourSendDeps = defaultDeps,
): boolean {
  try {
    const { name, props } = tourEventProps(event, ref);
    if (!Object.prototype.hasOwnProperty.call(deps.schemas, name)) return false;
    deps.send(name, props);
    return true;
  } catch {
    return false;
  }
}
