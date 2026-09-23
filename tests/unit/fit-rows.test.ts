import { describe, expect, it } from "vitest";
import type { FitEntry } from "../../src/lib/contracts/fit";
import { UNKNOWN_PRIOR_SCORE } from "../../src/server/fit/coefficients";
import { buildFitResultRows } from "../../src/server/fit/rows";

function entry(overrides: Partial<FitEntry> = {}): FitEntry {
  return {
    rank: 1,
    mouse: {
      slug: "logitech-g502",
      brand: "Logitech",
      model: "G502",
      lengthMm: 132,
      widthMm: 75,
      heightMm: 40,
      weightG: 121,
      size: "medium",
    },
    total: 82,
    confidence: 0.9,
    subscores: {
      length: {
        score: 80,
        weight: 0.3,
        reason: { code: "length_ideal", params: {} },
      },
      gripWidth: {
        score: 75,
        weight: 0.25,
        reason: { code: "width_ideal", params: {} },
      },
      heightHump: {
        score: 90,
        weight: 0.2,
        reason: { code: "hump_matches_grip", params: {} },
      },
      frontFlare: {
        score: 80,
        weight: 0.1,
        reason: { code: "flare_neutral", params: {} },
      },
      thumb: {
        score: 100,
        weight: 0.1,
        reason: { code: "thumb_rest_supports", params: {} },
      },
      weight: {
        score: 70,
        weight: 0.05,
        reason: { code: "weight_in_range", params: {} },
      },
    },
    ...overrides,
  };
}

describe("buildFitResultRows", () => {
  it("maps every scoreFit number through unchanged", () => {
    const rows = buildFitResultRows(
      "scan-1",
      "fit-v0-provisional",
      [entry()],
      new Map([["logitech-g502", "mouse-uuid-1"]]),
    );

    expect(rows).toEqual([
      {
        scanId: "scan-1",
        mouseId: "mouse-uuid-1",
        engineVersion: "fit-v0-provisional",
        rank: 1,
        totalScore: 82,
        lengthScore: 80,
        gripWidthScore: 75,
        heightHumpScore: 90,
        frontFlareScore: 80,
        thumbScore: 100,
        weightScore: 70,
        reasons: entry().subscores,
      },
    ]);
  });

  it("stores UNKNOWN_PRIOR_SCORE for a null sub-score, same neutral prior scoreFit itself uses", () => {
    const withUnknown = entry({
      subscores: {
        ...entry().subscores,
        frontFlare: {
          score: null,
          weight: 0.1,
          reason: { code: "descriptor_unknown", params: {} },
        },
      },
    });

    const [row] = buildFitResultRows(
      "scan-1",
      "fit-v0-provisional",
      [withUnknown],
      new Map([["logitech-g502", "mouse-uuid-1"]]),
    );

    expect(row!.frontFlareScore).toBe(UNKNOWN_PRIOR_SCORE);
    // The real null and its reason code survive in `reasons`, unmodified —
    // only the NOT NULL DB column gets the stand-in value.
    expect(row!.reasons.frontFlare.score).toBeNull();
    expect(row!.reasons.frontFlare.reason.code).toBe("descriptor_unknown");
  });

  it("throws rather than silently dropping a result with no catalogue id", () => {
    expect(() =>
      buildFitResultRows("scan-1", "fit-v0-provisional", [entry()], new Map()),
    ).toThrow(/logitech-g502/);
  });

  it("maps multiple results in rank order, independently", () => {
    const second = entry({
      rank: 2,
      mouse: { ...entry().mouse, slug: "razer-basilisk", model: "Basilisk" },
      total: 60,
    });
    const rows = buildFitResultRows(
      "scan-1",
      "fit-v0-provisional",
      [entry(), second],
      new Map([
        ["logitech-g502", "mouse-uuid-1"],
        ["razer-basilisk", "mouse-uuid-2"],
      ]),
    );

    expect(rows.map((r) => [r.mouseId, r.rank, r.totalScore])).toEqual([
      ["mouse-uuid-1", 1, 82],
      ["mouse-uuid-2", 2, 60],
    ]);
  });

  it("returns an empty array for no results", () => {
    expect(
      buildFitResultRows("scan-1", "fit-v0-provisional", [], new Map()),
    ).toEqual([]);
  });
});
