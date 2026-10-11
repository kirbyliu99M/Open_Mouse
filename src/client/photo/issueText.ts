/**
 * The words shown for a photo problem. A `PipelineIssue` / `GateFailure`
 * carries an English `message` (the attempt log and the unit tests read it)
 * and a `code`; the screen shows `issueText(issue, locale)`.
 *
 * English returns the issue's own message, byte for byte. Any other locale
 * looks the `code` up in `src/lib/copy/scan-issues.ts`. A few messages carry
 * a detail the code does not (which hand was seen, how a handedness mismatch
 * is fixed, the hand length that was typed): those are read back out of the
 * English message with the narrow patterns below, which the unit tests run
 * against the real messages the gates build. A code this module does not know
 * falls back to the English message rather than showing nothing.
 *
 * Pure: `locale` is an argument.
 */
import type { Locale } from "../../lib/contracts/locale";
import { scanCommonCopy } from "../../lib/copy/scan-common";
import { scanIssuesCopy } from "../../lib/copy/scan-issues";

export interface IssueLike {
  readonly code: string;
  readonly message: string;
}

const MISMATCH =
  /^This looks like your (left|right) hand, but you selected (left|right)\..* or (.*)\.$/;
const TYPED_LENGTH = /^Your palm doesn't fit the (.+?) mm you entered\./;

export function issueText(issue: IssueLike, locale: Locale): string {
  if (locale === "en") return issue.message;
  const words = scanIssuesCopy(locale);
  switch (issue.code) {
    case "MARKERS_MISSING":
      return words.markersMissing;
    case "HAND_NOT_DETECTED":
      return words.handNotDetected;
    case "HANDEDNESS_MISMATCH": {
      const m = MISMATCH.exec(issue.message);
      if (!m) return issue.message;
      const fix = m[3] === "tap the hand button below" ? "button" : "picker";
      return words.handednessMismatch(
        m[1] as "left" | "right",
        m[2] as "left" | "right",
        fix,
      );
    }
    case "LOW_LANDMARK_CONFIDENCE":
      return words.lowLandmarkConfidence;
    case "HAND_OUT_OF_BOUNDS":
      return words.handOutOfBounds;
    case "REPROJECTION_ERROR":
      return words.reprojectionError;
    case "CARD_SCALE_MISMATCH":
      return words.cardScaleMismatch;
    case "PAPER_NOT_FOUND":
      return words.paperNotFound;
    case "PAPER_CORNER_HIDDEN":
      return words.paperCornerHidden;
    case "PAPER_EDGE_HIDDEN":
      return words.paperEdgeHidden;
    case "PAPER_CURLED":
      return words.paperCurled;
    case "LOW_SHARPNESS":
      return words.lowSharpness;
    case "MEASUREMENT_OUT_OF_RANGE": {
      const typed = TYPED_LENGTH.exec(issue.message);
      return typed
        ? words.measurementOutOfRangeTyped(typed[1])
        : words.measurementImplausible;
    }
    case "FINGER_NOT_STRAIGHT":
      return words.fingerNotStraight;
    case "HAND_TILTED":
      return words.handTilted;
    case "DECODE_FAILED":
      return words.decodeFailed;
    case "DETECTOR_LOAD_FAILED":
    case "detector_load_failed":
      return scanCommonCopy(locale).detectorLoadFailed;
    case "PROCESSING_FAILED":
    case "processing_failed":
      return words.processingFailed;
    case "UNEXPECTED":
      return words.unexpected;
    default:
      return issue.message;
  }
}
