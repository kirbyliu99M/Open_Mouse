/**
 * One shot's record (contract `testerRecordSchema`), pure: from the tape, the
 * shot's conditions, the attempts the camera reported, and the measured
 * result (absent when the tester gave up). Unit-tested in
 * tests/unit/tester-client.test.ts.
 */
import {
  TESTER_CONSENT_VERSION,
  testerRecordSchema,
  type TESTER_CARD_TYPES,
  type TESTER_LIGHTING,
  type TESTER_REFERENCES,
  type TESTER_SURFACES,
  type TesterRecord,
} from "../../lib/contracts/tester";
import {
  calibrationMethodOf,
  type ScanSubmission,
} from "../../lib/contracts/measurement";
import type { TesterScanAttempt } from "../camera/testerMode";
import type { TesterTape } from "./tape";

export interface ShotConditions {
  readonly phoneModel: string;
  readonly surface: (typeof TESTER_SURFACES)[number];
  readonly lighting: (typeof TESTER_LIGHTING)[number];
  readonly reference: (typeof TESTER_REFERENCES)[number];
  readonly cardType?: (typeof TESTER_CARD_TYPES)[number];
  readonly deliberatelyPoor: boolean;
}

const MAX_ATTEMPTS = 50;
const MAX_CODES = 50;

export function buildTesterRecord(input: {
  readonly shotId: string;
  readonly tape: TesterTape;
  readonly conditions: ShotConditions;
  readonly attempts: readonly TesterScanAttempt[];
  readonly captureMode: "camera" | "upload";
  /** Absent: the tester gave up. */
  readonly measured?: {
    readonly handLengthMm: number;
    readonly palmWidthMm: number;
    readonly measurementModelVersion: string;
    readonly calibrationMethod: string;
  };
  readonly photo?: { readonly widthPx: number; readonly heightPx: number };
}): TesterRecord {
  const gaveUp = input.measured === undefined;
  const failureCodes = input.attempts
    .flatMap((a) => a.failureCodes)
    .filter((c) => /^[A-Z0-9_]{2,40}$/.test(c));
  // 0 only for a give-up before any analysis ended (the contract's rule).
  const attempts = Math.min(MAX_ATTEMPTS, input.attempts.length);
  const { cardType, ...conditions } = input.conditions;
  return testerRecordSchema.parse({
    consent: TESTER_CONSENT_VERSION,
    shotId: input.shotId,
    tape: input.tape,
    ...conditions,
    phoneModel: conditions.phoneModel.trim(),
    ...(conditions.reference === "card" && cardType ? { cardType } : {}),
    captureMode: input.captureMode,
    attempts,
    firstTryOk: !gaveUp && attempts === 1,
    failureCodes: failureCodes.slice(0, MAX_CODES),
    gaveUp,
    ...(input.measured
      ? {
          measured: {
            ...input.measured,
            measurementModelVersion:
              input.measured.measurementModelVersion.slice(0, 40),
            calibrationMethod: input.measured.calibrationMethod.slice(0, 40),
          },
        }
      : {}),
    ...(input.photo && !gaveUp ? { photo: input.photo } : {}),
  });
}

/**
 * Whether the scan used the reference the tester declared: a card shot is
 * calibrated on the card (`card-edge`) and its photo is in card mode; a paper
 * shot on the sheet's edges (`paper-edge`) of that very size. A mismatch is
 * not sent (the record's `reference` would be false).
 */
export function referenceMatches(
  reference: ShotConditions["reference"],
  calibration: ScanSubmission["calibration"],
  photoMode: "paper" | "card" | null,
): boolean {
  if (reference === "card")
    return (
      calibrationMethodOf(calibration) === "card-edge" &&
      (photoMode === null || photoMode === "card")
    );
  return (
    "method" in calibration &&
    calibration.method === "paper-edge" &&
    calibration.paperSize === reference &&
    (photoMode === null || photoMode === "paper")
  );
}
