/**
 * Whether a scan result can offer its photo (candidate 未拍板,
 * src/lib/contracts/error-photo.ts): the ONE synchronous rule (review #241
 * round 3, K2), shared by the lazy offer (src/client/error-photo/offer.ts)
 * and the camera's reserved row (EasyScanCamera.tsx), so a row is kept
 * exactly where a link can appear. Everything but the asynchronous copy
 * preparation is decided here. Pure, type-only imports, no copy text: it is
 * small enough to sit in the scan's first load (the error-photo lane itself
 * stays behind the guarded import). Tested in tests/unit/error-photo-offer.test.ts.
 *
 *  - "scan-failed": a failure screen whose analysis left something on the
 *    photo (hand landmarks or reference corners). Never for a photo that could
 *    not be decoded or analysed at all (`DECODE_FAILED`,
 *    `DETECTOR_LOAD_FAILED`, `PROCESSING_FAILED`, `UNEXPECTED`): nothing was
 *    found to crop around, and the cause is not the photo.
 *  - "numbers-wrong": a measured sheet, once any card outline question has
 *    been answered (the outline it asks about is what gets blacked out).
 *  - Card mode with no card outline: never (the card could not be covered).
 */

export const NO_OFFER_FAILURE_CODES: ReadonlySet<string> = new Set([
  "DECODE_FAILED",
  "DETECTOR_LOAD_FAILED",
  "PROCESSING_FAILED",
  "UNEXPECTED",
]);

export type ErrorPhotoTrigger = "scan-failed" | "numbers-wrong";
export type ErrorPhotoMode = "paper" | "card";

interface Pt {
  readonly x: number;
  readonly y: number;
}

/** What the analysis left on the photo (`PhotoOverlay`'s fields that matter here). */
export interface OfferableOverlay {
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly landmarksPx: readonly Pt[] | null;
  /** The sheet's corners, or the card's in card mode. */
  readonly paperCorners?: readonly Pt[] | null;
  readonly paperPartialCorners?: readonly (Pt | null)[];
  readonly paperGuessCorners?: readonly Pt[];
}

export type OfferableResult =
  | { readonly kind: "none" | "processing" }
  | {
      readonly kind: "measured";
      readonly overlay: OfferableOverlay;
      readonly cardCheck?: "pending";
      readonly reference?: "card";
    }
  | {
      readonly kind: "gateFailure";
      readonly overlay: OfferableOverlay | null;
      readonly errors: readonly { readonly code: string }[];
      readonly reference?: "card";
    };

export interface OfferableInput {
  /** The flag (each caller passes its own folded constant). */
  readonly enabled: boolean;
  readonly result: OfferableResult;
}

function foundSomething(overlay: OfferableOverlay, mode: ErrorPhotoMode) {
  const corners = (overlay.paperCorners ?? []).length;
  if (mode === "card") return corners === 4;
  return (
    (overlay.landmarksPx?.length ?? 0) > 0 ||
    corners > 0 ||
    (overlay.paperPartialCorners ?? []).some((p) => p !== null) ||
    (overlay.paperGuessCorners ?? []).length > 0
  );
}

/** The trigger and mode this result could offer, or `null` (no link, no row). */
export function errorPhotoOfferable(input: OfferableInput): {
  readonly trigger: ErrorPhotoTrigger;
  readonly mode: ErrorPhotoMode;
} | null {
  if (!input.enabled) return null;
  const r = input.result;
  if (r.kind === "measured") {
    if (r.cardCheck === "pending") return null;
    const mode: ErrorPhotoMode = r.reference === "card" ? "card" : "paper";
    return foundSomething(r.overlay, mode)
      ? { trigger: "numbers-wrong", mode }
      : null;
  }
  if (r.kind === "gateFailure") {
    if (!r.overlay) return null;
    const code = r.errors[0]?.code;
    if (code !== undefined && NO_OFFER_FAILURE_CODES.has(code)) return null;
    const mode: ErrorPhotoMode = r.reference === "card" ? "card" : "paper";
    return foundSomething(r.overlay, mode)
      ? { trigger: "scan-failed", mode }
      : null;
  }
  return null;
}
