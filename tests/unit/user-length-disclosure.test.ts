import { describe, expect, it } from "vitest";
import {
  clearScanDisclosures,
  parseStoredUserLength,
  resultLengthKey,
  STORED_USER_LENGTH_MM,
} from "../../src/components/results/userLengthDisclosure";
import { resultHandKey } from "../../src/components/results/handDisclosure";
import {
  parseUserLength,
  USER_LENGTH_RANGE_MM,
} from "../../src/client/photo/user-length";
import {
  handMeasurementsSchema,
  userLengthEvidenceSchema,
} from "../../src/lib/contracts/measurement";

describe("clearScanDisclosures", () => {
  it("removes both disclosures for every listed scan and preserves unlisted scans", () => {
    const values = new Map([
      [resultLengthKey("listed-1"), "180"],
      [resultHandKey("listed-1"), "left"],
      [resultLengthKey("listed-2"), "190"],
      [resultHandKey("listed-2"), "right"],
      [resultLengthKey("unlisted"), "175"],
      [resultHandKey("unlisted"), "left"],
    ]);
    const storage = { removeItem: (key: string) => values.delete(key) };

    clearScanDisclosures(storage, ["listed-1", "listed-2"]);

    expect([...values]).toEqual([
      [resultLengthKey("unlisted"), "175"],
      [resultHandKey("unlisted"), "left"],
    ]);
  });
});

describe("parseStoredUserLength", () => {
  it("reads a stored typed length", () => {
    expect(parseStoredUserLength("186")).toBe(186);
    expect(parseStoredUserLength("186.5")).toBe(186.5);
  });

  it("rejects nothing stored and things that are not a plausible length", () => {
    for (const raw of [null, "", "  ", "abc", "NaN", "Infinity", "0", "-186"]) {
      expect(parseStoredUserLength(raw), String(raw)).toBeNull();
    }
    expect(parseStoredUserLength("99.9")).toBeNull();
    expect(parseStoredUserLength("280.1")).toBeNull();
  });

  it("is deliberately wider than the range the input accepts today, so an earlier scan keeps its note", () => {
    expect(STORED_USER_LENGTH_MM).toEqual({ min: 100, max: 280 });
    // Both lengths a build with the earlier 100-280 range would have stored.
    expect(parseStoredUserLength("100")).toBe(100);
    expect(parseStoredUserLength("280")).toBe(280);
    // ...which today's input would refuse.
    expect(parseUserLength("100")).toBeNull();
    expect(parseUserLength("280")).toBeNull();
    // And it can never be narrower than what the input accepts.
    expect(STORED_USER_LENGTH_MM.min).toBeLessThanOrEqual(
      USER_LENGTH_RANGE_MM.min,
    );
    expect(STORED_USER_LENGTH_MM.max).toBeGreaterThanOrEqual(
      USER_LENGTH_RANGE_MM.max,
    );
  });
});

describe("STORED_USER_LENGTH_MM is the measurement schema's own hand-length limit", () => {
  // A palm that fits every length in 100-280 mm, so only handLengthMm varies.
  const measurements = (handLengthMm: number) => ({
    handLengthMm,
    palmLengthMm: 60,
    palmWidthMm: 55,
  });
  const evidence = (referenceMm: number) => ({
    method: "user-length",
    referenceMeasurement: "handLengthMm",
    referenceMm,
    parallaxCorrected: false,
  });

  it("the schema accepts the tolerance's two ends and refuses just outside them", () => {
    const { min, max } = STORED_USER_LENGTH_MM;
    for (const inside of [min, max]) {
      expect(
        handMeasurementsSchema.safeParse(measurements(inside)).success,
        `${inside} mm accepted`,
      ).toBe(true);
    }
    for (const outside of [min - 0.1, max + 0.1]) {
      expect(
        handMeasurementsSchema.safeParse(measurements(outside)).success,
        `${outside} mm refused`,
      ).toBe(false);
    }
  });

  it("the typed-length evidence has the same limits", () => {
    const { min, max } = STORED_USER_LENGTH_MM;
    expect(userLengthEvidenceSchema.safeParse(evidence(min)).success).toBe(
      true,
    );
    expect(userLengthEvidenceSchema.safeParse(evidence(max)).success).toBe(
      true,
    );
    expect(
      userLengthEvidenceSchema.safeParse(evidence(min - 0.1)).success,
    ).toBe(false);
    expect(
      userLengthEvidenceSchema.safeParse(evidence(max + 0.1)).success,
    ).toBe(false);
  });

  it("the stored-length reader accepts and refuses exactly where the schema does", () => {
    expect(parseStoredUserLength("100")).toBe(100);
    expect(parseStoredUserLength("280")).toBe(280);
    expect(parseStoredUserLength("99.9")).toBeNull();
    expect(parseStoredUserLength("280.1")).toBeNull();
  });
});
