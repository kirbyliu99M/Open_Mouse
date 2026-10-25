/**
 * fit-v3.0 candidate (未拍板), hard rule 2: `calibration` is not part of what
 * the analysis or the share card read. The same v3 response with and without
 * the block gives analysis input that differs in exactly one thing, the bare
 * flag `targetsPersonallyAdjusted: true` (so the prose does not claim the
 * targets come from the hand alone; v3.1 consumers, M3), the same numbers for
 * the analysis numeral allow-list, and no calibration key or number; the share
 * card input is deeply equal. (The response's `targets` already include the
 * offsets, and that is the same on both sides: this compares the block, not
 * the targets. Out of range both sides are unscored alike, because `coverage`
 * stays in both: only the block is removed.)
 */
import { describe, expect, it } from "vitest";
import { buildShareCardInput } from "../../src/components/results/share/input";
import type {
  FitPreferences,
  FitReference,
  FitResponse,
} from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { collectNumbers } from "../../src/server/analysis/numerals";
import { attachRankStabilityV3 } from "../../src/server/fit/rank-stability-v3-candidate";
import { scoreFitV3 } from "../../src/server/fit/score-v3-candidate";
import { groupShells } from "../../src/server/fit/shell-groups";
import { hand, seedCatalogue, seedPriors } from "./fit-v2c-fixtures";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";

const refs: FitReference[] = [
  "logitech-g903-hero",
  "logitech-g-pro-2-lightspeed",
].map((slug) => ({
  slug,
  grips: ["palm", "claw"],
  feel: { length: 0, width: 0, height: 0 },
  specialUse: false,
}));

const CASES: [string, HandMeasurements, FitPreferences][] = [
  [
    "in range, no grip stated",
    hand(190, 65.7),
    { includeVertical: false, references: refs },
  ],
  [
    "out of range, palm, thickness answered",
    hand(250, 87.5),
    {
      includeVertical: false,
      gripStyle: "palm",
      palmThickness: "thick",
      references: refs,
    },
  ],
];

/** A v3 response with calibration and rank stability, grouped into cards as core.ts does. */
function richResponse(m: HandMeasurements, prefs: FitPreferences): FitResponse {
  const base = scoreFitV3(m, seedCatalogue, prefs, "right", seedPriors);
  const rich = attachRankStabilityV3(base, {
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

const sorted = (x: unknown) => [...collectNumbers(x)].sort((a, b) => a - b);

describe.each(CASES)("hard rule 2, v3 (%s)", (_name, m, prefs) => {
  const withBlock = richResponse(m, prefs);
  const { calibration: _dropped, ...rest } = withBlock;
  void _dropped;
  const withoutBlock: FitResponse = rest;

  it("the fixture really carries a calibration block with non-trivial numbers", () => {
    expect(withBlock.calibration).toBeDefined();
    expect(withBlock.calibration!.referencesUsed).toBe(2);
    expect(withBlock.calibration!.dims.length.shiftMm).not.toBe(0);
    expect(withoutBlock).not.toHaveProperty("calibration");
  });

  it.each(["en", "zh-TW"] as const)(
    "analysis input: only the bare adjusted flag differs, same numbers, no calibration key (%s)",
    (locale) => {
      for (const cal of [undefined, "manual-entry"] as const) {
        const got = buildAnalysisInput(withBlock, m, locale, cal);
        const want = buildAnalysisInput(withoutBlock, m, locale, cal);
        expect(got.targetsPersonallyAdjusted).toBe(true);
        expect(want).not.toHaveProperty("targetsPersonallyAdjusted");
        const { targetsPersonallyAdjusted: _flag, ...rest } = got;
        void _flag;
        expect(rest).toEqual(want);
        expect(sorted(got)).toEqual(sorted(want));
        const json = JSON.stringify(got);
        for (const key of [
          "calibration",
          "referencesUsed",
          "shiftMm",
          "conflict",
        ]) {
          expect(json).not.toContain(key);
        }
      }
    },
  );

  it("the adjusted flag needs a real shift: a block whose every dimension is frozen or unanswered sets nothing", () => {
    const frozen: FitResponse = {
      ...withBlock,
      calibration: {
        referencesUsed: 1,
        dims: {
          length: { shiftMm: 0, answers: 1, conflict: true },
          gripWidth: { shiftMm: 0, answers: 0, conflict: false },
          height: { shiftMm: 0, answers: 0, conflict: false },
        },
      },
    };
    expect(buildAnalysisInput(frozen, m, "en")).not.toHaveProperty(
      "targetsPersonallyAdjusted",
    );
  });

  it.each(["en", "zh-TW"] as const)(
    "share card input: no calibration field, deeply equal, same numbers (%s)",
    (lang) => {
      const got = buildShareCardInput(withBlock, lang, null);
      const want = buildShareCardInput(withoutBlock, lang, null);
      expect(want).not.toBeNull();
      expect(got).toEqual(want);
      expect(sorted(got)).toEqual(sorted(want));
      const json = JSON.stringify(got);
      for (const key of [
        "calibration",
        "referencesUsed",
        "shiftMm",
        "conflict",
      ]) {
        expect(json).not.toContain(key);
      }
    },
  );

  it("the numeral allow-list gains none of the calibration numbers", () => {
    const allowed = new Set(
      sorted(buildAnalysisInput(withBlock, m, "en", undefined)),
    );
    // The offsets are never used as such by the input builders; a shift
    // that is not also some other value in the input must not be in the list.
    const dims = withBlock.calibration!.dims;
    const others = new Set(
      sorted(buildAnalysisInput(withoutBlock, m, "en", undefined)),
    );
    for (const d of Object.values(dims)) {
      if (!others.has(d.shiftMm)) expect(allowed.has(d.shiftMm)).toBe(false);
    }
  });
});
