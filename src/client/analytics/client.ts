/**
 * The lazy PostHog client. `posthog-js` is imported only after the first idle
 * moment (never on the home page's critical path); events sent before it has
 * loaded wait in a short queue (sink.ts). Nothing here calls `identify()`.
 */
import { buildPostHogConfig } from "./config";
import { createSink } from "./sink";

const sink = createSink();
let starting = false;

export const sendToPostHog = sink.send;

async function load(key: string): Promise<void> {
  const { default: posthog } = await import("posthog-js");
  posthog.init(key, buildPostHogConfig());
  sink.ready(posthog);
}

/** Starts loading PostHog once, after the browser's first idle moment. */
export function startAnalytics(): void {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || starting || typeof window === "undefined") return;
  starting = true;
  const run = () => {
    // A blocked or failed load drops analytics, never the app.
    load(key).catch(() => sink.failed());
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 4000 });
  } else {
    setTimeout(run, 2000);
  }
}
