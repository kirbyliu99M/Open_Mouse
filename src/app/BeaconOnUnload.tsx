"use client";

import { useEffect } from "react";

/**
 * Issue #17: `navigator.sendBeacon` to the session-delete endpoint on
 * `pagehide`, **anonymous users only** — a signed-in user's scans must
 * survive closing the tab ("Kept until you delete it"). `anonymous` is
 * decided server-side (root layout calls `auth()`) so this component never
 * has to guess from anything a client script could spoof.
 *
 * `sendBeacon` can only issue a POST; `POST /api/scans/session` performs the
 * identical idempotent delete as `DELETE /api/scans/session`.
 */
export function BeaconOnUnload({ anonymous }: { anonymous: boolean }) {
  useEffect(() => {
    if (!anonymous) return;
    const onPageHide = () => {
      navigator.sendBeacon("/api/scans/session");
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [anonymous]);

  return null;
}
