/**
 * The lazy PostHog client. `posthog-js` is imported only after the first idle
 * moment (never on the home page's critical path); events sent before it has
 * loaded wait in a short queue (sink.ts). Nothing here calls `identify()`.
 */
import { buildPostHogConfig } from "./config";
import { createSink } from "./sink";

const sink = createSink();
/** `begin` was called: an idle callback (or the load itself) is scheduled. */
let scheduled = false;
/** The import has begun: it is not started twice. */
let loading = false;

export const sendToPostHog = sink.send;

async function load(key: string): Promise<void> {
  const { default: posthog } = await import("posthog-js");
  posthog.init(key, buildPostHogConfig());
  sink.ready(posthog);
}

function begin(now: boolean): void {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof window === "undefined" || loading) return;
  if (scheduled && !now) return;
  scheduled = true;
  const run = () => {
    if (loading) return;
    loading = true;
    // A blocked or failed load drops analytics, never the app.
    load(key).catch(() => sink.failed());
  };
  if (now) {
    run();
  } else if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 4000 });
  } else {
    setTimeout(run, 2000);
  }
}

/** Starts loading PostHog once, after the browser's first idle moment. */
export function startAnalytics(): void {
  begin(false);
}

/**
 * Loads PostHog at once, skipping the wait for idle, when it has not started
 * loading yet. Used after an outbound click, whose event would otherwise sit
 * in memory for up to a few seconds and be lost if the tab closed. Does
 * nothing once the load has begun.
 */
export function loadAnalyticsNow(): void {
  begin(true);
}
