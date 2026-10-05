import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIT_BANDS } from "../../src/lib/contracts/fit-bands";
import {
  FAIR_MIN,
  FIT_BAND_MIN_TOTAL,
  GOOD_MIN,
  SCORE_MAX,
  SCORE_MIN,
  VERY_GOOD_MIN,
  bandOf,
} from "../../src/lib/fit/bands";
import { POOR_FIT_THRESHOLD } from "../../src/components/results/fitNotice";

/**
 * The thresholds are CANDIDATES (未拍板). Every number below is written as a
 * literal on purpose: a test that built its input from the constants would pass
 * for any value of them, so moving a threshold by one must fail here.
 */
describe("bandOf — boundaries", () => {
  it.each([
    [0, "poor"],
    [49, "poor"],
    [50, "fair"],
    [69, "fair"],
    [70, "good"],
    [84, "good"],
    [85, "very_good"],
    [100, "very_good"],
  ] as const)("%i is %s", (score, band) => {
    expect(bandOf(score)).toBe(band);
  });

  it("gives an unrated (null) sub-score no band", () => {
    expect(bandOf(null)).toBeNull();
  });

  it("agrees with the candidate table for every score from 0 to 100", () => {
    for (let score = 0; score <= 100; score++) {
      const expected =
        score >= 85
          ? "very_good"
          : score >= 70
            ? "good"
            : score >= 50
              ? "fair"
              : "poor";
      expect(bandOf(score), `score ${score}`).toBe(expected);
    }
  });
});

describe("bandOf — scores the contract would reject", () => {
  // Chosen policy: throw, never clamp (see the comment on `bandOf`).
  it.each([49.5, 84.9, 0.1, 101, -1, 1000, Number.NaN, Infinity, -Infinity])(
    "throws a RangeError for %s",
    (score) => {
      expect(() => bandOf(score)).toThrow(RangeError);
    },
  );

  it("does not clamp: 101 is not very_good and -1 is not poor", () => {
    expect(() => bandOf(101)).toThrow();
    expect(() => bandOf(-1)).toThrow();
  });
});

describe("the band table", () => {
  it("keeps the agreed candidate numbers", () => {
    expect(VERY_GOOD_MIN).toBe(85);
    expect(GOOD_MIN).toBe(70);
    expect(FAIR_MIN).toBe(50);
    expect(SCORE_MIN).toBe(0);
    expect(SCORE_MAX).toBe(100);
    expect(FIT_BAND_MIN_TOTAL).toEqual({
      very_good: 85,
      good: 70,
      fair: 50,
      poor: 0,
    });
  });

  it("has a lower bound for every band, strictly falling from the best band to the worst", () => {
    const mins = FIT_BANDS.map((band) => FIT_BAND_MIN_TOTAL[band]);
    for (let i = 1; i < mins.length; i++) {
      expect(mins[i]!).toBeLessThan(mins[i - 1]!);
    }
    expect(mins.at(-1)).toBe(0);
  });

  it("never gives a higher score a worse band, and every band is reachable", () => {
    const seen = new Set<string>();
    let previousIndex: number = FIT_BANDS.length;
    for (let score = 0; score <= 100; score++) {
      const band = bandOf(score)!;
      seen.add(band);
      const index = FIT_BANDS.indexOf(band);
      expect(index).toBeLessThanOrEqual(previousIndex);
      previousIndex = index;
    }
    expect([...seen].sort()).toEqual([...FIT_BANDS].sort());
  });
});

describe("the results page's poor-fit notice", () => {
  it("is still 50", () => {
    expect(POOR_FIT_THRESHOLD).toBe(50);
  });

  it("comes from the bands: under it is poor, at it is fair", () => {
    expect(POOR_FIT_THRESHOLD).toBe(FAIR_MIN);
    expect(bandOf(POOR_FIT_THRESHOLD - 1)).toBe("poor");
    expect(bandOf(POOR_FIT_THRESHOLD)).toBe("fair");
  });

  // The value test above passes for ANY constant that happens to be 50, so a
  // later edit that types the number back in would go unnoticed and the notice
  // could drift away from the bands. This reads the source: the threshold must
  // be the bands module's `FAIR_MIN`, imported, with no number of its own.
  const source = readFileSync(
    new URL("../../src/components/results/fitNotice.ts", import.meta.url),
    "utf8",
  );
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const code = stripComments(source);

  it("imports FAIR_MIN from the bands module", () => {
    expect(code).toMatch(
      /import\s*\{\s*FAIR_MIN\s*\}\s*from\s*["'](?:@\/|(?:\.\.\/)+)lib\/fit\/bands["']/,
    );
  });

  it("is exactly that constant, and defines no FAIR_MIN of its own", () => {
    expect(code).toMatch(
      /export\s+const\s+POOR_FIT_THRESHOLD\s*=\s*FAIR_MIN\s*;/,
    );
    expect(code).not.toMatch(/\b(?:const|let|var|function)\s+FAIR_MIN\b/);
  });

  it("has no number written in the code", () => {
    expect(code).not.toMatch(/\d/);
  });

  it("reads the comments out of the code it checks (the check itself is not fooled by one)", () => {
    const fooled =
      "// export const POOR_FIT_THRESHOLD = FAIR_MIN;\nconst x = 50;";
    const stripped = stripComments(fooled);
    expect(stripped).not.toMatch(/POOR_FIT_THRESHOLD/);
    expect(stripped).toMatch(/\d/);
  });
});
