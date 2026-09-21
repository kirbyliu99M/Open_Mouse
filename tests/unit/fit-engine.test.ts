import { describe, expect, it } from "vitest";
import { fitResponseSchema } from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import { scoreFit } from "../../src/server/fit/score";
import type { CatalogueMouse } from "../../src/server/fit/types";

// r = 110/190 = 0.5789… → claw (0.54 ≤ r < 0.58). Targets: length 117.8,
// gripWidth 70.4, height 38.
const measurements: HandMeasurements = {
  handLengthMm: 190,
  palmLengthMm: 110,
  palmWidthMm: 80,
};

const fullyClassified: CatalogueMouse = {
  slug: "acme-alpha",
  brand: "Acme",
  model: "Alpha",
  lengthMm: 117.8,
  widthMm: 70.4,
  heightMm: 38,
  weightG: 80,
  size: "medium",
  handCompatibility: "right",
  shape: "symmetrical",
  humpPlacement: "back_moderate", // best for claw → 0 levels off
  frontFlare: "outward_slight", // claw → 100
  sideCurvature: "flat",
  thumbRest: false, // claw, no rest → 85, thumb_neutral
};

const unclassified: CatalogueMouse = {
  slug: "beta-unknown",
  brand: "Beta",
  model: "Unknown",
  lengthMm: 117.8,
  widthMm: 70.4,
  heightMm: 38,
  weightG: null,
  size: "medium",
  handCompatibility: null,
  shape: null,
  humpPlacement: null,
  frontFlare: null,
  sideCurvature: null,
  thumbRest: null,
};

describe("scoreFit aggregation", () => {
  it("computes a renormalised total and a weight-based confidence for a fully classified mouse", () => {
    const r = scoreFit(measurements, [fullyClassified], { includeVertical: false }, "right");
    const entry = r.results[0];
    // length 100·0.30 + gripWidth 100·0.25 + heightHump 100·0.20
    // + frontFlare 100·0.10 + thumb 85·0.10, weight sum 0.95 (weight excluded: no preference)
    expect(entry.total).toBe(Math.round((30 + 25 + 20 + 10 + 8.5) / 0.95));
    expect(entry.confidence).toBe(1); // every applicable subscore had real input
  });

  it("renormalises over fewer subscores and lowers confidence for an unclassified mouse", () => {
    const r = scoreFit(measurements, [unclassified], { includeVertical: false }, "right");
    const entry = r.results[0];
    // Real inputs: length 100·0.30, gripWidth 100·0.125 (curvature null → halved),
    // heightHump 100·0.20 (height-only, but reason is descriptor_unknown).
    // frontFlare/thumb/weight all null.
    expect(entry.total).toBe(100);
    // confidence numerator excludes heightHump (descriptor_unknown reason)
    // even though its score is non-null: 0.3 + 0.125 = 0.425.
    // denominator excludes only "weight" (no_preference, structurally n/a):
    // 0.3 + 0.125 + 0.2 + 0.1 + 0.1 = 0.825.
    expect(entry.confidence).toBeCloseTo(0.425 / 0.825, 10);
    expect(entry.subscores.frontFlare.score).toBeNull();
    expect(entry.subscores.frontFlare.reason.code).toBe("descriptor_unknown");
    expect(entry.subscores.thumb.score).toBeNull();
    expect(entry.subscores.weight.score).toBeNull();
    expect(entry.subscores.weight.reason.code).toBe("no_preference");
    // heightHump is the documented exception: null hump still yields a
    // height-only score, not a null score.
    expect(entry.subscores.heightHump.score).not.toBeNull();
    expect(entry.subscores.heightHump.reason.code).toBe("descriptor_unknown");
  });

  it("sorts by total desc, then confidence desc, then model name asc", () => {
    const lowerConfidence: CatalogueMouse = { ...unclassified, slug: "acme-gamma", model: "Gamma" };
    const tieBreakA: CatalogueMouse = { ...fullyClassified, slug: "acme-zeta", model: "Zeta" };
    const tieBreakB: CatalogueMouse = { ...fullyClassified, slug: "acme-yankee", model: "Yankee" };

    const r = scoreFit(
      measurements,
      [lowerConfidence, tieBreakA, tieBreakB],
      { includeVertical: false },
      "right",
    );

    // lowerConfidence (Gamma) totals 100 — higher than the fully classified
    // pair's 98 (see the aggregation test above), so it sorts first despite
    // lower confidence: total is the primary sort key, not confidence.
    // tieBreakA/B share total and confidence (identical inputs) — model
    // name breaks the tie: Yankee before Zeta.
    expect(r.results.map((e) => e.mouse.slug)).toEqual([
      "acme-gamma",
      "acme-yankee",
      "acme-zeta",
    ]);
    expect(r.results.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("excludes mice before ranking and reports why", () => {
    const wrongHand: CatalogueMouse = {
      ...fullyClassified,
      slug: "acme-lefty",
      model: "Lefty",
      handCompatibility: "left",
    };
    const vertical: CatalogueMouse = {
      ...fullyClassified,
      slug: "acme-vertical",
      model: "Vertical",
      lengthMm: 108,
      heightMm: 71, // ratio 0.657 > 0.55
    };
    const r = scoreFit(
      measurements,
      [fullyClassified, wrongHand, vertical],
      { includeVertical: false },
      "right",
    );
    expect(r.results.map((e) => e.mouse.slug)).toEqual(["acme-alpha"]);
    expect(r.excluded).toEqual(
      expect.arrayContaining([
        { slug: "acme-lefty", reason: "wrong_hand" },
        { slug: "acme-vertical", reason: "vertical_form_factor" },
      ]),
    );
  });

  it("a stated grip preference overrides the predicted grip", () => {
    const predictedOnly = scoreFit(
      measurements,
      [fullyClassified],
      { includeVertical: false },
      "right",
    );
    expect(predictedOnly.gripStyle).toEqual({ stated: null, predicted: "claw", used: "claw" });

    const stated = scoreFit(
      measurements,
      [fullyClassified],
      { includeVertical: false, gripStyle: "palm" },
      "right",
    );
    expect(stated.gripStyle).toEqual({ stated: "palm", predicted: "claw", used: "palm" });
    // Targets recompute off the used (stated) grip, not the predicted one.
    expect(stated.targets.lengthMm).toBeCloseTo(190 * 0.66, 10);
  });

  it("produces output that parses with fitResponseSchema", () => {
    const r = scoreFit(measurements, [fullyClassified, unclassified], {
      includeVertical: false,
    } , "right");
    const withScanId = { ...r, scanId: "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f" };
    const parsed = fitResponseSchema.safeParse(withScanId);
    expect(parsed.success).toBe(true);
  });
});
