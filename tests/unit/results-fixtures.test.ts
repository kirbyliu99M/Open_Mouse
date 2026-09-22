import { describe, expect, it } from "vitest";
import { fitResponseSchema } from "../../src/lib/contracts/fit";
import { LOW_CONFIDENCE_THRESHOLD } from "../../src/components/results/format";
import highConfidence from "../../src/components/results/fixtures/high-confidence.json";
import lowConfidence from "../../src/components/results/fixtures/low-confidence.json";
import withExclusions from "../../src/components/results/fixtures/with-exclusions.json";

describe("results demo fixtures", () => {
  it.each([
    ["high-confidence.json", highConfidence],
    ["low-confidence.json", lowConfidence],
    ["with-exclusions.json", withExclusions],
  ])("%s parses with fitResponseSchema", (_, fixture) => {
    const result = fitResponseSchema.safeParse(fixture);
    expect(
      result.success,
      JSON.stringify(result.success ? null : result.error.issues),
    ).toBe(true);
  });

  it("high-confidence.json's top pick is at or above the low-confidence threshold", () => {
    const parsed = fitResponseSchema.parse(highConfidence);
    expect(parsed.results[0].confidence).toBeGreaterThanOrEqual(
      LOW_CONFIDENCE_THRESHOLD,
    );
  });

  it("low-confidence.json demonstrates both a low-confidence top pick and null sub-scores", () => {
    const parsed = fitResponseSchema.parse(lowConfidence);
    expect(parsed.results[0].confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
    const hasNullSubscore = Object.values(parsed.results[0].subscores).some(
      (s) => s.score === null,
    );
    expect(hasNullSubscore).toBe(true);
  });

  it("with-exclusions.json has at least one excluded mouse", () => {
    const parsed = fitResponseSchema.parse(withExclusions);
    expect(parsed.excluded.length).toBeGreaterThan(0);
  });
});
