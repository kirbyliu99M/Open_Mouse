"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Reports the error an error boundary caught to Sentry, once per error. An
 * error boundary swallows the error, so the SDK's global handlers never see
 * it. Renders nothing. A child component rather than a hook in the screen, so
 * the screens stay plain functions of their props.
 */
export function ReportError({ error }: { error: Error }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return null;
}
