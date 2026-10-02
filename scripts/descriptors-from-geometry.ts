/**
 * Regenerates src/db/seed/logitech-descriptors.json from the GD-1 geometry
 * predictions: hump placement only. Front flare and side curvature failed the
 * M1 gate and are written as null whatever the input says.
 *
 *   tsx scripts/descriptors-from-geometry.ts <predictions.json>
 *   tsx scripts/descriptors-from-geometry.ts <predictions.json> --check
 *
 * The predictions file stays outside the repo. It must be the GD-1 run 1 file,
 * SHA-256 21e7ffcf3e6af66bb492f1bcdffe704a6f672f84c50f7015c54ed25badc5dc37
 * (the one the gate was measured on; pre-registration commit 06cc13d on
 * origin/geo-descriptors). Any other file is refused.
 *
 * --check     compare with the committed seed file instead of writing it
 *             (exit 1 when they differ)
 * --out       the file to write or check (default: the seed file)
 * --apply     comma-separated descriptors to copy (default humpPlacement; any
 *             other value is refused)
 * --expect-sha256  use another hash than the pinned one (tests only)
 *
 * What the records mean, and why G9b must merge its facts into this file before
 * it ships, is in src/server/catalogue/geometry-descriptors.ts.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { format, resolveConfig } from "prettier";
import {
  convertPredictionsFile,
  GeometryConversionError,
} from "../src/server/catalogue/geometry-descriptors";

const SEED_PATH = "src/db/seed/logitech-descriptors.json";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      check: { type: "boolean" },
      out: { type: "string" },
      apply: { type: "string" },
      "expect-sha256": { type: "string" },
    },
  });
  const [predictionsPath] = positionals;
  if (!predictionsPath || positionals.length > 1) {
    throw new GeometryConversionError(
      "Usage: tsx scripts/descriptors-from-geometry.ts <predictions.json> [--check] [--out <file>]",
    );
  }
  const outPath = values.out ?? SEED_PATH;

  const { records, skipped, sha256 } = convertPredictionsFile(
    readFileSync(predictionsPath),
    {
      apply: values.apply?.split(","),
      expectedSha256: values["expect-sha256"],
    },
  );

  // Format with the repo's own prettier so the file passes `prettier --check`.
  const text = await format(JSON.stringify(records, null, 2), {
    ...(await resolveConfig(outPath)),
    filepath: outPath,
  });

  console.log(
    `${basename(predictionsPath)} sha256 ${sha256}: ${records.length} records, ${skipped.length} without a hump (${skipped.join(", ") || "none"}).`,
  );
  if (values.check) {
    if (!existsSync(outPath) || readFileSync(outPath, "utf8") !== text) {
      throw new GeometryConversionError(
        `${outPath} does not match what these predictions produce.`,
      );
    }
    console.log(`${outPath} matches.`);
    return;
  }
  writeFileSync(outPath, text);
  console.log(`Wrote ${outPath}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
