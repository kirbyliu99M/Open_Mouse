import { describe, expect, it } from "vitest";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { collectNumbers } from "../../src/server/analysis/numerals";
import { makeFit, makeMeasurements } from "./analysis-fixtures";

describe("buildAnalysisInput", () => {
  it("replaces the engine version with a provisional flag and keeps grip style, exclusions and already-rounded targets", () => {
    const fit = makeFit();
    const input = buildAnalysisInput(fit, makeMeasurements());
    expect(input).not.toHaveProperty("engineVersion");
    expect(input.rankingProvisional).toBe(true);
    expect(input.targets).toEqual(fit.targets);
    expect(input.gripStyle).toEqual(fit.gripStyle);
    expect(input.excluded).toEqual(fit.excluded);
  });

  it("includes only the three required hand measurements", () => {
    const input = buildAnalysisInput(
      makeFit(),
      makeMeasurements({ thumbLengthMm: 55 }),
    );
    expect(input.hand).toEqual({
      handLengthMm: 180.4,
      palmLengthMm: 105.2,
      palmWidthMm: 84.6,
    });
    expect(input.hand).not.toHaveProperty("thumbLengthMm");
  });

  it("takes at most the top 3 results, in rank order, with sub-score reasons", () => {
    const entries = [1, 2, 3, 4].map((rank) => ({
      ...makeFit().results[0]!,
      rank,
      mouse: { ...makeFit().results[0]!.mouse, slug: `mouse-${rank}` },
    }));
    const input = buildAnalysisInput(
      makeFit({ results: entries }),
      makeMeasurements(),
    );
    expect(input.topPicks).toHaveLength(3);
    expect(input.topPicks.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(input.topPicks[0]!.subscores.length).toEqual({
      score: 90,
      band: "very_good",
      reasonCode: "length_ideal",
      impact:
        "The length lets your palm and fingers rest where they naturally fall.",
      params: { deltaMm: 1.5 },
    });
  });

  it("carries mouse dimensions engine-made numbers can be checked against", () => {
    const input = buildAnalysisInput(makeFit(), makeMeasurements());
    expect(input.topPicks[0]).toMatchObject({
      slug: "logitech-g-pro-x-superlight-2",
      lengthMm: 125,
      widthMm: 63.5,
      heightMm: 40,
      weightG: 60,
      total: 88,
      confidencePercent: 90,
    });
  });

  it("decides low confidence on the raw value, as the results page does", () => {
    // 0.597 rounds to 60%, which is not below 60 — but the page's own
    // isLowConfidence(0.597) is true, and the prose must agree with the page.
    const fit = makeFit({
      results: [{ ...makeFit().results[0]!, confidence: 0.597 }],
    });
    const entry = buildAnalysisInput(fit, makeMeasurements()).topPicks[0]!;
    expect(entry.confidencePercent).toBe(60);
    expect(entry.lowConfidence).toBe(true);
  });

  it("rounds mouse dimensions and every reason param, grams included, to one decimal", () => {
    const base = makeFit().results[0]!;
    const fit = makeFit({
      results: [
        {
          ...base,
          mouse: { ...base.mouse, lengthMm: 125.04, widthMm: 63.46 },
          subscores: {
            ...base.subscores,
            length: {
              ...base.subscores.length,
              reason: { code: "length_ideal", params: { deltaMm: 1.4999999 } },
            },
            weight: {
              ...base.subscores.weight,
              reason: {
                code: "weight_in_range",
                params: { deltaG: 1.4000000000000057 },
              },
            },
          },
        },
      ],
    });
    const entry = buildAnalysisInput(fit, makeMeasurements()).topPicks[0]!;
    expect(entry.lengthMm).toBe(125);
    expect(entry.widthMm).toBe(63.5);
    expect(entry.subscores.length.params).toEqual({ deltaMm: 1.5 });
    expect(entry.subscores.weight.params).toEqual({ deltaG: 1.4 });
  });

  it("rounds confidence to a whole percent, and targets and hand to one decimal", () => {
    const fit = makeFit({
      targets: { lengthMm: 118.456, gripWidthMm: 62.456, heightMm: 39.456 },
      results: [{ ...makeFit().results[0]!, confidence: 0.7575757575757576 }],
    });
    const input = buildAnalysisInput(
      fit,
      makeMeasurements({ handLengthMm: 180.456 }),
    );
    expect(input.topPicks[0]!.confidencePercent).toBe(76);
    expect(input.targets.lengthMm).toBe(118.5);
    expect(input.hand.handLengthMm).toBe(180.5);
    expect(JSON.stringify(input)).not.toContain("0.7575757575757576");
  });
});

describe("buildAnalysisInput excluded totals", () => {
  it("keeps a wrong_hand exclusion's total out of the input and out of the allowed numerals", () => {
    const fit = makeFit({
      excluded: [
        {
          slug: "acme-lefty",
          brand: "Acme",
          model: "Lefty",
          reason: "wrong_hand",
          total: 58,
        },
      ],
    });
    const input = buildAnalysisInput(fit, makeMeasurements());
    expect(input.excluded).toEqual([
      {
        slug: "acme-lefty",
        brand: "Acme",
        model: "Lefty",
        reason: "wrong_hand",
      },
    ]);
    expect(input.excluded[0]).not.toHaveProperty("total");
    expect(JSON.stringify(input)).not.toContain("58");
    expect(collectNumbers(input).has(58)).toBe(false);
  });
});

describe("buildAnalysisInput — fit-v1 grip weights", () => {
  const raw = {
    palm: 0.24696504024757157,
    claw: 0.552849419090578,
    fingertip: 0.20018554066185035,
  };
  const fit = makeFit({
    engineVersion: "fit-v1-candidate.2",
    gripStyle: { stated: null, predicted: "claw", used: "claw", weights: raw },
  });

  it("rounds the weights to two decimals, and the raw floats are not in the input", () => {
    const input = buildAnalysisInput(fit, makeMeasurements());
    expect(input.gripStyle.weights).toEqual({
      palm: 0.25,
      claw: 0.55,
      fingertip: 0.2,
    });
    const numbers = collectNumbers(input);
    for (const v of Object.values(raw)) expect(numbers.has(v)).toBe(false);
    expect(numbers.has(0.55)).toBe(true);
  });

  it("leaves the fit response itself unchanged", () => {
    buildAnalysisInput(fit, makeMeasurements());
    expect(fit.gripStyle.weights).toEqual(raw);
  });
});
