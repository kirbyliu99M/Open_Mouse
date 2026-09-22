import { describe, expect, it } from "vitest";
import { SUBSCORES, type FitEntry } from "../../src/lib/contracts/fit";
import { topReasons } from "../../src/components/results/topReasons";

const sub = (
  score: number | null,
  weight: number,
  code: FitEntry["subscores"]["length"]["reason"]["code"] = "length_ideal",
) => ({ score, weight, reason: { code, params: {} } });

function makeEntry(overrides: Partial<FitEntry["subscores"]> = {}): FitEntry {
  const subscores = Object.fromEntries(
    SUBSCORES.map((k) => [k, sub(50, 1 / SUBSCORES.length)]),
  ) as FitEntry["subscores"];
  return {
    rank: 1,
    mouse: {
      slug: "test-mouse",
      brand: "Test",
      model: "Mouse",
      lengthMm: 120,
      widthMm: 63,
      heightMm: 40,
      weightG: 70,
      size: "medium",
    },
    total: 50,
    confidence: 0.8,
    subscores: { ...subscores, ...overrides },
  };
}

describe("topReasons", () => {
  it("returns the highest-scoring non-null sub-scores, highest first", () => {
    const entry = makeEntry({
      length: sub(95, 0.2),
      gripWidth: sub(90, 0.2),
      heightHump: sub(85, 0.15),
      frontFlare: sub(10, 0.15),
      thumb: sub(20, 0.15),
      weight: sub(30, 0.15),
    });

    const top = topReasons(entry, 3);
    expect(top.map((r) => r.subscore)).toEqual([
      "length",
      "gripWidth",
      "heightHump",
    ]);
    expect(top[0].score).toBe(95);
  });

  it("never includes a sub-score with a null (not-yet-assessed) score", () => {
    const entry = makeEntry({
      length: sub(null, 0.2, "descriptor_unknown"),
      gripWidth: sub(null, 0.2, "descriptor_unknown"),
      heightHump: sub(70, 0.15),
      frontFlare: sub(60, 0.15),
      thumb: sub(null, 0.15, "descriptor_unknown"),
      weight: sub(40, 0.15),
    });

    const top = topReasons(entry, 3);
    expect(top.every((r) => r.score !== null)).toBe(true);
    expect(top.map((r) => r.subscore)).toEqual([
      "heightHump",
      "frontFlare",
      "weight",
    ]);
  });

  it("breaks ties on score by weight, heavier weight first", () => {
    const entry = makeEntry({
      length: sub(80, 0.2),
      gripWidth: sub(80, 0.05),
      heightHump: sub(80, 0.15),
      frontFlare: sub(10, 0.15),
      thumb: sub(10, 0.15),
      weight: sub(10, 0.15),
    });

    const top = topReasons(entry, 2);
    expect(top.map((r) => r.subscore)).toEqual(["length", "heightHump"]);
  });

  it("returns fewer than `count` when fewer non-null sub-scores exist", () => {
    const entry = makeEntry({
      length: sub(90, 0.2),
      gripWidth: sub(null, 0.2, "descriptor_unknown"),
      heightHump: sub(null, 0.15, "descriptor_unknown"),
      frontFlare: sub(null, 0.15, "descriptor_unknown"),
      thumb: sub(null, 0.15, "descriptor_unknown"),
      weight: sub(null, 0.15, "no_preference"),
    });

    expect(topReasons(entry, 3)).toHaveLength(1);
  });
});
