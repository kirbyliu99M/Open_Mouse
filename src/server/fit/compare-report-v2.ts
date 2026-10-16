import type { FitPreferences, GripStyle } from "../../lib/contracts/fit";
import { GRIP_STYLES } from "../../lib/contracts/fit";
import type { HandMeasurements } from "../../lib/contracts/measurement";
import { ENGINE_VERSION_V1 } from "./coefficients";
import {
  DEFAULT_PARAMS_V2,
  ENGINE_VERSION_V2,
  SIGMA_INPUT_B_NO_EXIF,
  V1_EQUIVALENT_PARAMS_V2,
  type FitV2Params,
} from "./coefficients-v2";
import { computePriors } from "./priors";
import { kendallTau, topKOverlap } from "./rank-compare-v2";
import { scoreFitV1 } from "./score-v1";
import { scoreFitV2, type FitV2Response } from "./score-v2";
import { rankingStabilityV2 } from "./stability-v2";
import type { CatalogueMouse } from "./types";

export interface CompareHand {
  hand: "left" | "right";
  measurements: HandMeasurements;
}

const slugs = (r: { results: { mouse: { slug: string } }[] }) =>
  r.results.map((e) => e.mouse.slug);

const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);
const pct = (p: number) => `${Math.round(p * 100)}%`;

/**
 * v1 vs v2 on the same catalogue and hands, as markdown. Pure and
 * deterministic (the resampling is seeded). Three v2 variants are compared with
 * v1 so a difference can be traced to its cause:
 *
 *  - "v2": the v2 defaults (equal grip thirds, simulated Sigma_input);
 *  - "v2, v1 grip": the same Sigma_input but v1's palm-ratio grip weights;
 *  - "v2, v1-equivalent": must equal v1 exactly (a sanity column).
 */
export function buildCompareReportV2(
  catalogue: readonly CatalogueMouse[],
  hands: Readonly<Record<string, CompareHand>>,
  description = "38-row Logitech seed, descriptors unknown",
  prefs: FitPreferences = { includeVertical: false },
): string {
  const priors = computePriors(catalogue);
  const withV1Grip: Partial<FitV2Params> = {
    ...DEFAULT_PARAMS_V2,
    gripUnknownMode: "v1_ratio",
  };
  const lines: string[] = [];
  lines.push("# Fit v1 vs v2 (structure prototype) comparison");
  lines.push("");
  lines.push(
    `候選，未拍板。Catalogue: ${catalogue.length} models (${description}). v1 = ${ENGINE_VERSION_V1}, v2 = ${ENGINE_VERSION_V2}. v2 totals are unrounded (0-100).`,
  );
  lines.push("");
  lines.push(
    `Sigma_input (v2 default, SIMULATED, not measured) = ${JSON.stringify(DEFAULT_PARAMS_V2.sigmaInput)} mm^2; no-EXIF = ${JSON.stringify(SIGMA_INPUT_B_NO_EXIF)}; v1-equivalent = ${JSON.stringify(V1_EQUIVALENT_PARAMS_V2.sigmaInput)}. Resamples M = 200, seed fixed.`,
  );
  lines.push("");

  const summary: string[] = [
    "| Hand | top-5 overlap v1/v2 | top-1 same | tau v1/v2 | top-5 overlap v1/v2 (v1 grip) | tau v1/v2 (v1 grip) | tau v1/v2 (v1-equivalent) |",
    "|---|---|---|---|---|---|---|",
  ];
  const detail: string[] = [];

  for (const [name, g] of Object.entries(hands)) {
    const v1 = scoreFitV1(g.measurements, catalogue, prefs, g.hand, priors);
    const v2 = scoreFitV2(g.measurements, catalogue, prefs, g.hand, priors);
    const v2g = scoreFitV2(g.measurements, catalogue, prefs, g.hand, priors, {
      params: withV1Grip,
    });
    const v2eq = scoreFitV2(g.measurements, catalogue, prefs, g.hand, priors, {
      params: V1_EQUIVALENT_PARAMS_V2,
    });
    const s = slugs(v1);
    summary.push(
      `| ${name} | ${topKOverlap(s, slugs(v2), 5)}/5 | ${s[0] === slugs(v2)[0] ? "yes" : "no"} | ${f2(kendallTau(s, slugs(v2)))} | ${topKOverlap(s, slugs(v2g), 5)}/5 | ${f2(kendallTau(s, slugs(v2g)))} | ${f2(kendallTau(s, slugs(v2eq)))} |`,
    );

    const st = rankingStabilityV2(
      g.measurements,
      catalogue,
      prefs,
      g.hand,
      priors,
    );
    const stNo = rankingStabilityV2(
      g.measurements,
      catalogue,
      prefs,
      g.hand,
      priors,
      { params: { sigmaInput: SIGMA_INPUT_B_NO_EXIF } },
    );
    const noBySlug = new Map(stNo.perMouse.map((m) => [m.slug, m] as const));

    detail.push(`## ${name}`);
    detail.push("");
    const r = g.measurements.palmLengthMm / g.measurements.handLengthMm;
    detail.push(
      `hand ${g.hand}, handLength ${g.measurements.handLengthMm} mm, palmLength ${g.measurements.palmLengthMm} mm (r = ${r.toFixed(3)}), palmWidth ${g.measurements.palmWidthMm} mm. v1 predicted grip: ${v1.gripStyle.predicted}; v2 grip: unknown, equal thirds (gripUnknown = ${v2.gripUnknown}).`,
    );
    detail.push("");
    detail.push("| Rank | v1 (rounded total) | v2 | v2, v1 grip |");
    detail.push("|---|---|---|---|");
    for (let i = 0; i < 5; i++) {
      const a = v1.results[i];
      const b = v2.results[i];
      const c = v2g.results[i];
      detail.push(
        `| ${i + 1} | ${a ? `${a.mouse.slug} ${a.total}` : ""} | ${b ? `${b.mouse.slug} ${f1(b.totalRaw)}` : ""} | ${c ? `${c.mouse.slug} ${f1(c.totalRaw)}` : ""} |`,
      );
    }
    detail.push("");
    detail.push(
      "Stability of the v2 top 5 (resampled true hands; totals are on the tolerance-only scale; no-EXIF = the larger simulated Sigma_input):",
    );
    detail.push("");
    detail.push(
      "| v2 rank | mouse | top-1 prob | top-5 prob | total P10-P90 | top-1 (no EXIF) | top-5 (no EXIF) |",
    );
    detail.push("|---|---|---|---|---|---|---|");
    const bySlug = new Map(st.perMouse.map((m) => [m.slug, m] as const));
    for (const e of v2.results.slice(0, 5)) {
      const m = bySlug.get(e.mouse.slug);
      const n = noBySlug.get(e.mouse.slug);
      if (!m || !n) continue;
      detail.push(
        `| ${e.rank} | ${e.mouse.slug} | ${pct(m.top1Prob)} | ${pct(m.top5Prob)} | ${f1(m.totalP10)}-${f1(m.totalP90)} | ${pct(n.top1Prob)} | ${pct(n.top5Prob)} |`,
      );
    }
    detail.push("");
    detail.push(rangeLine(v2));
    detail.push("");
  }

  lines.push(...summary, "", ...detail);
  return `${lines.join("\n")}\n`;
}

function rangeLine(v2: FitV2Response): string {
  const parts = GRIP_STYLES.map((gs: GripStyle) => {
    const rg = v2.ranges[gs];
    if (!rg) return "";
    return `${gs}: length ${f1(rg.length.lo)}-${f1(rg.length.hi)}, width ${f1(rg.gripWidth.lo)}-${f1(rg.gripWidth.hi)}, height ${f1(rg.height.lo)}-${f1(rg.height.hi)}`;
  }).filter(Boolean);
  const nIn = v2.results.filter((e) => e.inRangeAnyGrip).length;
  return `Acceptable range (sub-score >= ${v2.params.rangeThresholdScore}, mm): ${parts.join("; ")}. Mice in range on all three dimensions for some grip: ${nIn} of ${v2.results.length}.`;
}
