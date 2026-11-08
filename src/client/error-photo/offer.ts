/**
 * The easy scan's offer to send its photo (candidate 未拍板,
 * src/lib/contracts/error-photo.ts): the shared synchronous rule
 * (src/lib/error-photo/offerable.ts, which the camera's reserved row uses
 * too, review K2) plus what the sheet needs from the result: its overlay and
 * its failure code. Pure, unit-tested (tests/unit/error-photo-offer.test.ts).
 *
 * Whether the offer is then actually usable also waits for the prepared copy
 * (prepare.ts): a photo that cannot be prepared is never sent.
 */
import { errorPhotoFailureCode } from "../../lib/contracts/error-photo";
import {
  errorPhotoOfferable,
  type ErrorPhotoTrigger,
  type OfferableInput,
} from "../../lib/error-photo/offerable";
import type { ErrorPhotoMode, ErrorPhotoOverlay } from "./prepare";

export { NO_OFFER_FAILURE_CODES } from "../../lib/error-photo/offerable";
export type { ErrorPhotoTrigger };

export type OfferInput = OfferableInput;

export interface Offer {
  readonly trigger: ErrorPhotoTrigger;
  readonly mode: ErrorPhotoMode;
  readonly overlay: ErrorPhotoOverlay;
  /** The first failure code, when it fits the contract's format. */
  readonly failureCode?: string;
}

/** What the screen may offer to send, or `null`. */
export function errorPhotoOffer(input: OfferInput): Offer | null {
  const offerable = errorPhotoOfferable(input);
  const r = input.result;
  if (!offerable || (r.kind !== "measured" && r.kind !== "gateFailure"))
    return null;
  if (!r.overlay) return null;
  const code = r.kind === "gateFailure" ? r.errors[0]?.code : undefined;
  return {
    ...offerable,
    overlay: r.overlay,
    ...(code !== undefined && errorPhotoFailureCode.safeParse(code).success
      ? { failureCode: code }
      : {}),
  };
}
