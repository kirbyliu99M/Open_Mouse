/**
 * Fit stability report (docs/fit-algorithm.md §8): how much the ranking moves
 * when a hand measurement moves by a plausible error, for fit-v0 and the
 * fit-v1 candidate on the same catalogue.
 *
 *   npx tsx scripts/fit-stability.ts
 *
 * Prints markdown to stdout. Local and deterministic: no network, no database,
 * no clock, no randomness. The catalogue is the checked-in 38-model seed with
 * every descriptor unknown (the one tests/unit/fit-golden.test.ts uses) and
 * the form factors of src/db/seed/logitech-facts.json; the hands are the four
 * golden hands.
 *
 * The acceptance threshold for "rigid" is Kirby's (未拍板); the candidate in the
 * spec is a top-5 Jaccard of at least 0.6 at ±5 mm.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computePriors } from "../src/server/fit/priors";
import { scoreFit } from "../src/server/fit/score";
import { buildSeedCatalogue } from "../src/server/fit/seed-catalogue";
import { scoreFitV1 } from "../src/server/fit/score-v1";
import {
  foldMeasures,
  palmLengthSweep,
  PERTURBATIONS,
  perturbationRuns,
  type EngineFn,
  type StabilityMeasure,
} from "../src/server/fit/stability";
import type { HandMeasurements } from "../src/lib/contracts/measurement";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(here(rel), "utf8"));

interface GoldenHand {
  hand: "left" | "right";
  measurements: HandMeasurements;
}

const golden = readJson("../tests/unit/fixtures/fit-golden.json") as Record<
  string,
  GoldenHand
>;
const catalogue = buildSeedCatalogue(
  readJson("../src/db/seed/logitech.json") as Parameters<
    typeof buildSeedCatalogue
  >[0],
  readJson("../src/db/seed/logitech-facts.json") as Parameters<
    typeof buildSeedCatalogue
  >[1],
);
const priors = computePriors(catalogue);

const engines: { id: string; run: EngineFn }[] = [
  { id: "v0", run: scoreFit },
  {
    id: "v1",
    run: (m, c, p, h) => scoreFitV1(m, c, p, h, priors),
  },
];

const pct = (n: number, d: number) => `${Math.round((100 * n) / d)}%`;
const cell = (m: StabilityMeasure) => ({
  top1: pct(m.top1Kept, m.runs),
  jac: m.top5Jaccard.toFixed(2),
  max: String(m.maxTotalChange),
});

const lines: string[] = [];
lines.push("# Fit stability report");
lines.push("");
lines.push(
  `Catalogue: ${catalogue.length} models (38-row Logitech seed, descriptors unknown, form factors from logitech-facts.json). Engines: v0 = fit-v0-provisional, v1 = fit-v1-candidate.`,
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

const allRuns: Record<string, ReturnType<typeof perturbationRuns>[]> = {};
for (const e of engines) allRuns[e.id] = [];
const byPerturbation: Record<
  string,
  Record<string, ReturnType<typeof perturbationRuns>>
> = {};

for (const [name, g] of Object.entries(golden)) {
  for (const p of PERTURBATIONS) {
    const measures = engines.map((e) => {
      const runs = perturbationRuns(
        e.run,
        catalogue,
        g.hand,
        g.measurements,
        p,
      );
      allRuns[e.id].push(runs);
      (byPerturbation[p.label] ??= {})[e.id] = [
        ...((byPerturbation[p.label]?.[e.id] ?? []) as []),
        ...runs,
      ];
      return cell(foldMeasures(runs));
    });
    const [a, b] = measures;
    lines.push(
      `| ${name} | ${p.label} | ${a.top1} | ${b.top1} | ${a.jac} | ${b.jac} | ${a.max} | ${b.max} |`,
    );
  }
}

for (const p of PERTURBATIONS) {
  const [a, b] = engines.map((e) =>
    cell(foldMeasures(byPerturbation[p.label][e.id])),
  );
  lines.push(
    `| **all four hands** | **${p.label}** | **${a.top1}** | **${b.top1}** | **${a.jac}** | **${b.jac}** | **${a.max}** | **${b.max}** |`,
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
let worst = { v0: 0, v1: 0 };
for (const [name, g] of Object.entries(golden)) {
  const [s0, s1] = engines.map((e) =>
    palmLengthSweep(e.run, catalogue, g.hand, g.measurements),
  );
  worst = {
    v0: Math.max(worst.v0, s0.maxJump),
    v1: Math.max(worst.v1, s1.maxJump),
  };
  const where = (s: typeof s0) =>
    `${s.slug} @ palm ${s.fromPalmLengthMm} to ${s.toPalmLengthMm} mm`;
  lines.push(
    `| ${name} | ${s0.maxJump} | ${where(s0)} | ${s1.maxJump} | ${where(s1)} |`,
  );
}
lines.push("");
lines.push(
  `Largest jump over all four hands: v0 = ${worst.v0} points, v1 = ${worst.v1} points.`,
);

process.stdout.write(lines.join("\n") + "\n");
