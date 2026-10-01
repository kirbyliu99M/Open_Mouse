/**
 * QR module matrix for a kit code, drawn by the print pages as millimetre
 * rects (no raster, so the printed code is as sharp as the printer allows).
 * Error correction M: two copies are printed per top-down page, so one
 * covered code is recovered by the other rather than by more redundancy.
 */
import QRCode from "qrcode";

/** Quiet zone the QR standard requires around the code, in modules. */
export const QR_QUIET_MODULES = 4;

export interface QrMatrix {
  /** Modules per side, excluding the quiet zone. */
  readonly size: number;
  /** Row-major; `true` = dark module. */
  readonly dark: readonly (readonly boolean[])[];
}

export function qrMatrix(text: string): QrMatrix {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const dark: boolean[][] = [];
  for (let y = 0; y < size; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < size; x++) row.push(qr.modules.get(y, x) === 1);
    dark.push(row);
  }
  return { size, dark };
}

/**
 * Horizontal runs of dark modules, one rect per run: about a third of the
 * rects a module-per-rect drawing needs, which keeps the multi-page print
 * route light.
 */
export function qrDarkRuns(
  matrix: QrMatrix,
): readonly { readonly x: number; readonly y: number; readonly w: number }[] {
  const runs: { x: number; y: number; w: number }[] = [];
  matrix.dark.forEach((row, y) => {
    let start = -1;
    row.forEach((isDark, x) => {
      if (isDark && start < 0) start = x;
      if ((!isDark || x === row.length - 1) && start >= 0) {
        const end = isDark ? x + 1 : x;
        runs.push({ x: start, y, w: end - start });
        start = -1;
      }
    });
  });
  return runs;
}
