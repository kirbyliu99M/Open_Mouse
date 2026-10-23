import type { AttemptRecord } from "../../../src/client/camera/attemptLog";

/**
 * V3.2 F15 (candidate): confirming the frame that opened by itself on a
 * measured photo writes a second local record (`cornerCheck` set) after the
 * analysis record (`cornerCheck: null`). An e2e that reads the attempt log
 * after that confirm sees both, so it picks them apart here instead of
 * assuming one record. Order in the log is not relied on.
 */
export function splitAttempts(records: readonly unknown[] | null): {
  readonly analyses: readonly AttemptRecord[];
  readonly cornerChecks: readonly AttemptRecord[];
} {
  const all = (records ?? []).filter(
    (r): r is AttemptRecord => typeof r === "object" && r !== null,
  );
  return {
    analyses: all.filter((r) => r.cornerCheck == null),
    cornerChecks: all.filter((r) => r.cornerCheck != null),
  };
}

/**
 * How many records the log should hold once a photo's sheet is shown after
 * `confirmAutoFrameIfShown`: the analysis, plus one corner record when the
 * photo was measured (the frame opened by itself and was confirmed).
 */
export function expectedRecordsAfterConfirm(measured: boolean): number {
  return measured ? 2 : 1;
}
