/**
 * ARUCO_MIP_36h12 dictionary codes for marker ids 0–5, vendored from the
 * `js-aruco2` npm package (dependency, exact version 2.0.0), file
 * `js-aruco2/src/dictionaries/aruco_mip_36h12.js`. That file's own header
 * credits "Dictionary extracted from
 * https://sourceforge.net/projects/aruco/files/3.1.12/" (the original
 * ArUco 3.1.12 library, Rafael Muñoz Salinas, BSD 2-Clause).
 *
 * Why vendored instead of imported live: js-aruco2 ships no TypeScript
 * types, and its dictionary/main files are plain CommonJS that populate a
 * shared `AR` namespace via `this.AR = AR` (relying on top-level `this`
 * being `module.exports`) rather than an explicit, bundler-recognised
 * named export — `import { AR } from "js-aruco2"` finds nothing, and the
 * dictionary file is a second module required only for its side effect of
 * mutating that namespace. That pattern is fine under plain Node (which
 * `tests/unit/aruco-codes.test.ts` relies on to import the real dependency
 * as ground truth), but it is not something to trust silently across this
 * app's other two build targets (Next.js dev under Turbopack, and the
 * production `next build` under webpack) without their own verification.
 * Vendoring fixed, tested constants here removes that risk entirely from
 * the printed sheet's own code path.
 *
 * Each value is the dictionary's 36-bit code, row-major over the marker's
 * 6×6 data grid ('1' = white cell, '0' = black), exactly matching
 * js-aruco2's own `AR.Dictionary.prototype.generateSVG`. The printed marker
 * adds one full black border module around this 6×6 data grid, for 8×8
 * modules total — `markerSizeMm ÷ 8` per module.
 */

export const ARUCO_GRID_SIZE = 6;
export const ARUCO_MARKER_MODULES = ARUCO_GRID_SIZE + 2; // 6 data + 1 border each side

export const ARUCO_MIP_36H12_CODES: Readonly<Record<number, string>> = {
  0: "110100101011011000111010000010011101",
  1: "011000000000000100010011010011100101",
  2: "000100100000011011111011111001110010",
  3: "111111111000101011010110110010110100",
  4: "100001011101101010011011110001001001",
  5: "101101000110000110101111111010011100",
};

/**
 * The marker's 6×6 data grid as booleans (`true` = white cell), row-major
 * (`grid[y][x]`).
 */
export function markerBitGrid(id: number): boolean[][] {
  const code = ARUCO_MIP_36H12_CODES[id];
  if (code === undefined) {
    throw new RangeError(
      `No ARUCO_MIP_36h12 code is vendored for marker id ${id}. Only ids 0–5 are.`,
    );
  }
  const grid: boolean[][] = [];
  for (let y = 0; y < ARUCO_GRID_SIZE; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < ARUCO_GRID_SIZE; x++) {
      row.push(code[y * ARUCO_GRID_SIZE + x] === "1");
    }
    grid.push(row);
  }
  return grid;
}
