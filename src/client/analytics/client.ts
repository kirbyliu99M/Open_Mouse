/**
 * The lazy PostHog client. `posthog-js` is imported only after the first idle
 * moment (never on the home page's critical path); events sent before it has
 * loaded wait in a short queue. Nothing here calls `identify()`.
 */
import type { PostHog } from "posthog-js";
import { redactEventUrls } from "./redact";

const MAX_QUEUE = 50;
let client: PostHog | null = null;
let starting = false;
const queue: Array<[string, Record<string, unknown>]> = [];

export function sendToPostHog(
  name: string,
  props: Record<string, unknown>,
): void {
  if (client) {
    client.capture(name, props);
    return;
  }
  if (queue.length < MAX_QUEUE) queue.push([name, props]);
}

async function load(key: string): Promise<void> {
  const { default: posthog } = await import("posthog-js");
  posthog.init(key, {
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    persistence: "sessionStorage",
    person_profiles: "identified_only",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_conversations: true,
    disable_product_tours: true,
    disable_web_experiments: true,
    enable_heatmaps: false,
    capture_dead_clicks: false,
    rageclick: false,
    capture_performance: false,
    capture_exceptions: false,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    advanced_disable_toolbar_metrics: true,
    before_send: (event) => (event ? redactEventUrls(event) : null),
  });
  client = posthog;
  for (const [name, props] of queue.splice(0)) posthog.capture(name, props);
}

/** Starts loading PostHog once, after the browser's first idle moment. */
export function startAnalytics(): void {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || starting || typeof window === "undefined") return;
  starting = true;
  const run = () => {
    load(key).catch(() => {
      // A blocked or failed load drops analytics, never the app.
      queue.length = 0;
    });
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 4000 });
  } else {
    setTimeout(run, 2000);
  }
}
