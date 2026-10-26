/**
 * The measured numbers a scan screen shows. Until 2026-10-26 a line beside
 * them said the measurements were still being validated (Kirby, 2026-10-03);
 * Kirby removed it on 2026-10-26 after the validation tests. The file keeps
 * its old name.
 */
import {
  engineScaleMeasurements,
  parallaxCorrectedOf,
} from "../../lib/fit/fit-scale";
import type { Locale } from "../../lib/contracts/locale";
import { scanCommonCopy } from "../../lib/copy/scan-common";

/**
 * The sheet's line for a scan result: the two numbers, and, when the hand
 * length was typed (`calibration.method === "user-length"`), that number as
 * the entered one. `calibration` is a `ScanSubmission`'s, whose variants do not
 * all carry a `method`.
 */
export function measuredSheetNumbers(
  measurements: { readonly handLengthMm: number; readonly palmWidthMm: number },
  calibration: object,
  locale: Locale,
): string {
  const entered =
    "method" in calibration &&
    calibration.method === "user-length" &&
    "referenceMm" in calibration &&
    typeof calibration.referenceMm === "number"
      ? calibration.referenceMm
      : undefined;
  // landmark-raw-v3 (candidate, D1 = B): a parallax-corrected scan is shown
  // on the engine's scale, the numbers the recommendation reads.
  const shown = engineScaleMeasurements(
    {
      handLengthMm: measurements.handLengthMm,
      palmLengthMm: Number.NaN,
      palmWidthMm: measurements.palmWidthMm,
    },
    parallaxCorrectedOf(calibration),
  );
  return measuredNumbersText({
    handLengthMm: shown.handLengthMm,
    palmWidthMm: shown.palmWidthMm,
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
  readonly locale: Locale;
}): string {
  const entered = input.enteredLengthMm !== undefined;
  return scanCommonCopy(input.locale).measuredNumbers({
    handLength: (entered
      ? (input.enteredLengthMm as number)
      : input.handLengthMm
    ).toFixed(0),
    palmWidth: input.palmWidthMm.toFixed(0),
    entered,
  });
}
