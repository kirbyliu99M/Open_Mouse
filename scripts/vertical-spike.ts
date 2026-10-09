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
 * PHASE 2 (palm thickness, 未拍板) is printed after phase 1, under the heading
 * "PHASE 2". It compares three wirings of a user-chosen thin / medium / thick
 * input (A direction prior, B cross-section correspondence, C no thickness)
 * on synthetic hands × thickness × the two mice × the four grip stations.
 *
 * Every hand here is SYNTHETIC. The proportions are assumptions, stated next
 * to each use. No real person's data is involved. The section numbers come
 * from unverified AR-reconstructed shells (see vertical-candidate-sections.ts).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  scoreVerticalCandidate,
  type VerticalHandInput,
  type VerticalMouseInput,
} from "../src/server/fit/vertical-candidate";
import {
  PALM_THICKNESS_LEVELS,
  PALM_THICKNESS_SCALE_PLACEHOLDER,
  SECTION_RATIO_TO_PALM_WIDTH,
  THICKNESS_PRIOR_STEP,
  VERTICAL_CONFIG_A,
  VERTICAL_CONFIG_B,
  VERTICAL_WIRING_A_PRIOR,
  VERTICAL_WIRING_B_REVERSED,
  VERTICAL_WIRING_B_SECTION,
  VERTICAL_WIRING_C_NONE,
  makeSectionWiring,
  type PalmThicknessLevel,
  type SectionQuantity,
  type VerticalCandidateConfig,
} from "../src/server/fit/vertical-candidate-constants";
import {
  VERTICAL_SECTION_STATIONS,
  sectionsForModel,
} from "../src/server/fit/vertical-candidate-sections";

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
      sections: sectionsForModel(model),
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

function handOf(
  lengthMm: number,
  scenario: Scenario,
  palmThickness?: PalmThicknessLevel,
): VerticalHandInput {
  return {
    handLengthMm: lengthMm,
    palmLengthMm: PALM_LENGTH_RATIO * lengthMm,
    palmWidthMm: scenario.palmWidthOf(lengthMm),
    ...(palmThickness ? { palmThickness } : {}),
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
  console.log("## PHASE 1 (palm thickness not used)");
  console.log(
    "Hands are synthetic. Mouse sizes from src/db/seed/logitech.json (Lift 108×70×71 mm, MX Vertical 120×79×78.5 mm).",
  );
  console.log(
    "Mapping A: length ← 0.60·handLength, height ← 0.90·palmWidth, widthProxy ← 0.88·palmWidth. No basis; starting points.",
  );
  printTable(mice);
  printOfficialCheck(mice);
  printSensitivity(mice);
  printPhase2(mice);
}

// ── PHASE 2: palm thickness (未拍板) ──────────────────────────────────────

type Mice = ReturnType<typeof loadVerticalMice>;
type Level = PalmThicknessLevel | undefined;

interface Wiring {
  id: string;
  label: string;
  config: VerticalCandidateConfig;
  /** Levels shown for this wiring. C ignores the level, so it has one row. */
  levels: readonly Level[];
}

const LEVELS: readonly PalmThicknessLevel[] = PALM_THICKNESS_LEVELS;
const levelName = (l: Level) => l ?? "(none)";

const WIRINGS: Wiring[] = [
  {
    id: "C",
    label: "C    control: thickness ignored (= phase 1)",
    config: VERTICAL_WIRING_C_NONE,
    levels: [undefined],
  },
  {
    id: "A",
    label: `A    direction prior: every size target × (1 − ${THICKNESS_PRIOR_STEP} × ordinal)`,
    config: VERTICAL_WIRING_A_PRIOR,
    levels: LEVELS,
  },
  {
    id: "B",
    label:
      "B    section: width-proxy slot ← mean min Feret of ny 0.4–0.7; thick → smaller target",
    config: VERTICAL_WIRING_B_SECTION,
    levels: LEVELS,
  },
  {
    id: "Brev",
    label:
      "Brev contrast only: B with the sign flipped (thick → larger target)",
    config: VERTICAL_WIRING_B_REVERSED,
    levels: LEVELS,
  },
];

function total2(
  hand: VerticalHandInput,
  mouse: VerticalMouseInput,
  config: VerticalCandidateConfig,
): number {
  const r = scoreVerticalCandidate(hand, mouse, config);
  if (!r.applicable) throw new Error(`not applicable: ${r.reason}`);
  return r.totalUnrounded;
}

/** Larger-mouse advantage: MX total − Lift total for one hand and level. */
function advantage(
  mice: Mice,
  scenario: Scenario,
  config: VerticalCandidateConfig,
  length: number,
  level: Level,
): number {
  const hand = handOf(length, scenario, level);
  return total2(hand, mice.mx, config) - total2(hand, mice.lift, config);
}

/**
 * Hand lengths (mm) where Lift and MX tie, between 100 and 260 mm. Coarse scan
 * for sign changes, then bisection on the continuous (unrounded) totals.
 */
function crossings(
  mice: Mice,
  scenario: Scenario,
  config: VerticalCandidateConfig,
  level: Level,
): number[] {
  const f = (l: number) => advantage(mice, scenario, config, l, level);
  const found: number[] = [];
  let lo = 100;
  let flo = f(lo);
  for (let l = 100.5; l <= 260; l += 0.5) {
    const fl = f(l);
    if (flo !== 0 && Math.sign(fl) !== Math.sign(flo)) {
      let a = lo;
      let b = l;
      const fa = flo;
      for (let i = 0; i < 50; i++) {
        const m = (a + b) / 2;
        if (Math.sign(f(m)) === Math.sign(fa)) a = m;
        else b = m;
      }
      found.push((a + b) / 2);
    }
    lo = l;
    flo = fl;
  }
  return found;
}

const crossText = (c: number[]) =>
  c.length === 0
    ? "none"
    : c.length === 1
      ? c[0]!.toFixed(1)
      : `${c.map((x) => x.toFixed(1)).join("/")}*`;

const rangeOf = (xs: (number | undefined)[]): string =>
  xs.every((x) => x !== undefined)
    ? f1(Math.max(...(xs as number[])) - Math.min(...(xs as number[])))
    : "n/a";

function printWiringDefinitions() {
  console.log("\n### Wirings (all 未拍板 / candidate; no number has a basis)");
  console.log(
    `Level placeholders: ordinal thin/medium/thick = -1/0/+1; scale ${LEVELS.map((l) => `${l} ${PALM_THICKNESS_SCALE_PLACEHOLDER[l]}`).join(", ")} (arbitrary, no mm claim).`,
  );
  for (const w of WIRINGS) console.log(`  ${w.label}`);
  console.log(
    `  B reference ratio (section quantity ÷ palm width at medium): ${Object.entries(
      SECTION_RATIO_TO_PALM_WIDTH,
    )
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );
  console.log(
    "  Evidence for the sign: ONE third-party sentence about a different mouse class (Contour Perfit sizing page). A direction, not a size.",
  );
}

function printSectionInputs(mice: Mice) {
  console.log("\n### Section inputs (SEC-2 literals, unverified shells, mm)");
  console.log(
    `${pad("mouse", 14)} ${pad("ny", 5)} ${pad("minFeret", 9)} ${pad("rectShort", 10)} ${pad("girth", 8)} ${pad("axisW", 7)}`,
  );
  for (const m of [mice.lift, mice.mx]) {
    for (const st of m.sections ?? []) {
      console.log(
        `${pad(m.name, 14)} ${pad(st.ny, 5)} ${pad(f1(st.minFeretMm), 9)} ${pad(f1(st.minRectShortMm), 10)} ${pad(f1(st.outerGirthMm), 8)} ${pad(f1(st.widthMm), 7)}`,
      );
    }
  }
}

function printMatrix(mice: Mice) {
  console.log(
    "\n### Totals 'Lift/MX' (0–100, rounded) by wiring × thickness × hand length",
  );
  for (const scenario of SCENARIOS) {
    console.log(`\n${scenario.id}: ${scenario.note}`);
    console.log(
      `${pad("wiring", 6)} ${pad("level", 8)} ${HAND_LENGTHS_MM.map((l) => pad(l, 9)).join(" ")}`,
    );
    for (const w of WIRINGS) {
      for (const level of w.levels) {
        const cells = HAND_LENGTHS_MM.map((l) => {
          const hand = handOf(l, scenario, level);
          const lift = Math.round(total2(hand, mice.lift, w.config));
          const mx = Math.round(total2(hand, mice.mx, w.config));
          return pad(`${lift}/${mx}`, 9);
        });
        console.log(
          `${pad(w.id, 6)} ${pad(levelName(level), 8)} ${cells.join(" ")}`,
        );
      }
    }
  }
}

function printSectionDetail(mice: Mice) {
  const scenario = SCENARIOS[0]!;
  console.log(
    `\n### Wiring B detail at hand length 180 mm (${scenario.id}): the width-proxy slot`,
  );
  console.log(
    `${pad("level", 8)} ${pad("mouse", 14)} ${pad("mouse minFeret(mean)", 21)} ${pad("target", 8)} ${pad("delta", 8)} ${pad("score", 6)} reason`,
  );
  for (const level of LEVELS) {
    for (const m of [mice.lift, mice.mx]) {
      const r = scoreVerticalCandidate(
        handOf(180, scenario, level),
        m,
        VERTICAL_WIRING_B_SECTION,
      );
      if (!r.applicable) throw new Error(r.reason);
      const w = r.subscores.widthProxy;
      console.log(
        `${pad(level, 8)} ${pad(m.name, 14)} ${pad(f1(r.thickness!.section!.mouseMm), 21)} ${pad(f1(w.targetMm), 8)} ${pad(f1(w.deltaMm), 8)} ${pad(w.score, 6)} ${w.reason}`,
      );
    }
  }
}

function printCheck1(mice: Mice) {
  console.log(
    "\n### Check 1: does a thin hand get the larger mouse and a thick palm the smaller one?",
  );
  console.log(
    "Two readings. (i) Crossover order: the hand length where Lift and MX tie should be thin < medium < thick (a thin hand needs a shorter hand to switch to the larger mouse).",
  );
  console.log(
    "(ii) Near the crossover (medium tie ±8 mm, step 2): larger-mouse advantage = MX total − Lift total should be thin > medium > thick at the same hand; 'near' = hands where it holds / 9.",
  );
  console.log(
    "(Far from the crossover the advantage is NOT monotone in thickness: a small hand is better served by the smaller mouse whichever way the targets move, so a whole-range version of (ii) would be a wrong test.)",
  );
  const rows: [string, VerticalCandidateConfig][] = [
    ["A prior", VERTICAL_WIRING_A_PRIOR],
    ["B mean 0.4-0.7", VERTICAL_WIRING_B_SECTION],
    ...VERTICAL_SECTION_STATIONS.map(
      (ny): [string, VerticalCandidateConfig] => [
        `B ny=${ny}`,
        {
          ...VERTICAL_CONFIG_A,
          thickness: makeSectionWiring({ stations: [ny] }),
        },
      ],
    ),
    ["Brev mean", VERTICAL_WIRING_B_REVERSED],
  ];
  for (const scenario of SCENARIOS) {
    console.log(`\n${scenario.id}: ${scenario.note}`);
    console.log(
      `${pad("variant", 16)} ${pad("tie thin/med/thick (mm)", 28)} ${pad("(i) order", 10)} ${pad("(ii) near", 10)}`,
    );
    for (const [name, config] of rows) {
      const ties = LEVELS.map((l) => crossings(mice, scenario, config, l)[0]);
      const orderOk =
        ties.every((x) => x !== undefined) &&
        ties[0]! < ties[1]! &&
        ties[1]! < ties[2]!;
      const mid = ties[1];
      let near = "n/a";
      if (mid !== undefined) {
        let ok = 0;
        let n = 0;
        for (let d = -8; d <= 8; d += 2) {
          const l = mid + d;
          const thin = advantage(mice, scenario, config, l, "thin");
          const med = advantage(mice, scenario, config, l, "medium");
          const thick = advantage(mice, scenario, config, l, "thick");
          n++;
          if (thin > med && med > thick) ok++;
        }
        near = `${ok}/${n}`;
      }
      console.log(
        `${pad(name, 16)} ${pad(ties.map((x) => (x === undefined ? "none" : f1(x))).join(" / "), 28)} ${pad(orderOk ? "holds" : "BROKEN", 10)} ${pad(near, 10)}`,
      );
    }
  }
  console.log(
    "Reading: A holds by construction (every target moves with the sign). B holds or breaks depending on the station, because the real section numbers of the two mice enter the Gaussian and the thickness effect only reaches the 0.2-weight slot. Brev has the opposite sign and should break, which shows the check can fail.",
  );
}

function printCheck2(mice: Mice) {
  console.log(
    "\n### Check 2: Logitech's guidance (Lift 'small to medium', MX Vertical 'large to medium') by wiring and level",
  );
  console.log(
    "Same rule as phase 1: Lift best-of(160,170,180) > Lift@200, and MX best-of(190,200) > MX@160. Margins in total points.",
  );
  console.log(
    `${pad("scenario", 9)} ${pad("wiring", 7)} ${pad("level", 8)} ${pad("Lift small vs large", 22)} ${pad("MX large vs small", 20)}`,
  );
  const sign = (x: number) => `${x >= 0 ? "+" : ""}${f1(x)}`;
  for (const scenario of SCENARIOS) {
    for (const w of WIRINGS) {
      for (const level of w.levels) {
        const at = (l: number, m: VerticalMouseInput) =>
          total2(handOf(l, scenario, level), m, w.config);
        const liftSmall = Math.max(
          at(160, mice.lift),
          at(170, mice.lift),
          at(180, mice.lift),
        );
        const liftMargin = liftSmall - at(200, mice.lift);
        const mxMargin =
          Math.max(at(190, mice.mx), at(200, mice.mx)) - at(160, mice.mx);
        console.log(
          `${pad(scenario.id, 9)} ${pad(w.id, 7)} ${pad(levelName(level), 8)} ${pad(`${liftMargin > 0 ? "PASS" : "FAIL"} (${sign(liftMargin)})`, 22)} ${pad(`${mxMargin > 0 ? "PASS" : "FAIL"} (${sign(mxMargin)})`, 20)}`,
        );
      }
    }
  }
}

function printCheck3(mice: Mice) {
  console.log(
    "\n### Check 3: sensitivity of the Lift/MX crossover (hand length in mm where the two totals tie)",
  );
  console.log(
    "Scan 100–260 mm; 'none' = no tie in that range; '*' = more than one tie (all listed).",
  );
  const stationRows = VERTICAL_SECTION_STATIONS.map(
    (ny): [string, VerticalCandidateConfig] => [
      `B ny=${ny}`,
      {
        ...VERTICAL_CONFIG_A,
        thickness: makeSectionWiring({ stations: [ny] }),
      },
    ],
  );
  const rows: [string, VerticalCandidateConfig, readonly Level[]][] = [
    ["C no thickness", VERTICAL_WIRING_C_NONE, [undefined]],
    ["A prior", VERTICAL_WIRING_A_PRIOR, LEVELS],
    ...stationRows.map(
      ([n, c]): [string, VerticalCandidateConfig, readonly Level[]] => [
        n,
        c,
        LEVELS,
      ],
    ),
    ["B mean 0.4-0.7", VERTICAL_WIRING_B_SECTION, LEVELS],
    ["Brev mean", VERTICAL_WIRING_B_REVERSED, LEVELS],
  ];
  for (const scenario of SCENARIOS) {
    console.log(`\n${scenario.id}: ${scenario.note}`);
    console.log(
      `${pad("variant", 16)} ${pad("thin", 10)} ${pad("medium", 10)} ${pad("thick", 10)} spread across levels (mm)`,
    );
    const firsts = new Map<string, (number | undefined)[]>();
    for (const [name, config, levels] of rows) {
      const cs = levels.map((l) => crossings(mice, scenario, config, l));
      firsts.set(
        name,
        cs.map((c) => c[0]),
      );
      if (levels.length === 1) {
        console.log(
          `${pad(name, 16)} ${crossText(cs[0]!)}  (one value; level ignored)`,
        );
        continue;
      }
      console.log(
        `${pad(name, 16)} ${cs.map((c) => pad(crossText(c), 10)).join(" ")} ${rangeOf(cs.map((c) => c[0]))}`,
      );
    }
    console.log(
      "  Movement caused by the grip station alone (B, single stations ny 0.4–0.7), per level:",
    );
    LEVELS.forEach((level, i) => {
      const xs = stationRows.map(([n]) => firsts.get(n)![i]);
      console.log(`    ${pad(level, 8)} range ${rangeOf(xs)} mm`);
    });
  }
}

function printSensitivityKnobs(mice: Mice) {
  console.log(
    "\n### Extra sensitivity: quantity, step and scale (crossover hand length, S1; thin / medium / thick)",
  );
  const scenario = SCENARIOS[0]!;
  const variants: [string, VerticalCandidateConfig][] = [];
  for (const q of [
    "minFeretMm",
    "minRectShortMm",
    "outerGirthMm",
    "widthAxisMm",
  ] as SectionQuantity[]) {
    variants.push([
      `B quantity ${q}`,
      { ...VERTICAL_CONFIG_A, thickness: makeSectionWiring({ quantity: q }) },
    ]);
  }
  variants.push([
    "B scale 0.92/1/1.08",
    {
      ...VERTICAL_CONFIG_A,
      thickness: makeSectionWiring({
        scale: { thin: 0.92, medium: 1, thick: 1.08 },
      }),
    },
  ]);
  for (const step of [0.03, 0.05, 0.08]) {
    variants.push([
      `A step ${step}`,
      {
        ...VERTICAL_CONFIG_A,
        thickness: { kind: "prior", stepPerOrdinal: step },
      },
    ]);
  }
  console.log(`${pad("variant", 28)} thin / medium / thick`);
  for (const [name, config] of variants) {
    console.log(
      `${pad(name, 28)} ${LEVELS.map((l) => crossText(crossings(mice, scenario, config, l))).join(" / ")}`,
    );
  }
}

function printPhase2(mice: Mice) {
  console.log("\n\n# PHASE 2: palm thickness input  [未拍板（candidate）]");
  console.log(
    "Nothing below changes any existing score, ranking, scoreFit or ENGINE_VERSION. No number here has a basis.",
  );
  printWiringDefinitions();
  printSectionInputs(mice);
  printMatrix(mice);
  printSectionDetail(mice);
  printCheck1(mice);
  printCheck2(mice);
  printCheck3(mice);
  printSensitivityKnobs(mice);
  console.log(`
### Why these checks are weak (read before quoting any number above)
- The two mice are the SAME shape at two scales (Lift 108×70×71, MX 120×79×78.5; MX ÷ Lift is about 1.12–1.14 in min Feret and 1.07–1.12 in girth at the four stations). Almost any target that rises with hand size gives "Lift for smaller hands, MX for larger", so passing says very little about the model.
- The only external evidence is two sentences from Logitech ("small to medium", "large to medium") and one off-class third-party sentence for the thickness direction. There is no human grip data.
- The 0.60 / 0.90 / 0.88 factors and the B ratios were set after looking at the two catalogue mice, so the guidance check is not independent of them.
- Palm width is assumed (0.47 × hand length in S1, 12 mm less in S2); the crossover moves with that choice alone (compare S1 and S2).
- Do not read any of this as "the model is credible".

### Can these section quantities stand for the palm-contact surface?
Cannot confirm. They are geometric descriptors of unverified AR-reconstructed shells at stations (0.4–0.7) chosen by assumption. Missing and needed: for real people holding these two mice, (1) the palm and finger contact region and its height, (2) a measured hand thickness (not a thin / medium / thick label), (3) where along the mouse the palm actually rests. Without those, "min Feret vs thickness" is an analogy, not a measurement.`);
}

main();
