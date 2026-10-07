"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { startAnalytics } from "./client";
import { track } from "./track";

/** Starts PostHog once and sends `$pageview` on each App Router path change. */
export function AnalyticsProvider() {
  const pathname = usePathname();
  useEffect(() => {
    startAnalytics();
  }, []);
  useEffect(() => {
    track("$pageview", {});
  }, [pathname]);
  return null;
}
