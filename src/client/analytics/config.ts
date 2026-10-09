import type { PostHogConfig } from "posthog-js";
import { beforeSend } from "./redact";

/**
 * The posthog-js config (issue #138): no autocapture, replay, heatmaps,
 * surveys, flags, remote config or external script loading; sessionStorage,
 * no cookies; events through the same-origin /ingest handler.
 */
export function buildPostHogConfig(): Partial<PostHogConfig> {
  return {
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
    before_send: beforeSend,
  };
}
