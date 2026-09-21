/**
 * M1 gate: compare our descriptors against the private validation fixture.
 *
 *   npm run rubric:validate [-- --predictions <file.json>] [--brand Logitech]
 *
 * NEVER runs in CI. The fixture lives outside the repo (../Dataset) and must
 * never be copied in; this script prints metrics only and writes no files.
 *
 * --predictions: JSON array of { model, humpPlacement?, frontFlare?,
 * sideCurvature? } using the slugs in src/lib/contracts/descriptors.ts.
 * Without it, only the computed-Size check runs.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FRONT_FLARES,
  HUMP_PLACEMENTS,
  SIDE_CURVATURES,
  SIZES,
  curvatureDirection,
  flareDirection,
  humpIsBack,
} from "../src/lib/contracts/descriptors";
import { type Agreement, agreement } from "../src/server/catalogue/agreement";
import { parseCsv, toSlug } from "../src/server/catalogue/csv";
import { computeSize } from "../src/server/catalogue/size";

if (process.env.CI) {
  console.error(
    "validate-rubric reads licensed data and must never run in CI.",
  );
  process.exit(1);
}

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const FIXTURE = resolve(
  process.cwd(),
  "..",
  "Dataset",
  "eloshapes_mouse_data.csv",
);
const brand = arg("--brand") ?? "Logitech";

if (!existsSync(FIXTURE)) {
  console.error(
    `Fixture not found at ${FIXTURE}. It lives beside the repo, never inside it.`,
  );
  process.exit(1);
}

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const rows = parseCsv(readFileSync(FIXTURE, "utf8")).filter(
  (r) => r.Brand === brand,
);
const pct = (x: number | null) =>
  x === null ? "  –  " : `${(100 * x).toFixed(1)}%`;

function report(
  name: string,
  a: Agreement,
  gate?: { coarse?: number; withinOne?: number },
) {
  const pass = (v: number | null, t?: number) =>
    t === undefined || v === null ? "" : v >= t ? " ✅" : " ❌";
  console.log(
    `${name.padEnd(16)} n=${String(a.n).padStart(3)}  exact ${pct(a.exact)}  within-one ${pct(a.withinOne)}${pass(a.withinOne, gate?.withinOne)}  coarse ${pct(a.coarse)}${pass(a.coarse, gate?.coarse)}`,
  );
  const misses = Object.entries(a.confusion).flatMap(([actual, preds]) =>
    Object.entries(preds)
      .filter(([p]) => p !== actual)
      .map(([p, k]) => `${actual}→${p} ×${k}`),
  );
  if (misses.length)
    console.log(`${"".padEnd(16)} misses: ${misses.join(", ")}`);
}

console.log(`Validation fixture: ${rows.length} ${brand} rows\n`);

const sizePairs = rows.flatMap((r) => {
  const [lengthMm, widthMm, heightMm] = [
    "Length (mm)",
    "Width (mm)",
    "Height (mm)",
  ].map((k) => Number(r[k]));
  const actual = toSlug(r.Size ?? "");
  if (
    ![lengthMm, widthMm, heightMm].every((v) => v! > 0) ||
    !(SIZES as readonly string[]).includes(actual)
  )
    return [];
  return [
    {
      predicted: computeSize({
        lengthMm: lengthMm!,
        widthMm: widthMm!,
        heightMm: heightMm!,
      }),
      actual: actual as (typeof SIZES)[number],
    },
  ];
});
report("size (computed)", agreement(sizePairs, SIZES), { withinOne: 0.9 });
console.log(
  `${"".padEnd(16)} gate: exact ≥ 85% → ${sizePairs.length && agreement(sizePairs, SIZES).exact >= 0.85 ? "✅" : "❌"}`,
);

const predictionsFile = arg("--predictions");
if (!predictionsFile) {
  console.log("\nNo --predictions file: visual descriptors not checked.");
  process.exit(0);
}

type Prediction = {
  model: string;
  humpPlacement?: string;
  frontFlare?: string;
  sideCurvature?: string;
};
const predictions = JSON.parse(
  readFileSync(resolve(predictionsFile), "utf8"),
) as Prediction[];
const byModel = new Map(rows.map((r) => [normalise(r.Model ?? ""), r]));
const unmatched = predictions
  .filter((p) => !byModel.has(normalise(p.model)))
  .map((p) => p.model);

function pairs<T extends string>(
  field: keyof Prediction,
  column: string,
  scale: readonly T[],
) {
  return predictions.flatMap((p) => {
    const row = byModel.get(normalise(p.model));
    const predicted = p[field];
    const actual = row ? toSlug(row[column] ?? "") : "";
    return predicted &&
      scale.includes(predicted as T) &&
      scale.includes(actual as T)
      ? [{ predicted: predicted as T, actual: actual as T }]
      : [];
  });
}

console.log("");
report(
  "hump",
  agreement(
    pairs("humpPlacement", "Hump placement", HUMP_PLACEMENTS),
    HUMP_PLACEMENTS,
    humpIsBack,
  ),
  { coarse: 0.85, withinOne: 0.9 },
);
report(
  "front flare",
  agreement(
    pairs("frontFlare", "Front flare", FRONT_FLARES),
    FRONT_FLARES,
    flareDirection,
  ),
  { coarse: 0.85, withinOne: 0.9 },
);
report(
  "side curvature",
  agreement(
    pairs("sideCurvature", "Side curvature", SIDE_CURVATURES),
    SIDE_CURVATURES,
    curvatureDirection,
  ),
  { coarse: 0.85, withinOne: 0.9 },
);
if (unmatched.length)
  console.log(
    `\nUnmatched models (${unmatched.length}): ${unmatched.join(", ")}`,
  );
