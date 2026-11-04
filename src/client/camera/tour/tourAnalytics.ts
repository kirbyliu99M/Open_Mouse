/**
 * The tour's PostHog events (Kirby 2026-11-05: a tour funnel through the
 * existing `track()`; names are candidates). The five events and their
 * properties are in `src/lib/contracts/analytics.ts`; `track()` parses each
 * against its schema and drops what fails.
 */
import { track } from "../../analytics/track";
import type { TourAnalyticsEvent, TourReference } from "./tourModel";

/** The tracker's shape, so tests can pass their own. */
export type TourTrack = typeof track;

/** Sends one tour event with the reference added. Never throws. */
export function sendTourEvent(
  event: TourAnalyticsEvent,
  reference: TourReference,
  send: TourTrack = track,
): void {
  try {
    switch (event.name) {
      case "scan_tour_started":
        send(event.name, { trigger: event.trigger, reference });
        return;
      case "scan_tour_step_viewed":
        send(event.name, {
          step: event.step,
          stepId: event.stepId,
          reference,
        });
        return;
      case "scan_tour_completed":
        send(event.name, { reference });
        return;
      case "scan_tour_skipped":
        send(event.name, { step: event.step, reference });
        return;
      case "scan_tour_first_use_answer":
        send(event.name, { answer: event.answer, reference });
        return;
    }
  } catch {
    // Analytics never breaks the tour.
  }
}
