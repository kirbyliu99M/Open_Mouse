/**
 * Scan error budget (SIMULATION, not measurement): the condition list, the
 * orchestration and the Markdown rendering on top of scan-error-budget-core.ts.
 * Pure: no files, no clock, no console. `scripts/scan-error-budget.ts` is the
 * command-line wrapper.
 *
 * Primary scenario (2026-10-16, Kirby): the product captures a FRAME OF THE
 * VIDEO (`CAMERA_CONSTANTS.capture.source = "frame"`), which has no EXIF. The
 * focal length can then only come from the paper homography, which is
 * unobservable for a near-frontal sheet (Sturm & Maybank 1999), so the
 * pipeline often judges it unreliable and falls back to no parallax
 * correction. Section 1 reports that; EXIF is kept only as a comparison.
 */
import {
  FOCAL_PX,
  HAND_SIZES_MM,
  IMAGE_HEIGHT_PX,
  IMAGE_WIDTH_PX,
  JOINT_PROFILES,
  NO_PERTURBATION,
  PAPER,
  SOURCE_LABELS,
  decompose,
  drawScenes,
  fixed,
  jointPerturbation,
  normal,
  poolConditions,
  runCondition,
  singleSourcePerturbation,
  uniform,
  type ConditionResult,
  type Decomposition,
  type ErrorStats,
  type FocalMode,
  type JointProfile,
  type Perturbation,
  type Scene,
  type SourceKey,
} from "./scan-error-budget-core";

// ── The sweep axes ───────────────────────────────────────────────────────

/** The real tilt distribution is unknown, so the tilt cap is swept. Tilt is uniform in [0, cap]. */
export const TILT_CAPS_DEG = [10, 20, 30, 45] as const;

/**
 * Fixed prior errors for the break-even search, relative to the true focal
 * length: -60% to +100% in 10% steps, then +125%, +150% and +200% (the upper
 * crossing is far out; the lower one, where the prior is too short, is close).
 */
export const PRIOR_GRID: readonly number[] = [
  ...Array.from(
    { length: 17 },
    (_, i) => Math.round((-0.6 + 0.1 * i) * 10) / 10,
  ),
  1.25,
  1.5,
  2,
];

/** Half-widths of a prior whose error is uniform per scan (a phone-to-phone spread). */
export const PRIOR_UNIFORM_HALVES: readonly number[] = [0.1, 0.2, 0.3];

/**
 * The prior error that stands in for the candidate fix in the Sigma and bias
 * numbers: uniform in ±20% per scan, centred on the 26 mm-equivalent value.
 * Self-set: there is no data on the spread of main-camera focal lengths.
 */
export const REPRESENTATIVE_PRIOR_HALF = 0.2;

/**
 * Between-person standard deviation of the difference between two ways of
 * measuring the same hand, from Rogers 2008 as read in the synthesis report
 * (hand length 5.6 mm, hand breadth 3.4 mm; it mixes posture and landmark
 * differences, so it is an order of magnitude, not the definition offset).
 */
export const ROGERS_DEFINITION_SD_MM = { length: 5.6, width: 3.4 } as const;

// ── One-at-a-time conditions (EXIF with the true focal, so only the swept source acts) ──

export interface NamedCondition {
  readonly group: string;
  readonly name: string;
  readonly perturbation: Perturbation;
}

const lmBias = (length: number, width: number): Perturbation => ({
  ...NO_PERTURBATION,
  landmarkBiasMm: { length: fixed(length), width: fixed(width) },
});

const signedMm = (x: number): string => (x > 0 ? `+${x}` : `${x}`);

export function singleSourceConditions(): NamedCondition[] {
  const rows: NamedCondition[] = [
    { group: "對照", name: "無擾動", perturbation: NO_PERTURBATION },
    {
      group: "對照",
      name: "不做視差修正（computeHandMeasurements，無擾動）",
      perturbation: { ...NO_PERTURBATION, parallaxCorrection: false },
    },
  ];
  for (const sigma of [0.5, 1, 2]) {
    rows.push({
      group: "紙角噪音",
      name: `紙角 σ_c = ${sigma} px`,
      perturbation: { ...NO_PERTURBATION, cornerSigmaPx: sigma },
    });
  }
  for (const sigma of [1, 2, 4]) {
    rows.push({
      group: "landmark 噪音",
      name: `landmark σ_l = ${sigma} px`,
      perturbation: { ...NO_PERTURBATION, landmarkSigmaPx: sigma },
    });
  }
  // Systematic landmark displacement. NO source for the range: self-set.
  for (const mm of [-4, -2, 2, 4]) {
    rows.push({
      group: "landmark 系統性偏差（無來源，自設）",
      name: `手長軸 ${signedMm(mm)} mm（0→12 距離變長為正）`,
      perturbation: lmBias(mm, 0),
    });
  }
  for (const mm of [-4, -2, 2, 4]) {
    rows.push({
      group: "landmark 系統性偏差（無來源，自設）",
      name: `掌寬軸 ${signedMm(mm)} mm（5↔17 距離變寬為正）`,
      perturbation: lmBias(0, mm),
    });
  }
  for (const rel of [-0.1, -0.03, 0.03, 0.1]) {
    rows.push({
      group: "focal 誤差",
      name: `EXIF focal ${rel > 0 ? "+" : ""}${Math.round(rel * 100)}%`,
      perturbation: { ...NO_PERTURBATION, focalRel: fixed(rel) },
    });
  }
  // 0.8 to 1.2 is covered by sources; 0.6 and 1.4 have none.
  for (const scale of [0.6, 0.8, 1.2, 1.4]) {
    rows.push({
      group: "關節高度",
      name: `全部關節高度 ×${scale}（${scale === 0.8 || scale === 1.2 ? "有來源" : "無來源，自設"}）`,
      perturbation: { ...NO_PERTURBATION, heightScale: fixed(scale) },
    });
  }
  rows.push({
    group: "關節高度",
    name: "逐關節隨機 ±30%（無來源，自設）",
    perturbation: { ...NO_PERTURBATION, heightJitterHalf: 0.3 },
  });
  // AIST per-finger thickness halved vs the third-metacarpal proxy.
  for (const [index, little, label] of [
    [1.4, 2.2, "男"],
    [1.8, 3.0, "女"],
    [3.0, 3.0, "上限"],
  ] as const) {
    rows.push({
      group: "關節高度",
      name: `MCP 2／5 固定偏低 ${index}／${little} mm（AIST ${label}）`,
      perturbation: {
        ...NO_PERTURBATION,
        mcpHeightOffsetMm: { index, little },
      },
    });
  }
  // Definition offsets: two-sided, with a SD. Length: AIST L01 - L02 = +6.2 / +6.1
  // and Jee 2016 -7.5 / -7.3 (group means, opposite signs); Rogers 2008 between-person SD 5.6 mm.
  for (const [mm, label] of [
    [6.2, "AIST 型 +6.2"],
    [-7.5, "Jee 型 −7.5"],
  ] as const) {
    rows.push({
      group: "定義偏移（手長）",
      name: `手長 ${label} mm（群體均值差，雙向）`,
      perturbation: {
        ...NO_PERTURBATION,
        definitionOffsetMm: { length: fixed(mm), width: fixed(0) },
      },
    });
  }
  rows.push({
    group: "定義偏移（手長）",
    name: `手長 個人差 N(0, ${ROGERS_DEFINITION_SD_MM.length}²)（Rogers 量級）`,
    perturbation: {
      ...NO_PERTURBATION,
      definitionOffsetMm: {
        length: normal(0, ROGERS_DEFINITION_SD_MM.length),
        width: fixed(0),
      },
    },
  });
  // Width: 10 to 20 mm if the target is the ISO hand breadth (LOW confidence, a PIP-width proxy
  // and an unsourced contract comment); 0 if the coefficients are re-estimated on landmark distances.
  for (const mm of [10, 15, 20]) {
    rows.push({
      group: "定義偏移（掌寬，低信心）",
      name: `掌寬 +${mm} mm（若目標是 ISO 手寬）`,
      perturbation: {
        ...NO_PERTURBATION,
        definitionOffsetMm: { length: fixed(0), width: fixed(mm) },
      },
    });
  }
  rows.push({
    group: "定義偏移（掌寬，低信心）",
    name: `掌寬 個人差 N(0, ${ROGERS_DEFINITION_SD_MM.width}²)（Rogers 量級）`,
    perturbation: {
      ...NO_PERTURBATION,
      definitionOffsetMm: {
        length: fixed(0),
        width: normal(0, ROGERS_DEFINITION_SD_MM.width),
      },
    },
  });
  for (const k1 of [-0.05, -0.02, 0.02, 0.05]) {
    rows.push({
      group: "徑向畸變",
      name: `k1 = ${k1 > 0 ? "+" : ""}${k1}（無來源，自設）`,
      perturbation: { ...NO_PERTURBATION, k1: fixed(k1) },
    });
  }
  return rows;
}

// ── The frame (no EXIF) scenario ─────────────────────────────────────────

/** One run of the candidate prior policy. */
export interface PriorRun {
  readonly label: string;
  /** `nominal`: the prior replaces an unreliable estimate; `nominalOnly`: the prior is always used. */
  readonly mode: "nominal" | "nominalOnly";
  /** `fixed`: every scan's prior is off by `rel`; `uniform`: uniform in ±`rel` per scan. */
  readonly kind: "fixed" | "uniform";
  readonly rel: number;
  readonly result: ConditionResult;
}

/** A different lens (ultra-wide or tele) whose prior is still the 26 mm-equivalent main camera. */
export interface LensRun {
  readonly label: string;
  readonly focalScale: number;
  readonly current: ConditionResult;
  readonly nominal: ConditionResult;
}

export interface FrameCell {
  readonly tiltMaxDeg: number;
  /** The product's current policy: estimate f from the corners, no correction when unreliable. */
  readonly current: ConditionResult;
  readonly priors: PriorRun[];
  readonly lenses: LensRun[];
}

export interface FrameProfileResult {
  readonly profile: JointProfile;
  readonly cells: FrameCell[];
}

function priorLabel(
  mode: PriorRun["mode"],
  kind: PriorRun["kind"],
  rel: number,
): string {
  const pct = Math.round(rel * 100);
  const head = mode === "nominal" ? "先驗補位" : "只用先驗";
  return kind === "fixed"
    ? `${head}，先驗誤差 ${pct > 0 ? "+" : ""}${pct}%`
    : `${head}，先驗誤差 ±${pct}%（逐掃描均勻）`;
}

export interface FrameOptions {
  /** Which prior runs to do. Default: the whole grid, the uniform spreads and the prior-only variants. */
  readonly fixedGrid?: readonly number[];
  readonly uniformHalves?: readonly number[];
  readonly onlyHalves?: readonly number[];
  /** Also run the ultra-wide and tele lenses (used for one profile). */
  readonly lenses?: boolean;
}

/** All frame conditions of one joint profile at one tilt cap. */
export function buildFrameCell(
  seed: number,
  n: number,
  profile: JointProfile,
  tiltMaxDeg: number,
  options: FrameOptions = {},
  scenes?: readonly Scene[],
): FrameCell {
  const fixedGrid = options.fixedGrid ?? PRIOR_GRID;
  const uniformHalves = options.uniformHalves ?? PRIOR_UNIFORM_HALVES;
  const onlyHalves = options.onlyHalves ?? [0, 0.1, 0.2, 0.3];
  const sceneList = scenes ?? drawScenes(seed, n, { tiltMaxDeg });
  const run = (
    name: string,
    mode: FocalMode,
    extra: Partial<Perturbation>,
    list: readonly Scene[] = sceneList,
  ) =>
    runCondition(seed, n, name, jointPerturbation(profile, mode, extra), list);

  const current = run(
    `${profile.name}，傾斜 ≤ ${tiltMaxDeg}°，現況（無 EXIF）`,
    "homography",
    {},
  );
  const priors: PriorRun[] = [];
  const addPrior = (
    mode: PriorRun["mode"],
    kind: PriorRun["kind"],
    rel: number,
  ) => {
    const label = priorLabel(mode, kind, rel);
    priors.push({
      label,
      mode,
      kind,
      rel,
      result: run(label, mode, {
        nominalPriorRel: kind === "fixed" ? fixed(rel) : uniform(-rel, rel),
      }),
    });
  };
  for (const rel of fixedGrid) addPrior("nominal", "fixed", rel);
  for (const half of uniformHalves) addPrior("nominal", "uniform", half);
  for (const half of onlyHalves) {
    addPrior("nominalOnly", half === 0 ? "fixed" : "uniform", half);
  }

  const lenses: LensRun[] = [];
  if (options.lenses) {
    for (const [focalScale, label] of [
      [0.5, "ultra-wide 被當成主鏡頭（真實 f = 0.5×）"],
      [2, "2× tele 被當成主鏡頭（真實 f = 2×）"],
    ] as const) {
      const list = drawScenes(seed, n, { tiltMaxDeg, focalScale });
      lenses.push({
        label,
        focalScale,
        current: run(`${label}，現況`, "homography", {}, list),
        nominal: run(
          `${label}，先驗補位（先驗 = 26 mm 等效）`,
          "nominal",
          { nominalPriorRel: fixed(0) },
          list,
        ),
      });
    }
  }
  return { tiltMaxDeg, current, priors, lenses };
}

// ── Break-even ───────────────────────────────────────────────────────────

export interface BreakEven {
  /** True when the prior policy never gets as good as no correction anywhere on the grid. */
  readonly neverBetter: boolean;
  /** Lowest prior error (relative to the true focal) at which the prior is at least as good as no correction. Equals the grid's lower end when `lowerOpen`. */
  readonly lower: number;
  /** True when the prior is already at least as good at the grid's lower end (the true crossing is further out). */
  readonly lowerOpen: boolean;
  readonly upper: number;
  readonly upperOpen: boolean;
  /** The grid point with the smallest RMS. */
  readonly bestRel: number;
  readonly bestRms: number;
}

/**
 * Where, along the prior-error grid, the prior policy's RMS on the fallback
 * scans stops beating the no-correction RMS `flatRms`: linear interpolation
 * between grid points on each side of the better interval.
 */
export function breakEven(
  points: ReadonlyArray<{ readonly rel: number; readonly rms: number }>,
  flatRms: number,
): BreakEven {
  const sorted = [...points].sort((a, b) => a.rel - b.rel);
  const best = sorted.reduce((b, p) => (p.rms < b.rms ? p : b), sorted[0]);
  const better = sorted.map((p) => p.rms <= flatRms);
  const first = better.indexOf(true);
  const last = better.lastIndexOf(true);
  if (first < 0) {
    return {
      neverBetter: true,
      lower: NaN,
      lowerOpen: false,
      upper: NaN,
      upperOpen: false,
      bestRel: best.rel,
      bestRms: best.rms,
    };
  }
  const cross = (worse: number, good: number): number => {
    const a = sorted[worse];
    const b = sorted[good];
    return a.rel + ((flatRms - a.rms) / (b.rms - a.rms)) * (b.rel - a.rel);
  };
  return {
    neverBetter: false,
    lower: first === 0 ? sorted[0].rel : cross(first - 1, first),
    lowerOpen: first === 0,
    upper:
      last === sorted.length - 1
        ? sorted[sorted.length - 1].rel
        : cross(last + 1, last),
    upperOpen: last === sorted.length - 1,
    bestRel: best.rel,
    bestRms: best.rms,
  };
}

/** Break-even of one cell for one measure, from the fixed-error `nominal` runs. */
export function cellBreakEven(
  cell: FrameCell,
  measure: "handLength" | "palmWidth",
): BreakEven {
  const flat = cell.current.fallback[measure].rms;
  const points = cell.priors
    .filter((p) => p.mode === "nominal" && p.kind === "fixed")
    .map((p) => ({ rel: p.rel, rms: p.result.fallback[measure].rms }));
  return breakEven(points, flat);
}

// ── Sigma and bias ───────────────────────────────────────────────────────

export interface SigmaInput {
  readonly label: string;
  /** Mean error (handLength, palmWidth), mm, pooled over the tilt caps: the bias vector. Correct an input by subtracting it. */
  readonly bias: [number, number];
  /** SD across the tilt caps of each cap's mean error: how unsure the bias vector is because the tilt distribution is unknown. */
  readonly biasBetweenCapSd: [number, number];
  /** Pooled scan covariance (includes the between-cap spread), mm². */
  readonly covScan: [[number, number], [number, number]];
  /** Variance, per axis, of an unknown systematic landmark displacement uniform in ±half (half² / 3), mm². */
  readonly systematicVar: number;
  /** covScan + diag(systematicVar). The default candidate for the input covariance. */
  readonly cov: [[number, number], [number, number]];
  /** cov + diag(Rogers SD²): if the target is a reference definition rather than the landmark distance. */
  readonly covWithDefinition: [[number, number], [number, number]];
}

function addDiag(
  m: [[number, number], [number, number]],
  a: number,
  b: number,
): [[number, number], [number, number]] {
  return [
    [m[0][0] + a, m[0][1]],
    [m[1][0], m[1][1] + b],
  ];
}

/** Pool equal-weight cap results into the bias vector and the Sigma candidates. */
export function buildSigmaInput(
  label: string,
  results: readonly ConditionResult[],
  landmarkBiasHalfMm: number,
): SigmaInput {
  const pooled = poolConditions(results);
  const systematicVar = landmarkBiasHalfMm ** 2 / 3;
  const cov = addDiag(pooled.covariance, systematicVar, systematicVar);
  return {
    label,
    bias: pooled.mean,
    biasBetweenCapSd: pooled.betweenSd,
    covScan: pooled.covariance,
    systematicVar,
    cov,
    covWithDefinition: addDiag(
      cov,
      ROGERS_DEFINITION_SD_MM.length ** 2,
      ROGERS_DEFINITION_SD_MM.width ** 2,
    ),
  };
}

export interface SigmaSet {
  readonly profile: JointProfile;
  readonly current: SigmaInput;
  /** Candidate: the prior replaces an unreliable estimate (prior uniform ±REPRESENTATIVE_PRIOR_HALF). */
  readonly nominal: SigmaInput;
  /** Candidate: the prior is always used (same spread). */
  readonly nominalOnly: SigmaInput;
}

function pickPrior(
  cell: FrameCell,
  mode: PriorRun["mode"],
  half: number,
): ConditionResult {
  const hit = cell.priors.find(
    (p) => p.mode === mode && p.kind === "uniform" && p.rel === half,
  );
  if (!hit) throw new Error(`No ${mode} uniform ±${half} run in the cell.`);
  return hit.result;
}

export function buildSigmaSet(result: FrameProfileResult): SigmaSet {
  const half = result.profile.landmarkBiasHalfMm;
  const caps = result.cells;
  return {
    profile: result.profile,
    current: buildSigmaInput(
      "現況（無 EXIF，不可靠時不修正）",
      caps.map((c) => c.current),
      half,
    ),
    nominal: buildSigmaInput(
      `候選：先驗補位（±${REPRESENTATIVE_PRIOR_HALF * 100}%）`,
      caps.map((c) => pickPrior(c, "nominal", REPRESENTATIVE_PRIOR_HALF)),
      half,
    ),
    nominalOnly: buildSigmaInput(
      `候選：只用先驗（±${REPRESENTATIVE_PRIOR_HALF * 100}%）`,
      caps.map((c) => pickPrior(c, "nominalOnly", REPRESENTATIVE_PRIOR_HALF)),
      half,
    ),
  };
}

// ── The whole report ─────────────────────────────────────────────────────

export interface ProfileResult {
  readonly profile: JointProfile;
  /** EXIF comparison: every scan-noise source on at once, the true-focal EXIF given. */
  readonly joint: ConditionResult;
  readonly singles: ReadonlyArray<{
    readonly source: SourceKey;
    readonly result: ConditionResult;
  }>;
  readonly handLengthDecomposition: Decomposition;
  readonly palmWidthDecomposition: Decomposition;
}

export interface ErrorBudgetReport {
  readonly label: "模擬，非實測";
  readonly seed: number;
  readonly n: number;
  readonly assumptions: {
    readonly imagePx: [number, number];
    readonly focalPx: number;
    readonly paper: string;
    readonly handSizesMm: readonly number[];
    readonly distanceMm: [number, number];
    readonly tiltCapsDeg: readonly number[];
  };
  /** Primary scenario: frame, no EXIF. One entry per joint profile. */
  readonly frame: FrameProfileResult[];
  readonly sigma: SigmaSet[];
  /** EXIF comparison at tilt ≤ 10°. */
  readonly profiles: ProfileResult[];
  /** One source at a time, EXIF with the true focal, tilt ≤ 10°. */
  readonly conditions: ReadonlyArray<{
    readonly group: string;
    readonly result: ConditionResult;
  }>;
  readonly sigmaMeasV1: {
    readonly handLength: number;
    readonly palmWidth: number;
  };
}

const SOURCES: readonly SourceKey[] = [
  "corner",
  "landmark",
  "focal",
  "heightScale",
  "heightJitter",
  "distortion",
];

export interface BuildOptions {
  /** Tilt caps to sweep. Default TILT_CAPS_DEG. */
  readonly tiltCaps?: readonly number[];
  /** Prior options for every profile. Default: the full grid. */
  readonly frameOptions?: FrameOptions;
}

/** Run every condition. `n` scans each, all on the same `n` scenes per tilt cap. */
export function buildErrorBudget(
  seed: number,
  n: number,
  sigmaMeasV1: { handLength: number; palmWidth: number },
  options: BuildOptions = {},
): ErrorBudgetReport {
  const caps = options.tiltCaps ?? TILT_CAPS_DEG;
  const scenes10 = drawScenes(seed, n, { tiltMaxDeg: 10 });

  const frame = JOINT_PROFILES.map((profile): FrameProfileResult => ({
    profile,
    cells: caps.map((tiltMaxDeg) =>
      buildFrameCell(seed, n, profile, tiltMaxDeg, {
        // The lens runs are one profile's (B) job: the others only need the grid.
        lenses: profile.name.startsWith("B"),
        ...options.frameOptions,
      }),
    ),
  }));
  const sigma = frame.map(buildSigmaSet);

  const conditions = singleSourceConditions().map((c) => ({
    group: c.group,
    result: runCondition(seed, n, c.name, c.perturbation, scenes10),
  }));
  const profiles = JOINT_PROFILES.map((profile): ProfileResult => {
    const singles = SOURCES.map((source) => ({
      source,
      result: runCondition(
        seed,
        n,
        `${profile.name}：只有 ${SOURCE_LABELS[source]}`,
        singleSourcePerturbation(profile, source),
        scenes10,
      ),
    }));
    const joint = runCondition(
      seed,
      n,
      `${profile.name}：全部同時（EXIF）`,
      jointPerturbation(profile),
      scenes10,
    );
    return {
      profile,
      joint,
      singles,
      handLengthDecomposition: decompose(
        singles.map((s) => ({ source: s.source, stats: s.result.handLength })),
        joint.handLength,
      ),
      palmWidthDecomposition: decompose(
        singles.map((s) => ({ source: s.source, stats: s.result.palmWidth })),
        joint.palmWidth,
      ),
    };
  });
  return {
    label: "模擬，非實測",
    seed,
    n,
    assumptions: {
      imagePx: [IMAGE_WIDTH_PX, IMAGE_HEIGHT_PX],
      focalPx: FOCAL_PX,
      paper: PAPER,
      handSizesMm: HAND_SIZES_MM,
      distanceMm: [350, 500],
      tiltCapsDeg: caps,
    },
    frame,
    sigma,
    profiles,
    conditions,
    sigmaMeasV1,
  };
}

// ── Markdown ─────────────────────────────────────────────────────────────

const f2 = (x: number): string =>
  Number.isFinite(x) ? (Math.abs(x) < 0.005 ? "0.00" : x.toFixed(2)) : "n/a";
const signed = (x: number): string =>
  Number.isFinite(x) ? (x > 0.004 ? `+${x.toFixed(2)}` : f2(x)) : "n/a";
const pct = (x: number): string =>
  Number.isFinite(x) ? `${(100 * x).toFixed(0)}%` : "n/a";
const relPct = (x: number): string =>
  `${x > 0 ? "+" : ""}${Math.round(x * 100)}%`;

function statCells(s: ErrorStats): string {
  return `${signed(s.bias)} | ${f2(s.sd)} | ${f2(s.p95Abs)}`;
}

function conditionRow(c: ConditionResult): string {
  return `| ${c.name} | ${c.rejected} | ${statCells(c.handLength)} | ${statCells(c.palmWidth)} |`;
}

const CONDITION_HEADER = [
  "| 條件 | 被拒 | 手長 bias | 手長 SD | 手長 P95\\|e\\| | 掌寬 bias | 掌寬 SD | 掌寬 P95\\|e\\| |",
  "|---|---:|---:|---:|---:|---:|---:|---:|",
];

type Measure = "handLength" | "palmWidth";
const MEASURE_LABEL: Record<Measure, string> = {
  handLength: "手長",
  palmWidth: "掌寬",
};

function matrixCells(m: [[number, number], [number, number]]): string {
  const corr = m[0][1] / Math.sqrt(m[0][0] * m[1][1]);
  return `[[${f2(m[0][0])}, ${f2(m[0][1])}], [${f2(m[1][0])}, ${f2(m[1][1])}]]（手長 SD ${f2(Math.sqrt(m[0][0]))}、掌寬 SD ${f2(Math.sqrt(m[1][1]))}、相關 ${Number.isFinite(corr) ? corr.toFixed(2) : "n/a"}）`;
}

/** The main table of one profile and one measure: activation rate, the two paths, overall. */
function frameTable(r: FrameProfileResult, measure: Measure): string[] {
  const out = [
    `| 傾斜上限 | reliable（視差修正啟動率） | 啟動路徑 n | 啟動 bias | 啟動 SD | 未啟動 n | 未啟動 bias | 未啟動 SD | 整體 bias | 整體 SD | 整體 RMS |`,
    "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const cell of r.cells) {
    const c = cell.current;
    const est = c.byPath.estimate;
    const flat = c.byPath.flat;
    out.push(
      `| ${cell.tiltMaxDeg}° | ${pct(c.estimateFraction)} | ${est.n} | ${signed(est[measure].bias)} | ${f2(est[measure].sd)} | ${flat.n} | ${signed(flat[measure].bias)} | ${f2(flat[measure].sd)} | ${signed(c[measure].bias)} | ${f2(c[measure].sd)} | ${f2(c[measure].rms)} |`,
    );
  }
  return out;
}

function priorRowsFor(
  cell: FrameCell,
  filter: (p: PriorRun) => boolean,
): string[] {
  const cur = cell.current;
  const row = (label: string, c: ConditionResult): string => {
    const dLen = 1 - c.handLength.rms / cur.handLength.rms;
    const dWid = 1 - c.palmWidth.rms / cur.palmWidth.rms;
    return `| ${label} | ${signed(c.handLength.bias)} | ${f2(c.handLength.sd)} | ${f2(c.handLength.rms)} | ${pct(dLen)} | ${signed(c.palmWidth.bias)} | ${f2(c.palmWidth.sd)} | ${f2(c.palmWidth.rms)} | ${pct(dWid)} |`;
  };
  return [
    row("現況（不可靠時不修正）", cur),
    ...cell.priors.filter(filter).map((p) => row(p.label, p.result)),
  ];
}

const PRIOR_HEADER = [
  "| 政策 | 手長 bias | 手長 SD | 手長 RMS | RMS 改善 | 掌寬 bias | 掌寬 SD | 掌寬 RMS | RMS 改善 |",
  "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
];

/** The prior runs shown in the per-cap tables (the full grid is in the fallback and break-even tables). */
const SHOWN_FIXED = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3];
function isShown(p: PriorRun): boolean {
  if (p.kind === "uniform" || p.mode === "nominalOnly") return true;
  return SHOWN_FIXED.includes(p.rel);
}

function fallbackGrid(r: FrameProfileResult, measure: Measure): string[] {
  const out = [
    `| 先驗誤差（相對真實 f） | ${r.cells.map((c) => `≤${c.tiltMaxDeg}°`).join(" | ")} |`,
    `|---|${r.cells.map(() => "---:").join("|")}|`,
    `| **現況：不修正** | ${r.cells.map((c) => `**${f2(c.current.fallback[measure].rms)}**`).join(" | ")} |`,
  ];
  for (const rel of PRIOR_GRID) {
    const cells = r.cells.map((cell) => {
      const run = cell.priors.find(
        (p) => p.mode === "nominal" && p.kind === "fixed" && p.rel === rel,
      );
      if (!run) return "n/a";
      const rms = run.result.fallback[measure].rms;
      return rms > cell.current.fallback[measure].rms
        ? `${f2(rms)} ✗`
        : f2(rms);
    });
    out.push(`| ${relPct(rel)} | ${cells.join(" | ")} |`);
  }
  return out;
}

function breakEvenText(b: BreakEven): string {
  if (b.neverBetter) return "網格內從不優於不修正";
  const lo = b.lowerOpen
    ? `< ${relPct(b.lower)}（網格下緣已優於）`
    : relPct(b.lower);
  const hi = b.upperOpen
    ? `> ${relPct(b.upper)}（網格上緣仍優於）`
    : relPct(b.upper);
  return `${lo} 至 ${hi}`;
}

/** Render the report as Markdown. Every number is under simulated assumptions. */
export function renderMarkdown(report: ErrorBudgetReport): string {
  const out: string[] = [];
  const a = report.assumptions;
  const profileB =
    report.frame.find((r) => r.profile.name.startsWith("B")) ?? report.frame[0];

  out.push("# 掃描誤差預算（模擬，非實測）");
  out.push("");
  out.push(
    `種子 ${report.seed}，每個條件 N = ${report.n}。以下全部是**模擬假設下**的數字，不是實測，也不是任何真實手機、手或偵測器的特性。全部設定為「未拍板（candidate）」。`,
  );
  out.push("");
  out.push("假設（皆為本腳本的設定，非事實）：");
  out.push(
    `- 主要情境：影片影格（\`capture.source = "frame"\`），**沒有 EXIF**；focal 只能由紙張 homography 估計，近正拍時常被判不可靠，管線就退回「不做視差修正」。EXIF 情境只作對照（第 4 節）。`,
  );
  out.push(
    `- 影像 ${a.imagePx[0]}×${a.imagePx[1]} px（直式），真實 focal ${a.focalPx.toFixed(0)} px（等效 26 mm 主鏡頭，亦是「標稱先驗」的基準），主點在影像中心，針孔模型。影格實際的有效視角是否等於 26 mm 等效**未知**（合併報告 §9 第 9 項）。`,
  );
  out.push(
    `- 紙 ${a.paper.toUpperCase()}（210×297 mm）平放，4 角世界座標已知；拍攝高度 ${a.distanceMm[0]}–${a.distanceMm[1]} mm，光軸對準紙中心 ±20 mm。**傾斜（光軸與紙面法線的夾角）在 [0, 上限] 內均勻抽取，方向隨機；真實的傾斜分布未知，所以上限掃描 ${a.tiltCapsDeg.join(" / ")}°。**偏離畫面的抽樣會被重抽，大傾斜時略微稀釋最陡、最近的樣本。`,
  );
  out.push(
    `- 手：風格化平放手模板（21 個 MediaPipe landmark），手長（landmark 0→12 的關節中心距離）${a.handSizesMm.join(" / ")} mm 輪流；真實關節高度＝管線自己的 \`landmarkHeightsMm\`（Garrett 比例）× 縮放 × 逐關節抖動，再扣 MCP 2／5 的固定偏低量。`,
  );
  out.push(
    "- 噪音皆為各點各軸獨立高斯；真實的紙角誤差（沿邊相關）與 MediaPipe 誤差（沿手指相關）不是這樣。",
  );
  out.push(
    "- 誤差＝管線輸出 − 模擬真值（關節中心的平面距離；「定義偏移」列另加參考定義的差）。P95\\|e\\| 是 |誤差| 的第 95 百分位。單位 mm。「被拒」是管線丟例外（契約範圍檢查）的次數，統計只含被接受的掃描。",
  );
  out.push(
    "- 畸變：正規化相機座標下 (x, y) → (x, y)(1 + k1·r²)，r² = x² + y²（影像角落 r² 約 0.69），紙角與 landmark 都被扭曲，管線不做校正。k1 範圍無來源，自設。",
  );
  out.push(
    "- 各擾動的來源標示見 `JointProfile` 的註解：有來源的（高度縮放 0.8–1.2、MCP 2／5 固定偏低 1.4–3.0 mm、定義偏移的雙向 ±6–8 mm 與 Rogers SD）與「無來源，自設」的（高度縮放 0.6／1.4、逐關節 ±30%、k1、landmark 系統性偏差、先驗誤差範圍）分開標。",
  );
  out.push("");

  // ── 1. Frame, no EXIF
  out.push("## 1. 主要情境：影格、無 EXIF（現況管線）");
  out.push("");
  out.push(
    "現況政策：EXIF 沒有 → 用紙角 homography 估 focal；估計被判不可靠 → **不做視差修正**（手長、掌寬都偏長）。「啟動」＝該掃描的 focal 估計被判 reliable，管線有做視差修正；「未啟動」＝退回平面投影。全部誤差源同時（見下表檔位），不含 landmark 系統性偏差與定義偏移（它們是未知符號的固定偏差，見第 3 節與第 5 節）。",
  );
  out.push("");
  for (const r of report.frame) {
    const p = r.profile;
    out.push(`### 1.${report.frame.indexOf(r) + 1} 檔位 ${p.name}`);
    out.push("");
    out.push(
      `σ_c ${p.cornerSigmaPx} px、σ_l ${p.landmarkSigmaPx} px、高度縮放 ${p.heightScale.lo}–${p.heightScale.hi}、逐關節 ${p.heightJitterHalf ? `±${p.heightJitterHalf * 100}%` : "無"}、k1 ±${p.k1Half}、MCP 2／5 固定偏低 ${p.mcpHeightOffsetMm.index}／${p.mcpHeightOffsetMm.little} mm。`,
    );
    out.push("");
    for (const measure of ["handLength", "palmWidth"] as const) {
      out.push(`**${MEASURE_LABEL[measure]}**（mm）`);
      out.push("");
      out.push(...frameTable(r, measure));
      out.push("");
    }
  }
  out.push(
    "bias 為正 ＝ 管線讀得比真值長。未啟動路徑的 bias 正好是「沒有視差修正」的量（約 +6 mm 手長），啟動路徑近乎無偏但 SD 較大（focal 估計本身有雜訊）。整體 bias 是兩條路徑依啟動率的混合。",
  );
  out.push("");

  // ── 2. Nominal prior
  out.push(
    "## 2. 候選修法：不可靠時改用標稱 focal 先驗（取代「不做視差修正」）",
  );
  out.push("");
  out.push(
    "先驗 = 26 mm 等效主鏡頭的 focal（模擬中等於真實 focal，所以「先驗誤差 0」是精確先驗）。「先驗補位」：估計 reliable 時照用估計，不可靠時用先驗；「只用先驗」：完全不看紙角估計。先驗誤差是相對真實 focal 的比例；「±x%（逐掃描均勻）」模擬不同機型的主鏡頭 focal 差異（範圍自設，無資料）。「RMS 改善」＝ 1 − 候選 RMS ÷ 現況 RMS（正值＝候選較好）。",
  );
  out.push("");
  out.push("### 2.1 整體（全部掃描）——檔位 B 中");
  out.push("");
  for (const cell of profileB.cells) {
    out.push(`**傾斜上限 ${cell.tiltMaxDeg}°**`);
    out.push("");
    out.push(...PRIOR_HEADER);
    out.push(...priorRowsFor(cell, isShown));
    out.push("");
  }

  out.push("### 2.2 只看「估計不可靠」的那些掃描：先驗的損益平衡");
  out.push("");
  out.push(
    "這些掃描在現況下被退回平面投影。下表是這個子集上的 RMS（mm，先驗固定偏 x%；✗ ＝ 比不修正還差）。「估計不可靠」的子集不受先驗政策影響，所以兩種政策在同一批掃描上比。",
  );
  out.push("");
  for (const r of report.frame) {
    for (const measure of ["handLength", "palmWidth"] as const) {
      out.push(`**${r.profile.name}，${MEASURE_LABEL[measure]}**`);
      out.push("");
      out.push(...fallbackGrid(r, measure));
      out.push("");
    }
  }

  out.push("### 2.3 損益平衡點（先驗誤差落在哪個範圍內，先驗補位優於不修正）");
  out.push("");
  out.push(
    "以固定先驗誤差網格（−60% 到 +200%）在「不可靠」子集上的 RMS 線性內插（網格點之間以直線連接，所以交點只是估計）。標「網格下緣／上緣已優於」者表示真正交點在網格之外。先驗太短（f 低估）比太長（f 高估）傷害大：f 太小等於把相機估得太近，視差修正過頭。",
  );
  out.push("");
  out.push(
    "| 檔位 | 傾斜上限 | 手長：先驗誤差範圍 | 手長：最佳點 | 掌寬：先驗誤差範圍 | 掌寬：最佳點 |",
  );
  out.push("|---|---:|---|---|---|---|");
  for (const r of report.frame) {
    for (const cell of r.cells) {
      const len = cellBreakEven(cell, "handLength");
      const wid = cellBreakEven(cell, "palmWidth");
      out.push(
        `| ${r.profile.name} | ${cell.tiltMaxDeg}° | ${breakEvenText(len)} | ${relPct(len.bestRel)}（RMS ${f2(len.bestRms)}） | ${breakEvenText(wid)} | ${relPct(wid.bestRel)}（RMS ${f2(wid.bestRms)}） |`,
      );
    }
  }
  out.push("");

  out.push("### 2.4 鏡頭被認錯：ultra-wide 或 tele 被當成主鏡頭（檔位 B 中）");
  out.push("");
  out.push(
    "場景以真實 focal 重抽（拍攝距離隨 focal 縮放，紙在畫面中的占比不變），先驗仍是 26 mm 等效。ultra-wide（0.5×）時先驗比真實大 100%、拍攝距離只有一半，視差更大；2× tele 時先驗比真實小 50%。",
  );
  out.push("");
  out.push(
    "| 傾斜上限 | 情境 | 手長 現況 bias／SD／RMS | 手長 先驗補位 bias／SD／RMS | 掌寬 現況 bias／SD／RMS | 掌寬 先驗補位 bias／SD／RMS |",
  );
  out.push("|---:|---|---|---|---|---|");
  for (const cell of profileB.cells) {
    for (const lens of cell.lenses) {
      const tri = (s: ErrorStats) =>
        `${signed(s.bias)}／${f2(s.sd)}／${f2(s.rms)}`;
      out.push(
        `| ${cell.tiltMaxDeg}° | ${lens.label} | ${tri(lens.current.handLength)} | ${tri(lens.nominal.handLength)} | ${tri(lens.current.palmWidth)} | ${tri(lens.nominal.palmWidth)} |`,
      );
    }
  }
  out.push("");

  // ── 3. Σ and bias
  out.push("## 3. Σ_input 與偏差向量（frame 情境，模擬假設下，非實測）");
  out.push("");
  out.push(
    `(手長誤差, 掌寬誤差) 的 2×2 共變異（mm²）與偏差向量（mm）。四個傾斜上限（${a.tiltCapsDeg.join(" / ")}°）等權混合，所以傾斜分布未知所造成的差異已在共變異裡（全變異數定律）；「跨傾斜上限的 bias SD」是偏差向量本身有多不確定。**Σ 無法表達系統性偏差**，所以另外輸出偏差向量：輸入先減去 bias 再進模型。`,
  );
  out.push("");
  out.push(
    "加上兩個未知符號的固定偏差當作額外不確定度（無法修正，只能放進 Σ）：landmark 系統性偏差（無來源，自設：每軸均勻 ±檔位的值，方差 = 半寬² ÷ 3）；若目標是某個參考定義而非 landmark 距離，再加 Rogers 量級的個人差（手長 5.6、掌寬 3.4 mm，SD）。",
  );
  out.push("");
  out.push(
    "| 檔位 | 政策 | 偏差向量（手長, 掌寬） | 跨傾斜上限的 bias SD | Σ_scan | Σ_input = Σ_scan + 系統性 | Σ_input + 定義差 |",
  );
  out.push("|---|---|---|---|---|---|---|");
  for (const s of report.sigma) {
    for (const x of [s.current, s.nominal, s.nominalOnly]) {
      out.push(
        `| ${s.profile.name}（系統性 ±${s.profile.landmarkBiasHalfMm} mm） | ${x.label} | (${signed(x.bias[0])}, ${signed(x.bias[1])}) | (${f2(x.biasBetweenCapSd[0])}, ${f2(x.biasBetweenCapSd[1])}) | ${matrixCells(x.covScan)} | ${matrixCells(x.cov)} | ${matrixCells(x.covWithDefinition)} |`,
      );
    }
  }
  out.push("");
  const sb = report.sigma.find((s) => s.profile.name.startsWith("B"));
  if (sb) {
    out.push("### 建議值（檔位 B 中，供 v2 使用；未拍板）");
    out.push("");
    out.push(
      `- 現況管線：偏差向量 (${signed(sb.current.bias[0])}, ${signed(sb.current.bias[1])}) mm，Σ_input = ${matrixCells(sb.current.cov)}。`,
    );
    out.push(
      `- 若採「先驗補位」（先驗 ±${REPRESENTATIVE_PRIOR_HALF * 100}%）：偏差向量 (${signed(sb.nominal.bias[0])}, ${signed(sb.nominal.bias[1])}) mm，Σ_input = ${matrixCells(sb.nominal.cov)}。`,
    );
    out.push(
      "- 偏差向量只在「管線與這些假設一致」時才該被減掉；它由未啟動路徑的視差缺口主導，會隨傾斜分布與管線改版而變。實測前，v2 預設值應視為「候選」，並保留把偏差設為 0 的選項。",
    );
    out.push("");
  }

  // ── 4. EXIF comparison
  out.push("## 4. 對照：有 EXIF（focal 已知）時，全部同時（傾斜 ≤ 10°）");
  out.push("");
  out.push(
    "各檔的分布皆為假設：corner / landmark 是高斯 σ；focal 為 ±x% 均勻；高度縮放為均勻區間；逐關節抖動為 ±x% 均勻；k1 為 ±x 均勻；MCP 2／5 為固定偏低。",
  );
  out.push("");
  out.push(...CONDITION_HEADER);
  for (const r of report.profiles) out.push(conditionRow(r.joint));
  out.push("");
  for (const r of report.profiles) {
    out.push(`### ${r.profile.name}：方差占比（一次一項的 SD²，EXIF）`);
    out.push("");
    out.push(
      "| 誤差源 | 手長 SD | 手長 SD² | 手長占比 | 掌寬 SD | 掌寬 SD² | 掌寬占比 |",
    );
    out.push("|---|---:|---:|---:|---:|---:|---:|");
    r.handLengthDecomposition.shares.forEach((h, i) => {
      const w = r.palmWidthDecomposition.shares[i];
      out.push(
        `| ${SOURCE_LABELS[h.source]} | ${f2(h.sd)} | ${f2(h.variance)} | ${pct(h.share)} | ${f2(w.sd)} | ${f2(w.variance)} | ${pct(w.share)} |`,
      );
    });
    const hd = r.handLengthDecomposition;
    const wd = r.palmWidthDecomposition;
    out.push(
      `| **一次一項 SD² 之和** | | ${f2(hd.sumOfVariances)} | | | ${f2(wd.sumOfVariances)} | |`,
    );
    out.push(
      `| **全部同時 SD²** | ${f2(r.joint.handLength.sd)} | ${f2(hd.jointVariance)} | | ${f2(r.joint.palmWidth.sd)} | ${f2(wd.jointVariance)} | |`,
    );
    out.push(
      `| **之和 ÷ 聯合** | | ${f2(hd.additivityRatio)} | | | ${f2(wd.additivityRatio)} | |`,
    );
    out.push("");
  }
  out.push(
    "之和 ÷ 聯合 = 1 表示各源方差可相加；小於 1 表示聯合比各自之和更大（交互作用放大）；大於 1 表示部分互相抵消。偏差（bias）不在 SD² 裡。",
  );
  out.push("");
  out.push("EXIF 情境的 Σ_input（含 EXIF，傾斜 ≤ 10°，對照用）：");
  out.push("");
  out.push("| 檔 | Σ_input |");
  out.push("|---|---|");
  for (const r of report.profiles) {
    out.push(`| ${r.profile.name} | ${matrixCells(r.joint.covariance)} |`);
  }
  out.push("");

  // ── 5. One at a time
  out.push("## 5. 一次只動一項（EXIF、focal 為真值，傾斜 ≤ 10°）");
  out.push("");
  out.push(...CONDITION_HEADER);
  for (const { result } of report.conditions) out.push(conditionRow(result));
  out.push("");
  out.push(
    "定義偏移列：誤差 = 輸出 − (真值 + 偏移)，所以固定偏移的 bias 是 −偏移；N(0, σ²) 列的 SD 就是 σ，bias 約 0。掌寬的偏移範圍（10–20 mm）是低信心（Jee PIP 寬度一半的代理與一則無來源的合約註解），目標若改用 landmark 距離則為 0。landmark 系統性偏差與 MCP 固定偏低的符號在此看得出方向：手長軸 + 讀長、MCP 偏低 → 假設的高度過高 → 讀長。",
  );
  out.push("");
  out.push("### 貢獻排序（一次一項，掃描範圍內最大的 RMS）");
  out.push("");
  out.push("| 排名 | 誤差源 | 掃描中最糟的條件 | 手長 RMS | 掌寬 RMS |");
  out.push("|---:|---|---|---:|---:|");
  const groups = new Map<string, ConditionResult[]>();
  for (const { group, result } of report.conditions) {
    if (group === "對照") continue;
    groups.set(group, [...(groups.get(group) ?? []), result]);
  }
  const ranked = [...groups.entries()]
    .map(([group, results]) => {
      const worst = results.reduce((best, r) =>
        r.handLength.rms > best.handLength.rms ? r : best,
      );
      return { group, worst };
    })
    .sort((x, y) => y.worst.handLength.rms - x.worst.handLength.rms);
  ranked.forEach(({ group, worst }, i) => {
    out.push(
      `| ${i + 1} | ${group} | ${worst.name} | ${f2(worst.handLength.rms)} | ${f2(worst.palmWidth.rms)} |`,
    );
  });
  out.push("");
  out.push(
    "RMS = √(bias² + SD²)。排名依手長 RMS；各源的「掃描範圍」多半是我設的，不同源的最糟條件不代表同樣可能發生，這張表只說明量級。",
  );
  out.push("");

  // ── 6. v1 sigma
  out.push("## 6. 對照 v1 現用 σ_meas");
  out.push("");
  out.push(
    `v1 候選值（\`src/server/fit/coefficients.ts\`，未拍板）：手長 ${report.sigmaMeasV1.handLength} mm、掌寬 ${report.sigmaMeasV1.palmWidth} mm。`,
  );
  out.push("");
  out.push(
    "| 檔 | 政策 | 手長 SD（√Σ） | 掌寬 SD（√Σ） | 手長 |bias| | 掌寬 |bias| |",
  );
  out.push("|---|---|---:|---:|---:|---:|");
  for (const s of report.sigma) {
    for (const x of [s.current, s.nominal]) {
      out.push(
        `| ${s.profile.name} | ${x.label} | ${f2(Math.sqrt(x.cov[0][0]))} | ${f2(Math.sqrt(x.cov[1][1]))} | ${f2(Math.abs(x.bias[0]))} | ${f2(Math.abs(x.bias[1]))} |`,
      );
    }
  }
  out.push("");
  out.push(
    "這些都是模擬假設下的值；v1 的 6 / 4 mm 也是候選值，兩者的比較只顯示量級，不證明哪一個對。",
  );
  out.push("");
  return out.join("\n");
}
