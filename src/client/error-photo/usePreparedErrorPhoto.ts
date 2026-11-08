"use client";

import { useEffect, useState } from "react";
import type { Offer } from "./offer";
import { prepareErrorPhoto, type PreparedErrorPhoto } from "./prepare";

export type PreparedState =
  | { readonly status: "pending"; readonly photo: null }
  | { readonly status: "ready"; readonly photo: PreparedErrorPhoto }
  | { readonly status: "failed"; readonly photo: null };

const PENDING: PreparedState = { status: "pending", photo: null };

/**
 * The prepared copy for an offer (prepare.ts), worked out in the background
 * once the screen offers it: `pending` until then, `ready` with the copy, or
 * `failed` when it cannot be made (the offer is then withdrawn). Held in
 * memory only: nothing is written to storage, and a new photo or a retake
 * drops it.
 */
export function usePreparedErrorPhoto(
  file: Blob | null,
  offer: Offer | null,
): PreparedState {
  const [done, setDone] = useState<{
    readonly key: object;
    readonly file: Blob;
    readonly state: PreparedState;
  } | null>(null);
  const overlay = offer?.overlay ?? null;
  const mode = offer?.mode ?? null;

  useEffect(() => {
    if (!file || !overlay || !mode) return;
    let cancelled = false;
    // After the screen has painted: the result comes first.
    const timer = window.setTimeout(() => {
      void prepareErrorPhoto({ file, overlay, mode }).then((photo) => {
        if (cancelled) return;
        setDone({
          key: overlay,
          file,
          state: photo
            ? { status: "ready", photo }
            : { status: "failed", photo: null },
        });
      });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [file, overlay, mode]);

  // A copy prepared for another photo or overlay is never shown.
  if (!file || !overlay) return { status: "failed", photo: null };
  return done && done.key === overlay && done.file === file
    ? done.state
    : PENDING;
}
