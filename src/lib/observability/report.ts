/**
 * Reports an error the app catches and recovers from, so Sentry still hears
 * about it: unhandled errors reach Sentry on their own (the SDK's global
 * handlers, `onRequestError`, the error boundaries), but a `catch` that shows
 * the user a retake message swallows the error. Use it only where the failure
 * is a fault (a detector that will not load, a camera that will not open), not
 * an expected outcome (a blurry photo, a measurement out of range).
 *
 * `where` is a short fixed tag ("easy-scan.process"), searchable in Sentry.
 * The event is scrubbed by src/lib/observability/sentry.ts like any other.
 */
import * as Sentry from "@sentry/nextjs";

export function reportCaught(error: unknown, where: string): void {
  Sentry.captureException(error, { tags: { where } });
}

/** A camera the user chose to block is their decision, not a fault. */
export function isCameraPermissionDenial(error: unknown): boolean {
  const name = error instanceof DOMException ? error.name : undefined;
  return name === "NotAllowedError" || name === "PermissionDeniedError";
}
