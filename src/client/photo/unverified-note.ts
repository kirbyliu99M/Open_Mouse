/**
 * Said next to every measured number on a scan screen. The measurements are
 * an estimate from a photo that has not been checked against a physical
 * ruler yet (docs/PLAN.md, M2), and the screen should say so instead of
 * implying otherwise. Candidate wording, pending Kirby's confirmation.
 */
export const UNVERIFIED_MEASUREMENT_NOTE = "Not yet verified against a ruler.";

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
 * as on the drawing. Candidate wording, pending Kirby's confirmation.
 */
export function measuredNumbersText(input: {
  readonly handLengthMm: number;
  readonly palmWidthMm: number;
  readonly enteredLengthMm?: number;
}): string {
  const length =
    input.enteredLengthMm === undefined
      ? `Hand length ${input.handLengthMm.toFixed(0)} mm`
      : `Hand length ${input.enteredLengthMm.toFixed(0)} mm (entered)`;
  return `${length} · Palm width ${input.palmWidthMm.toFixed(0)} mm`;
}
