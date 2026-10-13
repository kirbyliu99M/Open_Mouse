/**
 * `track`: the one way the app sends a product event (issue #138). Props are
 * parsed with the contract's strict schema for that event; a failure drops the
 * event silently (and logs nothing, so a bad prop never reaches a console or a
 * server). Without `NEXT_PUBLIC_POSTHOG_KEY` it does nothing at all.
 */
import {
  analyticsEventSchemas,
  type AnalyticsEventName,
  type AnalyticsEventProps,
} from "@/lib/contracts/analytics";
import { loadAnalyticsNow, sendToPostHog } from "./client";

export type Sender = (name: string, props: Record<string, unknown>) => void;

export interface TrackDeps {
  /** True when a project key is configured. */
  enabled: () => boolean;
  send: Sender;
  /** Called after an urgent event is sent: load PostHog now, not at idle. */
  urgent?: () => void;
}

/**
 * Events whose moment is the click that leaves the page. A tab closed before
 * posthog-js has loaded would lose an event still waiting in the sink's
 * memory queue, so these ask for the load right away (once loaded, posthog-js
 * flushes its own batch on `pagehide` with sendBeacon).
 */
export const URGENT_EVENTS: ReadonlySet<AnalyticsEventName> = new Set([
  "purchase_link_clicked",
  "official_link_clicked",
]);

export function createTrack(deps: TrackDeps) {
  return function track<E extends AnalyticsEventName>(
    name: E,
    props: AnalyticsEventProps<E>,
  ): void {
    if (!deps.enabled()) return;
    const schema = analyticsEventSchemas[name];
    if (!schema) return;
    const parsed = schema.safeParse(props);
    if (!parsed.success) return;
    try {
      deps.send(name, parsed.data as Record<string, unknown>);
      if (URGENT_EVENTS.has(name)) deps.urgent?.();
    } catch {
      // Analytics never breaks the app.
    }
  };
}

export const analyticsEnabled = (): boolean =>
  Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

export const track = createTrack({
  enabled: analyticsEnabled,
  send: sendToPostHog,
  urgent: loadAnalyticsNow,
});
