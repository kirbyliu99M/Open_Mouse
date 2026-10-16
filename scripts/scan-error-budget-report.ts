/**
 * Scan error budget (SIMULATION, not measurement): the condition list, the
 * orchestration and the Markdown rendering on top of scan-error-budget-core.ts.
 * Pure: no files, no clock, no console. `scripts/scan-error-budget.ts` is the
 * command-line wrapper.
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
  runCondition,
  singleSourcePerturbation,
  type ConditionResult,
  type Decomposition,
  type ErrorStats,
  type JointProfile,
  type Perturbation,
  type SourceKey,
} from "./scan-error-budget-core";

/** One-at-a-time conditions, in the order the report lists them. `group` says which source a row belongs to. */
export interface NamedCondition {
  readonly group: string;
  readonly name: string;
  readonly perturbation: Perturbation;
}

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
  for (const rel of [-0.1, -0.03, 0.03, 0.1]) {
    rows.push({
      group: "focal 誤差",
      name: `EXIF focal ${rel > 0 ? "+" : ""}${Math.round(rel * 100)}%`,
      perturbation: { ...NO_PERTURBATION, focalRel: fixed(rel) },
    });
  }
  for (const scale of [0.6, 0.8, 1.2, 1.4]) {
    rows.push({
      group: "關節高度",
      name: `全部關節高度 ×${scale}`,
      perturbation: { ...NO_PERTURBATION, heightScale: fixed(scale) },
    });
  }
  rows.push({
    group: "關節高度",
    name: "逐關節隨機 ±30%",
    perturbation: { ...NO_PERTURBATION, heightJitterHalf: 0.3 },
  });
  for (const mm of [2, 4, 6]) {
    rows.push({
      group: "定義偏移",
      name: `定義偏移 ${mm} mm（文獻值較長）`,
      perturbation: { ...NO_PERTURBATION, definitionOffsetMm: mm },
    });
  }
  for (const k1 of [-0.05, -0.02, 0.02, 0.05]) {
    rows.push({
      group: "徑向畸變",
      name: `k1 = ${k1 > 0 ? "+" : ""}${k1}`,
      perturbation: { ...NO_PERTURBATION, k1: fixed(k1) },
    });
  }
  return rows;
}

export interface ProfileResult {
  readonly profile: JointProfile;
  readonly joint: ConditionResult;
  /** The same profile with no EXIF: the focal is estimated from the corners. */
  readonly jointNoExif: ConditionResult;
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
    readonly tiltDeg: [number, number];
  };
  readonly conditions: ReadonlyArray<{
    readonly group: string;
    readonly result: ConditionResult;
  }>;
  readonly homographyFocal: ConditionResult[];
  readonly profiles: ProfileResult[];
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

/** Run every condition. `n` scans each, all on the same `n` scenes. */
export function buildErrorBudget(
  seed: number,
  n: number,
  sigmaMeasV1: { handLength: number; palmWidth: number },
): ErrorBudgetReport {
  const scenes = drawScenes(seed, n);
  const conditions = singleSourceConditions().map((c) => ({
    group: c.group,
    result: runCondition(seed, n, c.name, c.perturbation, scenes),
  }));
  const homographyFocal = [0, 0.5, 1, 2].map((sigma) =>
    runCondition(
      seed,
      n,
      `無 EXIF（focal 由 homography 估計），紙角 σ_c = ${sigma} px`,
      { ...NO_PERTURBATION, focalMode: "homography", cornerSigmaPx: sigma },
      scenes,
    ),
  );
  const profiles = JOINT_PROFILES.map((profile): ProfileResult => {
    const singles = SOURCES.map((source) => ({
      source,
      result: runCondition(
        seed,
        n,
        `${profile.name}：只有 ${SOURCE_LABELS[source]}`,
        singleSourcePerturbation(profile, source),
        scenes,
      ),
    }));
    const joint = runCondition(
      seed,
      n,
      `${profile.name}：全部同時`,
      jointPerturbation(profile),
      scenes,
    );
    const jointNoExif = runCondition(
      seed,
      n,
      `${profile.name}：全部同時，無 EXIF`,
      jointPerturbation(profile, "homography"),
      scenes,
    );
    return {
      profile,
      joint,
      jointNoExif,
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
      tiltDeg: [0, 10],
    },
    conditions,
    homographyFocal,
    profiles,
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

function matrixCells(m: [[number, number], [number, number]]): string {
  const corr = m[0][1] / Math.sqrt(m[0][0] * m[1][1]);
  return `[[${f2(m[0][0])}, ${f2(m[0][1])}], [${f2(m[1][0])}, ${f2(m[1][1])}]]（手長 SD ${f2(Math.sqrt(m[0][0]))}、掌寬 SD ${f2(Math.sqrt(m[1][1]))}、相關 ${Number.isFinite(corr) ? corr.toFixed(2) : "n/a"}）`;
}

/** Render the report as Markdown. Every number is under simulated assumptions. */
export function renderMarkdown(report: ErrorBudgetReport): string {
  const out: string[] = [];
  const a = report.assumptions;
  out.push("# 掃描誤差預算（模擬，非實測）");
  out.push("");
  out.push(
    `種子 ${report.seed}，每個條件 N = ${report.n}。以下全部是**模擬假設下**的數字，不是實測，也不是任何真實手機、手或偵測器的特性。`,
  );
  out.push("");
  out.push("假設（皆為本腳本的設定，非事實）：");
  out.push(
    `- 影像 ${a.imagePx[0]}×${a.imagePx[1]} px（直式），focal ${a.focalPx.toFixed(0)} px（等效 26 mm 主鏡頭），主點在影像中心，針孔模型。`,
  );
  out.push(
    `- 紙 ${a.paper.toUpperCase()}（210×297 mm）平放，4 角世界座標已知；拍攝高度 ${a.distanceMm[0]}–${a.distanceMm[1]} mm，傾斜 ${a.tiltDeg[0]}–${a.tiltDeg[1]}°（方向隨機），光軸對準紙中心 ±20 mm。`,
  );
  out.push(
    `- 手：風格化平放手模板（21 個 MediaPipe landmark），手長（landmark 0→12 的關節中心距離）${a.handSizesMm.join(" / ")} mm 輪流；真實關節高度＝管線自己的 \`landmarkHeightsMm\`（Garrett 比例）× 縮放 × 逐關節抖動。`,
  );
  out.push(
    "- 噪音皆為各點各軸獨立高斯；真實的紙角誤差（沿邊相關）與 MediaPipe 誤差（沿手指相關）不是這樣。",
  );
  out.push(
    "- 誤差＝管線輸出 − 模擬真值（關節中心的平面距離；「定義偏移」列另加文獻定義的差）。P95\\|e\\| 是 |誤差| 的第 95 百分位。單位 mm。「被拒」是管線丟例外（契約範圍檢查）的次數，統計只含被接受的掃描。",
  );
  out.push(
    "- 畸變：正規化相機座標下 (x, y) → (x, y)(1 + k1·r²)，r² = x² + y²（影像角落 r² 約 0.69），紙角與 landmark 都被扭曲，管線不做校正。",
  );
  out.push("");

  out.push("## 1. 一次只動一項");
  out.push("");
  out.push(...CONDITION_HEADER);
  for (const { result } of report.conditions) out.push(conditionRow(result));
  out.push("");
  out.push(
    "定義偏移列：手長的 bias 即 −偏移，SD 為 0（它是定義差，不是隨機誤差）；掌寬假設同樣的偏移量，此假設沒有來源。",
  );
  out.push("");

  out.push("## 2. 貢獻排序（一次一項，掃描範圍內最大的 RMS）");
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
    "RMS = √(bias² + SD²)。排名依手長 RMS；各源的「掃描範圍」是我設的，不同源的最糟條件不代表同樣可能發生，這張表只說明量級。",
  );
  out.push("");

  out.push("## 3. 沒有 EXIF（focal 由紙角 homography 估計）");
  out.push("");
  out.push(
    '現行 `CAMERA_CONSTANTS.capture.source = "frame"` 的影格沒有 EXIF，管線會走 `estimateFocalFromHomography`；該估計在近正拍（傾斜 0–10°）時可能被判不可靠，管線就退回「不做視差修正」。以下其餘誤差源皆關閉，只動紙角噪音。',
  );
  out.push("");
  out.push(
    "| 條件 | 有做視差修正的比例 | 手長 bias | 手長 SD | 手長 P95\\|e\\| | 掌寬 bias | 掌寬 SD | 掌寬 P95\\|e\\| |",
  );
  out.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const c of report.homographyFocal) {
    out.push(
      `| ${c.name} | ${pct(c.correctedFraction)} | ${statCells(c.handLength)} | ${statCells(c.palmWidth)} |`,
    );
  }
  out.push("");
  out.push("拆開看（同一批掃描）：");
  out.push("");
  out.push(
    "| 條件 | 路徑 | 掃描數 | 手長 bias | 手長 SD | 手長 P95\\|e\\| | 掌寬 bias | 掌寬 SD | 掌寬 P95\\|e\\| |",
  );
  out.push("|---|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const c of report.homographyFocal) {
    for (const [label, half] of [
      ["視差修正", c.bySource.corrected],
      ["退回平面投影", c.bySource.flat],
    ] as const) {
      out.push(
        `| σ_c = ${c.name.split("σ_c = ")[1]} | ${label} | ${half.handLength.n} | ${statCells(half.handLength)} | ${statCells(half.palmWidth)} |`,
      );
    }
  }
  out.push("");

  out.push("## 4. 全部同時（三組假設檔）與方差占比");
  out.push("");
  out.push(
    "各檔的分布皆為假設：corner / landmark 是高斯 σ；focal 為 ±x% 均勻；高度縮放為均勻區間；逐關節抖動為 ±x% 均勻；k1 為 ±x 均勻。定義偏移是固定 bias，不放進聯合（另計 −偏移）。",
  );
  out.push("");
  out.push("| 檔 | σ_c px | σ_l px | focal | 高度縮放 | 逐關節 | k1 |");
  out.push("|---|---:|---:|---|---|---|---|");
  for (const { profile: p } of report.profiles) {
    out.push(
      `| ${p.name} | ${p.cornerSigmaPx} | ${p.landmarkSigmaPx} | ±${p.focalHalf * 100}% | ${p.heightScale.lo}–${p.heightScale.hi} | ${p.heightJitterHalf ? `±${p.heightJitterHalf * 100}%` : "無"} | ±${p.k1Half} |`,
    );
  }
  out.push("");
  out.push(...CONDITION_HEADER);
  for (const r of report.profiles) {
    out.push(conditionRow(r.joint));
    out.push(conditionRow(r.jointNoExif));
  }
  out.push("");
  for (const r of report.profiles) {
    out.push(`### ${r.profile.name}：方差占比（一次一項的 SD²）`);
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
    "之和 ÷ 聯合 = 1 表示各源方差可相加；小於 1 表示聯合比各自之和更大（交互作用放大）；大於 1 表示部分互相抵消。偏差（bias）不在 SD² 裡，見上表。",
  );
  out.push("");

  out.push("## 5. Σ_input（輸入共變異矩陣，模擬假設下，非實測）");
  out.push("");
  out.push(
    "(手長誤差, 掌寬誤差) 的 2×2 樣本共變異，單位 mm²，取自「全部同時」的聯合模擬（含三種手長混合）。這是上面那組假設下的值，**不是**實測，不得當作真實手機的輸入不確定度。",
  );
  out.push("");
  out.push("| 檔 | EXIF | Σ_input |");
  out.push("|---|---|---|");
  for (const r of report.profiles) {
    out.push(`| ${r.profile.name} | 有 | ${matrixCells(r.joint.covariance)} |`);
    out.push(
      `| ${r.profile.name} | 無 | ${matrixCells(r.jointNoExif.covariance)} |`,
    );
  }
  out.push("");

  out.push("## 6. 對照 v1 現用 σ_meas");
  out.push("");
  out.push(
    `v1 候選值（\`src/server/fit/coefficients.ts\`，未拍板）：手長 ${report.sigmaMeasV1.handLength} mm、掌寬 ${report.sigmaMeasV1.palmWidth} mm。`,
  );
  out.push("");
  out.push("| 檔 | EXIF | 手長 SD | 手長 RMS | 掌寬 SD | 掌寬 RMS |");
  out.push("|---|---|---:|---:|---:|---:|");
  for (const r of report.profiles) {
    for (const [label, c] of [
      ["有", r.joint],
      ["無", r.jointNoExif],
    ] as const) {
      out.push(
        `| ${r.profile.name} | ${label} | ${f2(c.handLength.sd)} | ${f2(c.handLength.rms)} | ${f2(c.palmWidth.sd)} | ${f2(c.palmWidth.rms)} |`,
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
