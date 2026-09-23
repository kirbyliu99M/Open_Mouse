import { describe, expect, it } from "vitest";
import { buildAnalysisInput } from "../../src/server/analysis/input";
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
      reasonCode: "length_ideal",
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

  it("rounds confidence to a whole percent and millimetres to one decimal", () => {
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
