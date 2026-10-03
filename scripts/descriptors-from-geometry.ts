/**
 * Regenerates src/db/seed/logitech-descriptors.json from the GD-1 geometry
 * predictions: hump placement only. Front flare and side curvature failed their
 * M1 criteria and are written as null whatever the input says.
 *
 *   npm run descriptors:from-geometry -- <predictions.json>
 *   npm run descriptors:from-geometry -- <predictions.json> --check
 *
 * The predictions file stays outside the repo. It must be the GD-1 run 1 file,
 * SHA-256 21e7ffcf3e6af66bb492f1bcdffe704a6f672f84c50f7015c54ed25badc5dc37
 * (the one the criteria were measured on; pre-registration commit 06cc13d on
 * origin/geo-descriptors). Any other file is refused, and there is no flag to
 * name another hash.
 *
 * --check     compare with the committed seed file instead of writing it
 *             (exit 1 when they differ)
 * --out       the file to write or check (default: the seed file)
 * --apply     comma-separated descriptors to copy (default humpPlacement; any
 *             other value is refused)
 *
 * What the records mean, and why G9b must merge its facts into this file before
 * it ships, is in src/server/catalogue/geometry-descriptors.ts. The work itself
 * is in ./descriptors-from-geometry-run.ts.
 */
import { runGeometryDescriptors } from "./descriptors-from-geometry-run";

runGeometryDescriptors(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
