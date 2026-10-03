/**
 * The logic of scripts/descriptors-from-geometry.ts, split out so a test can
 * call it with a scratch folder and its own hash. The script itself only wires
 * it to `process.argv`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { format, resolveConfig } from "prettier";
import {
  convertPredictionsFile,
  GeometryConversionError,
} from "../src/server/catalogue/geometry-descriptors";
import { DESCRIPTORS_SEED_PATH } from "../src/server/catalogue/seed-rows";

export interface RunOptions {
  /** What relative paths (the predictions file, `--out`, the default output) resolve against. Defaults to the working directory. */
  cwd?: string;
  /**
   * Use another hash than the pinned GD-1 run 1 one. For tests only: it is
   * deliberately not a command-line flag, so no one can point the script at a
   * different predictions file from the shell.
   */
  expectedSha256?: string;
  /** Where the report lines go. Defaults to `console.log`. */
  log?: (line: string) => void;
}

export async function runGeometryDescriptors(
  argv: readonly string[],
  options: RunOptions = {},
): Promise<void> {
  const log = options.log ?? ((line: string) => console.log(line));
  const cwd = options.cwd ?? process.cwd();
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      check: { type: "boolean" },
      out: { type: "string" },
      apply: { type: "string" },
    },
  });
  const [predictionsArg] = positionals;
  if (!predictionsArg || positionals.length > 1) {
    throw new GeometryConversionError(
      "Usage: tsx scripts/descriptors-from-geometry.ts <predictions.json> [--check] [--out <file>]",
    );
  }
  const outArg = values.out ?? DESCRIPTORS_SEED_PATH;
  const outPath = resolve(cwd, outArg);

  const { records, skipped, sha256 } = convertPredictionsFile(
    readFileSync(resolve(cwd, predictionsArg)),
    {
      apply: values.apply?.split(","),
      expectedSha256: options.expectedSha256,
    },
  );

  // Format with the repo's own prettier so the file passes `prettier --check`.
  const text = await format(JSON.stringify(records, null, 2), {
    ...(await resolveConfig(outPath)),
    filepath: outPath,
  });

  log(
    `${basename(predictionsArg)} sha256 ${sha256}: ${records.length} records, ${skipped.length} without a hump (${skipped.join(", ") || "none"}).`,
  );
  if (values.check) {
    if (!existsSync(outPath) || readFileSync(outPath, "utf8") !== text) {
      throw new GeometryConversionError(
        `${outArg} does not match what these predictions produce.`,
      );
    }
    log(`${outArg} matches.`);
    return;
  }
  writeFileSync(outPath, text);
  log(`Wrote ${outArg}.`);
}
