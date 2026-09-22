"use client";

import { useEffect } from "react";

export const SESSION_DELETE_URL = "/api/scans/session";

/**
 * Pure decision extracted out of the `pagehide` handler so it is
 * unit-testable without a DOM (issue #17 — "the beacon is anonymous-only").
 * `anonymous` is decided server-side (root layout calls `auth()`) so this
 * never has to guess from anything a client script could spoof, and a
 * signed-in caller can never reach the `sendBeacon` call at all — not just
 * "chooses not to".
 */
export function onPageHideBeacon(
  anonymous: boolean,
  sendBeacon: (url: string) => void,
): void {
  if (!anonymous) return;
  sendBeacon(SESSION_DELETE_URL);
}

/**
 * Issue #17: `navigator.sendBeacon` to the session-delete endpoint on
 * `pagehide`, **anonymous users only** — a signed-in user's scans must
 * survive closing the tab ("Kept until you delete it").
 *
 * `sendBeacon` can only issue a POST; `POST /api/scans/session` performs the
 * identical idempotent delete as `DELETE /api/scans/session`.
 */
export function BeaconOnUnload({ anonymous }: { anonymous: boolean }) {
  useEffect(() => {
    const onPageHide = () => {
      onPageHideBeacon(anonymous, (url) => navigator.sendBeacon(url));
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [anonymous]);

  return null;
}
