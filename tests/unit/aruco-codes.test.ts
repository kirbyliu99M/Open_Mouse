import { describe, expect, it } from "vitest";
import {
  ARUCO_GRID_SIZE,
  ARUCO_MIP_36H12_CODES,
  markerBitGrid,
} from "../../src/client/sheet/aruco-codes";

describe("vendored ARUCO_MIP_36h12 codes", () => {
  it.each([0, 1, 2, 3, 4, 5])("marker id %d is a valid 36-bit code", (id) => {
    expect(ARUCO_MIP_36H12_CODES[id]).toHaveLength(
      ARUCO_GRID_SIZE * ARUCO_GRID_SIZE,
    );
    expect(ARUCO_MIP_36H12_CODES[id]).toMatch(/^[01]{36}$/);
  });

  it("marker id 0's bit grid matches js-aruco2's own dictionary data", async () => {
    // Import the real dependency directly, as ground truth, rather than
    // trusting the vendored transcription in aruco-codes.ts by eye.
    const arucoMain = await import("js-aruco2/src/aruco.js");
    await import("js-aruco2/src/dictionaries/aruco_mip_36h12.js"); // side effect: registers the dictionary

    const dictionary = arucoMain.default.AR.DICTIONARIES.ARUCO_MIP_36h12;
    expect(dictionary).toBeDefined();
    expect(dictionary.nBits).toBe(ARUCO_GRID_SIZE * ARUCO_GRID_SIZE);

    const expectedBits = dictionary.codeList[0]
      .toString(2)
      .padStart(dictionary.nBits, "0");
    expect(ARUCO_MIP_36H12_CODES[0]).toBe(expectedBits);

    const grid = markerBitGrid(0);
    for (let y = 0; y < ARUCO_GRID_SIZE; y++) {
      for (let x = 0; x < ARUCO_GRID_SIZE; x++) {
        expect(grid[y][x]).toBe(expectedBits[y * ARUCO_GRID_SIZE + x] === "1");
      }
    }
  });

  it("all six vendored codes match js-aruco2's dictionary data", async () => {
    const arucoMain = await import("js-aruco2/src/aruco.js");
    await import("js-aruco2/src/dictionaries/aruco_mip_36h12.js");
    const dictionary = arucoMain.default.AR.DICTIONARIES.ARUCO_MIP_36h12;

    for (let id = 0; id <= 5; id++) {
      const expectedBits = dictionary.codeList[id]
        .toString(2)
        .padStart(dictionary.nBits, "0");
      expect(ARUCO_MIP_36H12_CODES[id]).toBe(expectedBits);
    }
  });

  it("throws a clear error for an id with no vendored code", () => {
    expect(() => markerBitGrid(6)).toThrow(/no ARUCO_MIP_36h12 code/i);
  });
});
