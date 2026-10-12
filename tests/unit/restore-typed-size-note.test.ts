import { describe, expect, it } from "vitest";
import {
  parseStoredManualEntry,
  parseStoredUserLength,
  resultLengthKey,
  resultManualEntryKey,
  restoreTypedSizeNote,
} from "../../src/components/results/userLengthDisclosure";

/**
 * The results page reads "you typed this size" from this browser. A typed scan
 * opened from the profile page on another device gets the note put back first.
 */

const SCAN = "a1b2c3d4-1111-4a2b-8c3d-9e0f1a2b3c4d";
const measurements = { handLengthMm: 185, palmWidthMm: 82 };

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe("restoreTypedSizeNote", () => {
  it("puts back a manual-entry pair: hand length and palm width of the scan", () => {
    const storage = memoryStorage();
    const key = restoreTypedSizeNote(storage, {
      scanId: SCAN,
      calibrationMethod: "manual-entry",
      measurements,
    });
    expect(key).toBe(resultManualEntryKey(SCAN));
    expect(parseStoredManualEntry(storage.getItem(key!))).toEqual({
      handLengthMm: 185,
      handWidthMm: 82,
    });
  });

  it("puts back a typed hand length for a user-length scan", () => {
    const storage = memoryStorage();
    const key = restoreTypedSizeNote(storage, {
      scanId: SCAN,
      calibrationMethod: "user-length",
      measurements,
    });
    expect(key).toBe(resultLengthKey(SCAN));
    expect(parseStoredUserLength(storage.getItem(key!))).toBe(185);
  });

  it("writes nothing for a scan calibrated on paper, or one with no method", () => {
    for (const calibrationMethod of ["printed-sheet", "paper-edge", null]) {
      const storage = memoryStorage();
      expect(
        restoreTypedSizeNote(storage, {
          scanId: SCAN,
          calibrationMethod,
          measurements,
        }),
      ).toBeNull();
      expect(storage.map.size).toBe(0);
    }
  });

  it("leaves a key that is already there alone", () => {
    const storage = memoryStorage({
      [resultManualEntryKey(SCAN)]: JSON.stringify({
        handLengthMm: 190,
        handWidthMm: 85,
      }),
    });
    expect(
      restoreTypedSizeNote(storage, {
        scanId: SCAN,
        calibrationMethod: "manual-entry",
        measurements,
      }),
    ).toBeNull();
    expect(
      parseStoredManualEntry(storage.getItem(resultManualEntryKey(SCAN))),
    ).toEqual({ handLengthMm: 190, handWidthMm: 85 });
  });
});
