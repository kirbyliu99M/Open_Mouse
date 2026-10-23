"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useConsent } from "@/client/consent/consent";
import { startAnalytics } from "./client";
import { disableGa4, enableGa4, ga4Configured, ga4PageView } from "./ga4";
import { track } from "./track";

/**
 * Starts PostHog once and sends `$pageview` on each App Router path change.
 * GA4 follows the cookie choice: loaded on "granted", switched off (and its
 * cookies deleted) on "denied", and never loaded before a choice is made.
 */
export function AnalyticsProvider() {
  const pathname = usePathname();
  const consent = useConsent();
  const ga4On = ga4Configured() && consent === "granted";
  useEffect(() => {
    startAnalytics();
  }, []);
  useEffect(() => {
    track("$pageview", {});
  }, [pathname]);
  useEffect(() => {
    if (ga4On) enableGa4();
    else if (consent === "denied") disableGa4();
  }, [ga4On, consent]);
  // After the effect above, so GA4 is active by the time the first page
  // view is sent; again on every route change and when consent is given.
  useEffect(() => {
    if (ga4On) ga4PageView();
  }, [pathname, ga4On]);
  return null;
}
