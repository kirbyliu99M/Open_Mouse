/**
 * Said next to every measured number on a scan screen. The measurements are
 * an estimate from a photo, and the screen says so instead of implying
 * otherwise. Wording decided by Kirby on 2026-10-03 (docs/STATUS.md, decisions
 * log): it does not mention a ruler or any accuracy figure, only that the
 * measurements are still being validated.
 */
export const UNVERIFIED_MEASUREMENT_NOTE =
  "Measurements are still being validated.";

/**
 * The sheet's line for a scan result: the two numbers, and, when the hand
 * length was typed (`calibration.method === "user-length"`), that number as
 * the entered one. `calibration` is a `ScanSubmission`'s, whose variants do not
 * all carry a `method`.
 */
export function measuredSheetNumbers(
  measurements: { readonly handLengthMm: number; readonly palmWidthMm: number },
  calibration: object,
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
}): string {
  const length =
    input.enteredLengthMm === undefined
      ? `Hand length ${input.handLengthMm.toFixed(0)}\u00A0mm`
      : `Hand length ${input.enteredLengthMm.toFixed(0)}\u00A0mm (entered)`;
  return `${length} · Palm width ${input.palmWidthMm.toFixed(0)}\u00A0mm`;
}
