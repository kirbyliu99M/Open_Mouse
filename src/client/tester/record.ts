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

/** Recorded when the tester gives up before any analysis ended. */
export const NO_ANALYSIS_CODE = "NO_ANALYSIS";
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
  if (gaveUp && input.attempts.length === 0)
    failureCodes.push(NO_ANALYSIS_CODE);
  const attempts = Math.min(MAX_ATTEMPTS, Math.max(1, input.attempts.length));
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
