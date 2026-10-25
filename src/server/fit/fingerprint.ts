import { createHash } from "node:crypto";
import type { FitResponse } from "../../lib/contracts/fit";
import { RESULT_FINGERPRINT_HEADER } from "../../lib/contracts/routes";

/**
 * V3.2 F1 (candidate, 未拍板; Astra A1-04): the fingerprint of the ranking a
 * fit response shows (`resultFingerprintSchema`, fit.ts). The analysis and
 * feedback routes recompute the fit; when the page sends the fingerprint of
 * the fit it is showing and the recomputed one differs (a survey edited in
 * another tab, an engine switch), the request is refused with 412 instead of
 * being answered for a ranking the person is not looking at.
 *
 * Pure. The hash covers exactly four things:
 *   - the engine version that actually ran;
 *   - the score mode (scored, or unscored when the hand is outside the
 *     catalogue's length range);
 *   - the three targets the engine used, rounded to 0.1 mm (after any personal
 *     calibration, so a changed calibration changes it);
 *   - the slugs of the first `RESULT_FINGERPRINT_TOP_PLACES` places, in order.
 * Nothing else: no survey answer, no satisfaction rating, no calibration
 * shift, no measured hand number. Sixteen hex characters of a SHA-256 can be
 * compared, not read back; it is not a number anyone is shown.
 */
export const RESULT_FINGERPRINT_TOP_PLACES = 5;

/** Bumped only if what goes into the hash changes, so old and new never collide. */
const FINGERPRINT_FORMAT = "result-fingerprint/1";

export interface ResultFingerprintInput {
  engineVersion: string;
  scored: boolean;
  targets: { lengthMm: number; gripWidthMm: number; heightMm: number };
  /** Slugs in ranked order; only the first five are read. */
  rankedSlugs: readonly string[];
}

/** A target in whole tenths of a millimetre (so 0.1 mm rounding never meets float text). */
function tenths(mm: number): number {
  const value = Math.round(mm * 10);
  // -0 and 0 must hash alike.
  return value === 0 ? 0 : value;
}

export function resultFingerprint(input: ResultFingerprintInput): string {
  const payload = JSON.stringify([
    FINGERPRINT_FORMAT,
    input.engineVersion,
    input.scored ? "scored" : "unscored",
    tenths(input.targets.lengthMm),
    tenths(input.targets.gripWidthMm),
    tenths(input.targets.heightMm),
    input.rankedSlugs.slice(0, RESULT_FINGERPRINT_TOP_PLACES),
  ]);
  return createHash("sha256")
    .update(payload, "utf8")
    .digest("hex")
    .slice(0, 16);
}

/** The parts of a fit (or an engine output with grouped results) the fingerprint reads. */
export type FingerprintSource = Pick<
  FitResponse,
  "engineVersion" | "targets" | "coverage"
> & { results: readonly { mouse: { slug: string } }[] };

/** The fingerprint of a fit as the page shows it (results in their shown order). */
export function fingerprintOfFit(fit: FingerprintSource): string {
  return resultFingerprint({
    engineVersion: fit.engineVersion,
    // The same rule every consumer uses for "scores hidden".
    scored: fit.coverage?.lengthOutOfRange !== true,
    targets: fit.targets,
    rankedSlugs: fit.results
      .slice(0, RESULT_FINGERPRINT_TOP_PLACES)
      .map((entry) => entry.mouse.slug),
  });
}

/**
 * Does a request's `x-result-fingerprint` header disagree with the fit just
 * recomputed? No header: false (an older page, behaviour unchanged). A header
 * that is present, including an empty or malformed one, must equal it.
 */
export function fingerprintMismatch(
  headers: Headers,
  recomputed: string,
): boolean {
  const sent = headers.get(RESULT_FINGERPRINT_HEADER);
  if (sent === null) return false;
  return sent.trim() !== recomputed;
}

/**
 * The 412 body (`errorResponseSchema`). Pages never show a server's error text
 * (fetchResults.ts); this is for logs and API readers only.
 */
export const STALE_RESULT_ERROR =
  "The results have changed since this page loaded. Fetch the fit again.";
