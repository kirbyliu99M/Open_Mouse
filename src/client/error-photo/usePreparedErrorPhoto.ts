"use client";

import { useEffect, useState } from "react";
import type { Offer } from "./offer";
import { prepareErrorPhoto, type PreparedErrorPhoto } from "./prepare";

/**
 * The prepared copy for an offer (prepare.ts), worked out in the background
 * once the screen offers it; `null` until it is ready and whenever it cannot
 * be made, so the button only appears for a photo that can really be sent.
 * Held in memory only: nothing is written to storage, and a new photo or a
 * retake drops it.
 */
export function usePreparedErrorPhoto(
  file: Blob | null,
  offer: Offer | null,
): PreparedErrorPhoto | null {
  const [prepared, setPrepared] = useState<{
    readonly key: object;
    readonly photo: PreparedErrorPhoto;
  } | null>(null);
  const overlay = offer?.overlay ?? null;
  const mode = offer?.mode ?? null;

  useEffect(() => {
    if (!file || !overlay || !mode) return;
    let cancelled = false;
    // After the screen has painted: the result comes first.
    const timer = window.setTimeout(() => {
      void prepareErrorPhoto({ file, overlay, mode }).then((photo) => {
        if (!cancelled && photo) setPrepared({ key: overlay, photo });
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [file, overlay, mode]);

  // A copy prepared for another photo or overlay is never shown.
  return prepared && overlay && prepared.key === overlay
    ? prepared.photo
    : null;
}
