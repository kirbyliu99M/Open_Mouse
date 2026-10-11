/**
 * Said next to every measured number on a scan screen. The measurements are
 * an estimate from a photo, and the screen says so instead of implying
 * otherwise. Wording decided by Kirby on 2026-10-03 (docs/STATUS.md, decisions
 * log): it does not mention a ruler or any accuracy figure, only that the
 * measurements are still being validated.
 */
import type { Locale } from "../../lib/contracts/locale";
import { scanCommonCopy } from "../../lib/copy/scan-common";
export const UNVERIFIED_MEASUREMENT_NOTE = scanCommonCopy("en").unverifiedNote;

/**
 * The sheet's line for a scan result: the two numbers, and, when the hand
 * length was typed (`calibration.method === "user-length"`), that number as
 * the entered one. `calibration` is a `ScanSubmission`'s, whose variants do not
 * all carry a `method`.
 */
export function measuredSheetNumbers(
  measurements: { readonly handLengthMm: number; readonly palmWidthMm: number },
  calibration: object,
  locale: Locale = "en",
): string {
  const entered =
    "method" in calibration &&
    calibration.method === "user-length" &&
    "referenceMm" in calibration &&
    typeof calibration.referenceMm === "number"
      ? calibration.referenceMm
      : undefined;
  return measuredNumbersText({
    handLengthMm: measurements.handLengthMm,
    palmWidthMm: measurements.palmWidthMm,
    ...(entered === undefined ? {} : { enteredLengthMm: entered }),
    locale,
  });
}

/**
 * The two numbers, as text a screen reader reads (the drawing on the photo
 * shows them too, but it is an image). `enteredLengthMm` is set when the
 * hand length was typed rather than measured: it is then the reference the
 * palm width is scaled from, and is said to be entered. Whole millimetres,
 * as on the drawing. Wording: Kirby decided on 2026-10-03 that the remaining
 * copy ships as it is and is adjusted later (docs/STATUS.md, decisions log).
 */
export function measuredNumbersText(input: {
  readonly handLengthMm: number;
  readonly palmWidthMm: number;
  readonly enteredLengthMm?: number;
  readonly locale?: Locale;
}): string {
  const entered = input.enteredLengthMm !== undefined;
  return scanCommonCopy(input.locale ?? "en").measuredNumbers({
    handLength: (entered
      ? (input.enteredLengthMm as number)
      : input.handLengthMm
    ).toFixed(0),
    palmWidth: input.palmWidthMm.toFixed(0),
    entered,
  });
}
