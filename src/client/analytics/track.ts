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
import { sendToPostHog } from "./client";

export type Sender = (name: string, props: Record<string, unknown>) => void;

export interface TrackDeps {
  /** True when a project key is configured. */
  enabled: () => boolean;
  send: Sender;
}

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
});
