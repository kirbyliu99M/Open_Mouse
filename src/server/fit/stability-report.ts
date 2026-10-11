import type { HandMeasurements } from "../../lib/contracts/measurement";
import { ENGINE_VERSION, ENGINE_VERSION_V1 } from "./coefficients";
import { computePriors } from "./priors";
import { scoreFit } from "./score";
import { scoreFitV1 } from "./score-v1";
import {
  foldMeasures,
  palmLengthSweep,
  PERTURBATIONS,
  perturbationRuns,
  THICKNESS_ANSWERS,
  thicknessRuns,
  withThickness,
  type EngineFn,
  type StabilityMeasure,
} from "./stability";
import type { CatalogueMouse } from "./types";

export interface ReportHand {
  hand: "left" | "right";
  measurements: HandMeasurements;
}

const pct = (n: number, d: number) => `${Math.round((100 * n) / d)}%`;
const cell = (m: StabilityMeasure) => ({
  top1: pct(m.top1Kept, m.runs),
  jac: m.top5Jaccard.toFixed(2),
  max: String(m.maxTotalChange),
});

/**
 * The docs/fit-algorithm.md section 8 report as markdown: v0 and v1 on the same
 * catalogue and hands. Pure and deterministic (no clock, no randomness, no I/O),
 * so the same input always gives the same string. `scripts/fit-stability.ts`
 * reads the files and prints it.
 */
export function buildStabilityReport(
  catalogue: readonly CatalogueMouse[],
  hands: Readonly<Record<string, ReportHand>>,
  /** What the "Catalogue:" line says the catalogue is; the default is the 38-row seed. */
  description = "38-row Logitech seed, descriptors unknown, form factors from logitech-facts.json",
): string {
  const priors = computePriors(catalogue);
  const engines: { id: "v0" | "v1"; run: EngineFn }[] = [
    { id: "v0", run: scoreFit },
    { id: "v1", run: (m, c, p, h) => scoreFitV1(m, c, p, h, priors) },
  ];

  const lines: string[] = [];
  lines.push("# Fit stability report");
  lines.push("");
  lines.push(
    `Catalogue: ${catalogue.length} models (${description}). Engines: v0 = ${ENGINE_VERSION}, v1 = ${ENGINE_VERSION_V1}.`,
  );
  lines.push("");
  lines.push(
    "Each cell compares the perturbed ranking with the base ranking of the same engine. Top-1 kept = share of perturbed runs whose first mouse is the base first mouse; Jaccard = mean overlap of the top-5 sets; max Δ = largest change in a base top-5 mouse's displayed total (points).",
  );
  lines.push("");
  lines.push(
    "| Hand | Perturbation | Top-1 kept v0 | Top-1 kept v1 | Top-5 Jaccard v0 | Top-5 Jaccard v1 | Max Δ total v0 | Max Δ total v1 |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");

  // Per perturbation, the runs of every hand pooled, per engine.
  const pooled = new Map<
    string,
    Record<string, ReturnType<typeof perturbationRuns>>
  >();

  for (const [name, g] of Object.entries(hands)) {
    for (const p of PERTURBATIONS) {
      const [a, b] = engines.map((e) => {
        const runs = perturbationRuns(
          e.run,
          catalogue,
          g.hand,
          g.measurements,
          p,
        );
        const entry = pooled.get(p.label) ?? { v0: [], v1: [] };
        entry[e.id] = [...entry[e.id], ...runs];
        pooled.set(p.label, entry);
        return cell(foldMeasures(runs));
      });
      lines.push(
        `| ${name} | ${p.label} | ${a.top1} | ${b.top1} | ${a.jac} | ${b.jac} | ${a.max} | ${b.max} |`,
      );
    }
  }

  for (const p of PERTURBATIONS) {
    const runs = pooled.get(p.label);
    if (!runs) continue;
    const a = cell(foldMeasures(runs.v0));
    const b = cell(foldMeasures(runs.v1));
    lines.push(
      `| **all hands** | **${p.label}** | **${a.top1}** | **${b.top1}** | **${a.jac}** | **${b.jac}** | **${a.max}** | **${b.max}** |`,
    );
  }

  lines.push("");
  lines.push("## Palm-length sweep (continuity)");
  lines.push("");
  lines.push(
    "Hand length fixed, palm length stepped by 0.5 mm over r = palm/hand in [0.50, 0.62]. Jump = change in one mouse's displayed total between neighbouring steps. v1 must have no jump above 2.",
  );
  lines.push("");
  lines.push(
    "| Hand | Largest jump v0 | Where (v0) | Largest jump v1 | Where (v1) |",
  );
  lines.push("|---|---|---|---|---|");
  const worst = { v0: 0, v1: 0 };
  for (const [name, g] of Object.entries(hands)) {
    const [s0, s1] = engines.map((e) =>
      palmLengthSweep(e.run, catalogue, g.hand, g.measurements),
    );
    worst.v0 = Math.max(worst.v0, s0.maxJump);
    worst.v1 = Math.max(worst.v1, s1.maxJump);
    const where = (s: typeof s0) =>
      `${s.slug} @ palm ${s.fromPalmLengthMm} to ${s.toPalmLengthMm} mm`;
    lines.push(
      `| ${name} | ${s0.maxJump} | ${where(s0)} | ${s1.maxJump} | ${where(s1)} |`,
    );
  }
  lines.push("");
  lines.push(
    `Largest jump over all hands: v0 = ${worst.v0} points, v1 = ${worst.v1} points.`,
  );

  lines.push("");
  lines.push("## Palm-thickness sensitivity (v1 only)");
  lines.push("");
  lines.push(
    "Candidate, uncalibrated: the person's own thin / medium / thick answer shifts the height target by -1.5 / 0 / +1.5 mm (`THICKNESS_HEIGHT_SHIFT_MM`). v0 ignores the answer. Each cell compares the hand scored with the answer against the same hand with no answer, on the same catalogue: top-1 kept (the first mouse is unchanged), top-5 Jaccard against the no-answer top 5, max Δ = largest change in a no-answer top-5 mouse's displayed total (points). `none` is the baseline itself; `medium` must equal it.",
  );
  lines.push("");
  lines.push(
    "| Hand | Answer | Top-1 kept | Top-5 Jaccard | Max Δ total (no-answer top 5) |",
  );
  lines.push("|---|---|---|---|---|");
  const answerRuns = new Map<string, ReturnType<typeof thicknessRuns>[]>();
  for (const [name, g] of Object.entries(hands)) {
    const runs = thicknessRuns(
      engines[1].run,
      catalogue,
      g.hand,
      g.measurements,
    );
    for (const a of THICKNESS_ANSWERS) {
      const c = cell(foldMeasures([runs[a]]));
      lines.push(`| ${name} | ${a} | ${c.top1} | ${c.jac} | ${c.max} |`);
      answerRuns.set(a, [...(answerRuns.get(a) ?? []), runs]);
    }
  }
  for (const a of THICKNESS_ANSWERS) {
    const c = cell(foldMeasures((answerRuns.get(a) ?? []).map((r) => r[a])));
    lines.push(
      `| **all hands** | **${a}** | **${c.top1}** | **${c.jac}** | **${c.max}** |`,
    );
  }

  lines.push("");
  lines.push("### Palm-length sweep with the answer fixed (v1)");
  lines.push("");
  lines.push(
    "Same sweep as above (0.5 mm steps, r in [0.50, 0.62]) with the thickness answer fixed. v1 must have no jump above 2.",
  );
  lines.push("");
  lines.push("| Hand | none | thin | medium | thick |");
  lines.push("|---|---|---|---|---|");
  const worstByAnswer: Record<string, number> = {};
  for (const [name, g] of Object.entries(hands)) {
    const cells = THICKNESS_ANSWERS.map((a) => {
      const sweep = palmLengthSweep(
        engines[1].run,
        catalogue,
        g.hand,
        g.measurements,
        {},
        withThickness({ includeVertical: false }, a),
      );
      worstByAnswer[a] = Math.max(worstByAnswer[a] ?? 0, sweep.maxJump);
      return String(sweep.maxJump);
    });
    lines.push(`| ${name} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push(
    `Largest jump over all hands: ${THICKNESS_ANSWERS.map((a) => `${a} = ${worstByAnswer[a] ?? 0}`).join(", ")} points.`,
  );

  return lines.join("\n") + "\n";
}
