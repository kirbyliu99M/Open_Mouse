/**
 * When the easy scan offers to send its photo (candidate 未拍板,
 * src/lib/contracts/error-photo.ts). Pure, unit-tested
 * (tests/unit/error-photo-offer.test.ts).
 *
 *  - "scan-failed": a failure screen whose analysis left something on the
 *    photo (hand landmarks or reference corners). Never for a photo that could
 *    not be decoded or analysed at all (`DECODE_FAILED`,
 *    `DETECTOR_LOAD_FAILED`, `PROCESSING_FAILED`, `UNEXPECTED`): nothing was
 *    found to crop around, and the cause is not the photo.
 *  - "numbers-wrong": a measured sheet, once any card outline question has
 *    been answered (the outline it asks about is what gets blacked out).
 *  - Card mode with no card outline: never (the card could not be covered).
 *
 * Whether the offer is then actually shown also waits for the prepared copy
 * (prepare.ts): a photo that cannot be prepared is never offered.
 */
import { errorPhotoFailureCode } from "../../lib/contracts/error-photo";
import type { ErrorPhotoMode, ErrorPhotoOverlay } from "./prepare";

export const NO_OFFER_FAILURE_CODES: ReadonlySet<string> = new Set([
  "DECODE_FAILED",
  "DETECTOR_LOAD_FAILED",
  "PROCESSING_FAILED",
  "UNEXPECTED",
]);

export type ErrorPhotoTrigger = "scan-failed" | "numbers-wrong";

export interface OfferInput {
  readonly enabled: boolean;
  readonly result:
    | { readonly kind: "none" | "processing" }
    | {
        readonly kind: "measured";
        readonly overlay: ErrorPhotoOverlay;
        readonly cardCheck?: "pending";
        readonly reference?: "card";
      }
    | {
        readonly kind: "gateFailure";
        readonly overlay: ErrorPhotoOverlay | null;
        readonly errors: readonly { readonly code: string }[];
        readonly reference?: "card";
      };
}

export interface Offer {
  readonly trigger: ErrorPhotoTrigger;
  readonly mode: ErrorPhotoMode;
  readonly overlay: ErrorPhotoOverlay;
  /** The first failure code, when it fits the contract's format. */
  readonly failureCode?: string;
}

function foundSomething(overlay: ErrorPhotoOverlay, mode: ErrorPhotoMode) {
  const corners = (overlay.paperCorners ?? []).length;
  if (mode === "card") return corners === 4;
  return (
    (overlay.landmarksPx?.length ?? 0) > 0 ||
    corners > 0 ||
    (overlay.paperPartialCorners ?? []).some((p) => p !== null) ||
    (overlay.paperGuessCorners ?? []).length > 0
  );
}

/** What the screen may offer to send, or `null`. */
export function errorPhotoOffer(input: OfferInput): Offer | null {
  if (!input.enabled) return null;
  const r = input.result;
  if (r.kind === "measured") {
    if (r.cardCheck === "pending") return null;
    const mode: ErrorPhotoMode = r.reference === "card" ? "card" : "paper";
    if (!foundSomething(r.overlay, mode)) return null;
    return { trigger: "numbers-wrong", mode, overlay: r.overlay };
  }
  if (r.kind === "gateFailure") {
    if (!r.overlay) return null;
    const code = r.errors[0]?.code;
    if (code !== undefined && NO_OFFER_FAILURE_CODES.has(code)) return null;
    const mode: ErrorPhotoMode = r.reference === "card" ? "card" : "paper";
    if (!foundSomething(r.overlay, mode)) return null;
    return {
      trigger: "scan-failed",
      mode,
      overlay: r.overlay,
      ...(code !== undefined && errorPhotoFailureCode.safeParse(code).success
        ? { failureCode: code }
        : {}),
    };
  }
  return null;
}

/**
 * Whether a result sheet keeps a row for the link, offered or not (review
 * H3): a measured sheet, or a failure whose analysis left an overlay. The
 * camera reserves the same row (inline, EasyScanCamera.tsx
 * `errorPhotoRowReserved`) before this chunk has loaded, so the buttons never
 * move. Keep the two in step.
 */
export function reservesErrorPhotoRow(result: OfferInput["result"]): boolean {
  return (
    result.kind === "measured" ||
    (result.kind === "gateFailure" && result.overlay !== null)
  );
}
