import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  expectedRecordsAfterConfirm,
  splitAttempts,
} from "../e2e/fixtures/attempt-records";

/**
 * The helper tests/e2e/frame-capture-real-hand.spec.ts uses to read the attempt
 * log after F15's confirm (one analysis record + one corner record), and a
 * guard that the spec no longer waits for a log of length 1 after confirming.
 */
const analysis = { result: "ok", cornerCheck: null };
const check = {
  result: "ok",
  cornerCheck: {
    magnifier: true,
    distancesPx: [0, 0, 0, 0],
    imageLongEdgePx: 1920,
  },
};

describe("splitAttempts", () => {
  it("separates the analysis record from the corner record, whatever the order", () => {
    for (const log of [
      [analysis, check],
      [check, analysis],
    ]) {
      const { analyses, cornerChecks } = splitAttempts(log);
      expect(analyses).toEqual([analysis]);
      expect(cornerChecks).toEqual([check]);
    }
  });

  it("a record written before F15 (no cornerCheck field) counts as an analysis", () => {
    const old = { result: "ok" };
    expect(splitAttempts([old]).analyses).toEqual([old]);
    expect(splitAttempts([old]).cornerChecks).toEqual([]);
  });

  it("an unreadable log (null) or junk entries give nothing", () => {
    expect(splitAttempts(null)).toEqual({ analyses: [], cornerChecks: [] });
    expect(splitAttempts([null, 3, "x"])).toEqual({
      analyses: [],
      cornerChecks: [],
    });
  });
});

describe("expectedRecordsAfterConfirm", () => {
  it("a measured photo adds the corner record: 2; a turned-back one: 1", () => {
    expect(expectedRecordsAfterConfirm(true)).toBe(2);
    expect(expectedRecordsAfterConfirm(false)).toBe(1);
  });
});

describe("frame-capture-real-hand.spec.ts after F15", () => {
  const spec = readFileSync(
    path.join(__dirname, "../e2e/frame-capture-real-hand.spec.ts"),
    "utf8",
  );

  it("does not wait for a log of exactly one record after confirming the frame", () => {
    const after = spec.slice(spec.indexOf("await confirmAutoFrameIfShown("));
    expect(after.length).toBeLessThan(spec.length);
    expect(after).not.toMatch(/\?\.length,[\s\S]{0,80}\}\)\s*\.toBe\(1\)/);
  });

  it("checks the corner record the confirm wrote (all corners where the detector put them)", () => {
    expect(spec).toMatch(/splitAttempts\(/);
    expect(spec).toMatch(/distancesPx\)\.toEqual\(\[0, 0, 0, 0\]\)/);
  });
});
