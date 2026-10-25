/**
 * Design R7 §5.1 item 7 as a fixed-seed regression (V3.2 F12, candidate
 * 未拍板): on the V1 population (600 hands, seed 20261018), a corrected scan
 * passed through the REAL `fitScaleMeasurements` must rank the v3 top 10 as
 * close to today's uncorrected scan as a second uncorrected scan of the same
 * hand does, within 0.02 (Jaccard and the same first place), and change the
 * predicted grip for few hands.
 *
 * The same population, draws and k(fill) model as the out-of-repo script
 * `v32-program-2026-10-21/review/R7/d12_fit_population.ts` (its `fitScale` and
 * `rescan` arms), so the numbers pinned below are the ones in
 * docs/fit-algorithm.md §1 and that script's d12.out.txt. All numbers
 * SIMULATED (模擬). When `FIT_SCALE_FROM_CORRECTED` takes the S25 measured
 * ratios (§5.3(d)) the pinned values move: rerun the script, update the doc
 * and these values; the "within 0.02 of a rescan" bounds must still hold.
 */
import { describe, expect, it } from "vitest";
import catalogueJson from "../../src/db/seed/catalogue.json";
import descriptorsJson from "../../src/db/seed/logitech-descriptors.json";
import factsJson from "../../src/db/seed/logitech-facts.json";
import seedJson from "../../src/db/seed/logitech.json";
import {
  fitPreferencesSchema,
  type GripStyle,
} from "../../src/lib/contracts/fit";
import type { HandMeasurements } from "../../src/lib/contracts/measurement";
import { fitScaleMeasurements } from "../../src/lib/fit/fit-scale";
import type { CatalogueEntry } from "../../src/server/catalogue/candidate-map";
import {
  buildSeedRows,
  type FactsFile,
  toCatalogueMouse,
} from "../../src/server/catalogue/catalogue-rows";
import type {
  DescriptorRecord,
  SpecRecord,
} from "../../src/server/catalogue/seed-rows";
import { scoreWithEngine } from "../../src/server/fit/engine";
import { predictGrip } from "../../src/server/fit/grip";
import { groupShells } from "../../src/server/fit/shell-groups";

const built = buildSeedRows(
  seedJson as unknown as SpecRecord[],
  descriptorsJson as unknown as DescriptorRecord[],
  {
    facts: factsJson as unknown as FactsFile,
    entries: catalogueJson as unknown as CatalogueEntry[],
  },
);
// The script's catalogue: every seed row, without the ones marked unlisted.
const catalogue = [...built.withDescriptors, ...built.withoutDescriptors]
  .map(toCatalogueMouse)
  .filter((m) => (m as { listed?: boolean }).listed !== false);

function rng(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (r: () => number) =>
  Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

const popRng = rng(20261018);
const hands = Array.from({ length: 600 }, () => {
  const male = popRng() < 0.5;
  const h = (male ? 184 : 169) + 8 * normal(popRng);
  return { h, w: h * (0.35 + 0.02 * normal(popRng)) };
});

// Uncorrected over corrected at a paper fill f, the 190 mm row of R7's
// F17 (2026-10-23): the R7 script at the 18 mm frame prior (998 px; scratchpad
// f17_scale.out.txt, 190 mm row), linear between fill 0.55 and 0.80 (模擬).
const lin = (a: number, b: number) => (f: number) =>
  a + ((b - a) * (f - 0.55)) / 0.25;
// 2026-10-24/25: measured k sat above the simulation (S25 and an iPhone), so
// the population's "real" k(fill) is the simulated curve scaled to the
// measured value at fill 0.65 (kL 1.047 / 1.0348, kP 1.067 / 1.0606, kW 1.044 / 1.0509).
const realL = 1.047 / 1.0348;
const realP = 1.067 / 1.0606;
const realW = 1.044 / 1.0509;
const kL0 = lin(1.0294, 1.0427);
const kP0 = lin(1.051, 1.0753);
const kW0 = lin(1.0428, 1.0634);
const kL = (f: number) => kL0(f) * realL;
const kP = (f: number) => kP0(f) * realP;
const kW = (f: number) => kW0(f) * realW;

const CORRECTED_SCAN = {
  calibrationMethod: "paper-edge",
  parallaxCorrected: true,
} as const;

const GRIPS = [null, "palm", "claw", "fingertip"] as const;

// The script draws, per grip in this order and per hand, r, fill 1 and
// fill 2 from one stream (seed 7): drawn up front so each grip's case can
// run on its own and still see the script's numbers.
const drawRng = rng(7);
const draws = GRIPS.map(() =>
  hands.map(() => {
    const rH = 0.56 + 0.015 * normal(drawRng);
    const f1 = 0.55 + 0.25 * drawRng();
    const f2 = 0.55 + 0.25 * drawRng();
    return { rH, f1, f2 };
  }),
);

const top10 = (m: HandMeasurements, grip: GripStyle | null): string[] =>
  groupShells(
    scoreWithEngine(
      "v3",
      m,
      catalogue,
      // The script passed `{}` or `{ gripStyle }`; parsed, as a request is.
      fitPreferencesSchema.parse(grip ? { gripStyle: grip } : {}),
      "right",
    ).results,
    catalogue,
  )
    .slice(0, 10)
    .map((c) => c.mouse.slug);

const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a);
  const B = new Set(b);
  let i = 0;
  A.forEach((x) => {
    if (B.has(x)) i++;
  });
  return i / (A.size + B.size - i);
};
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

function population(gi: number) {
  const grip = GRIPS[gi];
  const j = { fitScale: [] as number[], rescan: [] as number[] };
  const top1 = { fitScale: [] as number[], rescan: [] as number[] };
  hands.forEach((x, i) => {
    const { rH, f1, f2 } = draws[gi][i];
    const legacy: HandMeasurements = {
      handLengthMm: x.h,
      palmWidthMm: x.w,
      palmLengthMm: x.h * rH,
    };
    const corrected: HandMeasurements = {
      handLengthMm: x.h / kL(f1),
      palmWidthMm: x.w / kW(f1),
      palmLengthMm: (x.h * rH) / kP(f1),
    };
    const rescan: HandMeasurements = {
      handLengthMm: (x.h * kL(f2)) / kL(f1),
      palmWidthMm: (x.w * kW(f2)) / kW(f1),
      palmLengthMm: (x.h * rH * kP(f2)) / kP(f1),
    };
    const base = top10(legacy, grip);
    const scaled = top10(fitScaleMeasurements(corrected, CORRECTED_SCAN), grip);
    const again = top10(rescan, grip);
    j.fitScale.push(jaccard(base, scaled));
    j.rescan.push(jaccard(base, again));
    top1.fitScale.push(+(base[0] === scaled[0]));
    top1.rescan.push(+(base[0] === again[0]));
  });
  return {
    jaccard: { fitScale: mean(j.fitScale), rescan: mean(j.rescan) },
    sameTop1: { fitScale: mean(top1.fitScale), rescan: mean(top1.rescan) },
  };
}

describe("R7 §5.1 item 7: the engine scale keeps the v3 ranking (V1 population, seed 20261018, 模擬)", () => {
  // grip, then the script's fitScale Jaccard and same-first share (d12.out.txt).
  it.each([
    [0, "unstated", 0.877, 0.87],
    [1, "palm", 0.829, 0.818],
    [2, "claw", 0.88, 0.862],
    [3, "fingertip", 0.934, 0.925],
  ] as const)(
    "grip %i (%s): within 0.02 of a second uncorrected scan, as documented",
    (gi, _name, docJaccard, docTop1) => {
      const p = population(gi);
      // The acceptance (§5.1 item 7): not below a rescan minus 0.02.
      expect(p.jaccard.fitScale).toBeGreaterThanOrEqual(
        p.jaccard.rescan - 0.02,
      );
      expect(p.sameTop1.fitScale).toBeGreaterThanOrEqual(
        p.sameTop1.rescan - 0.02,
      );
      // The numbers docs/fit-algorithm.md quotes.
      expect(p.jaccard.fitScale).toBeCloseTo(docJaccard, 3);
      expect(p.sameTop1.fitScale).toBeCloseTo(docTop1, 3);
    },
    30_000,
  );

  it("predictGrip differs from today's uncorrected scan for 3.2 % of hands (seed 11)", () => {
    const g = rng(11);
    let flips = 0;
    for (const x of hands) {
      const rH = 0.56 + 0.015 * normal(g);
      const f1 = 0.55 + 0.25 * g();
      const before = predictGrip(x.h, x.h * rH);
      const s = fitScaleMeasurements(
        {
          handLengthMm: x.h / kL(f1),
          palmLengthMm: (x.h * rH) / kP(f1),
          palmWidthMm: x.w / kW(f1),
        },
        CORRECTED_SCAN,
      );
      if (predictGrip(s.handLengthMm, s.palmLengthMm) !== before) flips++;
    }
    expect(flips / hands.length).toBeCloseTo(0.0317, 3);
    // Few hands: well under the 24.5 % of the unscaled corrected numbers.
    expect(flips / hands.length).toBeLessThan(0.05);
  });
});
