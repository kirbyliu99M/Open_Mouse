/**
 * Vertical-mouse candidate spike report. 未拍板（candidate）. Read-only: it
 * prints to stdout, writes nothing, touches no database, and does not call
 * `scoreFit`.
 *
 *   npx tsx scripts/vertical-spike.ts
 *
 * Prints, for the two vertical mice in src/db/seed/logitech.json:
 *   1. sub-scores and totals for synthetic hands (hand length 160–200 mm),
 *      under two assumptions about how palm width relates to hand length;
 *   2. the sanity check against Logitech's stated hand sizes;
 *   3. the sensitivity of the ranking to the target factors (±10 %), and to
 *      tying mouse height to hand length instead of palm width.
 *
 * Every hand here is SYNTHETIC. The proportions are assumptions, stated next
 * to each use. No real person's data is involved.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  scoreVerticalCandidate,
  type VerticalHandInput,
  type VerticalMouseInput,
} from "../src/server/fit/vertical-candidate";
import {
  VERTICAL_CONFIG_A,
  VERTICAL_CONFIG_B,
  type VerticalCandidateConfig,
} from "../src/server/fit/vertical-candidate-constants";

// ── inputs ────────────────────────────────────────────────────────────────

const HAND_LENGTHS_MM = [160, 170, 180, 190, 200] as const;

/**
 * ASSUMPTION (not a measured population): palm width = 0.47 × hand length and
 * palm length = 0.58 × hand length. These are the ratios of the repo's own
 * test fixture (tests/unit/analysis-fixtures.ts: 180.4 / 105.2 / 84.6 mm). The
 * fixture is itself an invented example, so this is a guess that merely agrees
 * with the rest of the repo, not an anthropometric source.
 */
const PALM_WIDTH_RATIO = 0.47;
const PALM_LENGTH_RATIO = 0.58;

/**
 * ASSUMPTION, unconfirmed: the contract says the landmark palm width (joint
 * centre to joint centre) may sit 10–20 mm under the skin-to-skin breadth.
 * Whether the fixture ratio above is a skin or a landmark measurement is not
 * known, so the second scenario subtracts 12 mm (the middle of that range)
 * to show how much the answer moves.
 */
const LANDMARK_OFFSET_MM = 12;

/**
 * ASSUMPTION: which hand length counts as small / medium / large is not
 * defined by Logitech's pages (they only say "small to medium" and "medium to
 * large"). Labels below are only for reading the report.
 */
const HAND_LABEL: Record<number, string> = {
  160: "small",
  170: "small-medium",
  180: "medium",
  190: "medium-large",
  200: "large",
};

interface SeedRow {
  brand: string;
  model: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightG: number | null;
}

function loadVerticalMice(): Record<
  "lift" | "mx",
  VerticalMouseInput & { name: string }
> {
  const path = fileURLToPath(
    new URL("../src/db/seed/logitech.json", import.meta.url),
  );
  const rows = JSON.parse(readFileSync(path, "utf8")) as SeedRow[];
  const find = (model: string) => {
    const row = rows.find((r) => r.brand === "Logitech" && r.model === model);
    if (!row) throw new Error(`seed row not found: ${model}`);
    return {
      name: model,
      lengthMm: row.lengthMm,
      widthMm: row.widthMm,
      heightMm: row.heightMm,
    };
  };
  return { lift: find("Lift Vertical"), mx: find("MX Vertical") };
}

type Scenario = {
  id: string;
  note: string;
  palmWidthOf: (l: number) => number;
};

const SCENARIOS: Scenario[] = [
  {
    id: "S1",
    note: `palm width = ${PALM_WIDTH_RATIO} × hand length`,
    palmWidthOf: (l) => PALM_WIDTH_RATIO * l,
  },
  {
    id: "S2",
    note: `palm width = ${PALM_WIDTH_RATIO} × hand length − ${LANDMARK_OFFSET_MM} mm (landmark under-reads skin)`,
    palmWidthOf: (l) => PALM_WIDTH_RATIO * l - LANDMARK_OFFSET_MM,
  },
];

function handOf(lengthMm: number, scenario: Scenario): VerticalHandInput {
  return {
    handLengthMm: lengthMm,
    palmLengthMm: PALM_LENGTH_RATIO * lengthMm,
    palmWidthMm: scenario.palmWidthOf(lengthMm),
  };
}

function totalOf(
  hand: VerticalHandInput,
  mouse: VerticalMouseInput,
  config: VerticalCandidateConfig,
): number {
  const r = scoreVerticalCandidate(hand, mouse, config);
  if (!r.applicable) throw new Error(`not applicable: ${r.reason}`);
  return r.totalUnrounded;
}

// ── report ────────────────────────────────────────────────────────────────

const pad = (s: string | number, n: number) => String(s).padEnd(n);
const f1 = (n: number) => n.toFixed(1);

function printTable(mice: ReturnType<typeof loadVerticalMice>) {
  for (const scenario of SCENARIOS) {
    console.log(`\n## Scenario ${scenario.id}: ${scenario.note}`);
    console.log(
      [
        pad("handLen", 8),
        pad("label", 13),
        pad("palmW", 6),
        pad("mouse", 14),
        pad("length", 14),
        pad("height", 14),
        pad("widthProxy", 14),
        "total",
      ].join(" "),
    );
    for (const length of HAND_LENGTHS_MM) {
      const hand = handOf(length, scenario);
      for (const mouse of [mice.lift, mice.mx]) {
        const r = scoreVerticalCandidate(hand, mouse);
        if (!r.applicable) throw new Error(`not applicable: ${r.reason}`);
        const cell = (k: "length" | "height" | "widthProxy") => {
          const s = r.subscores[k];
          const sign = s.deltaMm >= 0 ? "+" : "";
          return `${s.score} (${sign}${f1(s.deltaMm)})`;
        };
        console.log(
          [
            pad(length, 8),
            pad(HAND_LABEL[length], 13),
            pad(f1(hand.palmWidthMm), 6),
            pad(mouse.name, 14),
            pad(cell("length"), 14),
            pad(cell("height"), 14),
            pad(cell("widthProxy"), 14),
            r.total,
          ].join(" "),
        );
      }
    }
  }
  console.log(
    "\n(cell = score (mouse dimension − target, mm); total = weighted mean 0–100)",
  );
}

/** The hand length at which both mice score equally, or null if no crossing in 140–220. */
function crossingHandLength(
  mice: ReturnType<typeof loadVerticalMice>,
  scenario: Scenario,
  config: VerticalCandidateConfig,
): number | null {
  let previous: number | null = null;
  for (let l = 140; l <= 220; l += 0.25) {
    const hand = handOf(l, scenario);
    const diff =
      totalOf(hand, mice.lift, config) - totalOf(hand, mice.mx, config);
    if (previous !== null && Math.sign(previous) !== Math.sign(diff)) return l;
    previous = diff;
  }
  return null;
}

function winners(
  mice: ReturnType<typeof loadVerticalMice>,
  scenario: Scenario,
  config: VerticalCandidateConfig,
): string {
  return HAND_LENGTHS_MM.map((l) => {
    const hand = handOf(l, scenario);
    const lift = totalOf(hand, mice.lift, config);
    const mx = totalOf(hand, mice.mx, config);
    return lift > mx ? "Lift" : "MX";
  }).join(" ");
}

function printOfficialCheck(mice: ReturnType<typeof loadVerticalMice>) {
  console.log("\n## Check against Logitech's stated hand sizes");
  console.log(
    "Lift: 'small to medium hands'; MX Vertical: 'large to medium hands' (product pages, re-read 2026-10-07).",
  );
  console.log(
    "Caveats: a weak check. The two mice scale together, so any target that crosses between them passes it,",
  );
  console.log(
    "and the 0.60 length factor was not chosen blind to the two catalogue lengths (see constants file).",
  );
  for (const scenario of SCENARIOS) {
    const at = (l: number, m: VerticalMouseInput) =>
      totalOf(handOf(l, scenario), m, VERTICAL_CONFIG_A);
    const liftSmall = Math.max(
      at(160, mice.lift),
      at(170, mice.lift),
      at(180, mice.lift),
    );
    const liftLarge = at(200, mice.lift);
    const mxLarge = Math.max(at(190, mice.mx), at(200, mice.mx));
    const mxSmall = at(160, mice.mx);
    const ok1 = liftSmall > liftLarge;
    const ok2 = mxLarge > mxSmall;
    console.log(
      `${scenario.id}: Lift best-of(160,170,180)=${f1(liftSmall)} vs Lift@200=${f1(liftLarge)} -> ${ok1 ? "PASS" : "FAIL"}; ` +
        `MX best-of(190,200)=${f1(mxLarge)} vs MX@160=${f1(mxSmall)} -> ${ok2 ? "PASS" : "FAIL"}`,
    );
    // Extra, informational: which mouse wins outright at the two ends and at
    // medium-large (190). Logitech does not rank the two against each other.
    const winner = (l: number) =>
      at(l, mice.lift) > at(l, mice.mx) ? "Lift" : "MX";
    console.log(
      `${scenario.id}: outright winner at 160=${winner(160)}, 190=${winner(190)}, 200=${winner(200)} (expected by a naive reading: Lift, MX, MX)`,
    );
  }
}

function withFactor(
  base: VerticalCandidateConfig,
  key: "length" | "height" | "widthProxy" | "all",
  multiplier: number,
): VerticalCandidateConfig {
  const t = base.targets;
  const scale = (r: { source: typeof t.length.source; factor: number }) => ({
    source: r.source,
    factor: r.factor * multiplier,
  });
  return {
    ...base,
    targets: {
      length: key === "length" || key === "all" ? scale(t.length) : t.length,
      height: key === "height" || key === "all" ? scale(t.height) : t.height,
      widthProxy:
        key === "widthProxy" || key === "all"
          ? scale(t.widthProxy)
          : t.widthProxy,
    },
  };
}

function printSensitivity(mice: ReturnType<typeof loadVerticalMice>) {
  console.log(
    "\n## Sensitivity: which mouse scores higher at hand length 160 / 170 / 180 / 190 / 200",
  );
  console.log(
    "'flip' = the ranking at any of the five hand lengths differs from the baseline; 'cross' = hand length where the two totals tie.",
  );
  for (const scenario of SCENARIOS) {
    console.log(`\n${scenario.id}: ${scenario.note}`);
    const base = winners(mice, scenario, VERTICAL_CONFIG_A);
    const baseCross = crossingHandLength(mice, scenario, VERTICAL_CONFIG_A);
    console.log(
      `${pad("variant", 30)} ${pad("winners", 22)} ${pad("cross", 8)} flip`,
    );
    console.log(
      `${pad("baseline (mapping A)", 30)} ${pad(base, 22)} ${pad(baseCross === null ? "none" : f1(baseCross), 8)} -`,
    );
    const variants: [string, VerticalCandidateConfig][] = [];
    for (const key of ["length", "height", "widthProxy", "all"] as const) {
      for (const m of [0.9, 1.1]) {
        variants.push([
          `${key} target ×${m.toFixed(2)}`,
          withFactor(VERTICAL_CONFIG_A, key, m),
        ]);
      }
    }
    variants.push(["mapping B (height ← handLen)", VERTICAL_CONFIG_B]);
    for (const [name, config] of variants) {
      const w = winners(mice, scenario, config);
      const c = crossingHandLength(mice, scenario, config);
      console.log(
        `${pad(name, 30)} ${pad(w, 22)} ${pad(c === null ? "none" : f1(c), 8)} ${w === base ? "no" : "YES"}`,
      );
    }
  }
}

function main() {
  const mice = loadVerticalMice();
  console.log("# Vertical-mouse candidate spike  [未拍板（candidate）]");
  console.log(
    "Hands are synthetic. Mouse sizes from src/db/seed/logitech.json (Lift 108×70×71 mm, MX Vertical 120×79×78.5 mm).",
  );
  console.log(
    "Mapping A: length ← 0.60·handLength, height ← 0.90·palmWidth, widthProxy ← 0.88·palmWidth. No basis; starting points.",
  );
  printTable(mice);
  printOfficialCheck(mice);
  printSensitivity(mice);
}

main();
