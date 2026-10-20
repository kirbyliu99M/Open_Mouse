/**
 * fit-v2.0 candidate, build spec rev2 §4 T10, hard rule 2: `coverage` and
 * `rankStability` are not part of what the analysis or the share card read.
 * Rewritten for v3.1 (M2, M3): out of range the analysis input and the share
 * card input DO change, but only by what the contract requires (no `total`, no
 * `band`, no `bandMeaning`, no sub-score `band`, the `scoreMode` flag; for the
 * card, `total` and `bandLabel` null), and nothing of `coverage` enters. In
 * range, and for `rankStability` anywhere, they stay deeply equal. The numeral
 * allow-list never gains a number: out of range it is a subset of the plain
 * response's. This compares whole outputs and number sets; it does not assert
 * that some value is absent (0 and 1 may be legitimately present).
 */
import { describe, expect, it } from "vitest";
import { buildShareCardInput } from "../../src/components/results/share/input";
import type { FitPreferences, FitResponse } from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import {
  buildAnalysisInput,
  type AnalysisInput,
} from "../../src/server/analysis/input";
import { collectNumbers } from "../../src/server/analysis/numerals";
import { attachRankStability } from "../../src/server/fit/rank-stability-candidate";
import { scoreFitV2 } from "../../src/server/fit/score-v2-candidate";
import { groupShells } from "../../src/server/fit/shell-groups";
import { hand, seedCatalogue, seedPriors } from "./fit-v2c-fixtures";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";

/** A v2 response with rank stability, grouped into cards as core.ts does. */
function richResponse(m: HandMeasurements, prefs: FitPreferences): FitResponse {
  const base = scoreFitV2(m, seedCatalogue, prefs, "right", seedPriors);
  const rich = attachRankStability(base, {
    measurements: m,
    catalogue: seedCatalogue,
    prefs,
    hand: "right",
    priors: seedPriors,
  });
  return {
    scanId: SCAN_ID,
    ...rich,
    results: groupShells(rich.results, seedCatalogue),
  };
}

function strip(
  fit: FitResponse,
  keep: { coverage: boolean; rankStability: boolean },
): FitResponse {
  const { coverage, ...rest } = fit;
  return {
    ...rest,
    ...(keep.coverage && coverage ? { coverage } : {}),
    results: fit.results.map((e) => {
      if (keep.rankStability) return e;
      const { rankStability: _s, ...plain } = e;
      void _s;
      return plain;
    }),
  };
}

const CASES: [string, HandMeasurements, FitPreferences][] = [
  [
    "out of range, palm",
    hand(250, 87.5),
    { includeVertical: false, gripStyle: "palm" },
  ],
  [
    "in range, no grip stated",
    hand(183.37, 70.21, 0.57),
    { includeVertical: false },
  ],
];

describe.each(CASES)("T10 (%s)", (_n, m, prefs) => {
  const rich = richResponse(m, prefs);
  const plain = strip(rich, { coverage: false, rankStability: false });
  const variants: [string, FitResponse][] = [
    ["both", rich],
    ["coverage only", strip(rich, { coverage: true, rankStability: false })],
    [
      "rankStability only",
      strip(rich, { coverage: false, rankStability: true }),
    ],
    ["neither", plain],
  ];

  it("the fixture really carries the fields", () => {
    expect(rich.coverage).toBeDefined();
    expect(
      rich.results.filter((e) => e.rankStability !== undefined),
    ).toHaveLength(10);
    expect(plain).not.toHaveProperty("coverage");
    expect(plain.results.some((e) => "rankStability" in e)).toBe(false);
  });

  const outOfRange = rich.coverage?.lengthOutOfRange === true;
  const sortedNumbers = (x: unknown) =>
    [...collectNumbers(x)].sort((p, q) => p - q);

  /** The scored input minus exactly what the unscored mode removes. */
  function withoutScoreFields(input: AnalysisInput) {
    const { scoreMode: _mode, ...rest } = input;
    void _mode;
    return {
      ...rest,
      topPicks: input.topPicks.map((entry) => {
        const { total: _t, band: _b, bandMeaning: _m, ...plainEntry } = entry;
        void [_t, _b, _m];
        return {
          ...plainEntry,
          subscores: Object.fromEntries(
            Object.entries(entry.subscores).map(([key, sub]) => {
              const { band: _sb, ...plainSub } = sub;
              void _sb;
              return [key, plainSub];
            }),
          ),
        };
      }),
    };
  }

  it("the case is the one it says: out of range or in range", () => {
    expect(outOfRange).toBe(_n.startsWith("out of range"));
  });

  it.each(["en", "zh-TW"] as const)(
    "analysis input: coverage and rankStability add nothing; out of range only the score fields go (%s)",
    (locale) => {
      for (const calibration of [undefined, "manual-entry"] as const) {
        const want = buildAnalysisInput(plain, m, locale, calibration);
        expect(want).not.toHaveProperty("scoreMode");
        // The plain response has no coverage block, so it is scored; strip
        // the score fields from it to get what an unscored input must equal.
        for (const [name, fit] of variants) {
          const got = buildAnalysisInput(fit, m, locale, calibration);
          const json = JSON.stringify(got);
          for (const key of [
            "coverage",
            "rankStability",
            "lengthOutOfRange",
            "direction",
            "catalogueLengthRangeMm",
            "usedGripLengthTargetMm",
          ]) {
            expect(json, `${name}: ${key}`).not.toContain(key);
          }
          if (!fit.coverage?.lengthOutOfRange) {
            expect(got, name).toEqual(want);
            expect(sortedNumbers(got), name).toEqual(sortedNumbers(want));
          } else {
            expect(got.scoreMode, name).toBe("unscored");
            for (const entry of got.topPicks) {
              expect(entry, name).not.toHaveProperty("total");
              expect(entry, name).not.toHaveProperty("band");
              expect(entry, name).not.toHaveProperty("bandMeaning");
              for (const sub of Object.values(entry.subscores)) {
                expect(sub, name).not.toHaveProperty("band");
              }
            }
            // Everything else is what the plain response gives.
            expect(withoutScoreFields(got), name).toEqual(
              withoutScoreFields({ ...want, scoreMode: "unscored" }),
            );
            // The allow-list can only shrink.
            const allowed = new Set(sortedNumbers(want));
            for (const n of sortedNumbers(got)) {
              expect(allowed.has(n), `${name}: ${n}`).toBe(true);
            }
          }
        }
      }
    },
  );

  it.each(["en", "zh-TW"] as const)(
    "share card input: in range deeply equal; out of range the same but no total and no band (%s)",
    (lang) => {
      const want = buildShareCardInput(plain, lang, null);
      expect(want).not.toBeNull();
      for (const [name, fit] of variants) {
        const got = buildShareCardInput(fit, lang, null)!;
        expect(JSON.stringify(got), name).not.toMatch(
          /coverage|rankStability|lengthOutOfRange|catalogueLengthRange/,
        );
        if (!fit.coverage?.lengthOutOfRange) {
          expect(got, name).toEqual(want);
          expect(sortedNumbers(got), name).toEqual(sortedNumbers(want));
        } else {
          expect(got.total, name).toBeNull();
          expect(got.bandLabel, name).toBeNull();
          expect({
            ...got,
            total: want!.total,
            bandLabel: want!.bandLabel,
          }).toEqual(want);
        }
      }
    },
  );
});
