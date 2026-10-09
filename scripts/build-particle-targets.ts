/**
 * Sample the home page's particle targets (Home v3, PR A: the sampling half).
 *
 *   npm run particles:build            write the outputs
 *   npm run particles:build -- --check  fail if a committed output is stale
 *
 * Reads every SVG in public/images/sketches/ and writes
 *   - src/lib/particles/targets.generated.json  the point lists (PR B loads it)
 *   - public/images/palmate-mark.svg            the static Palmate mark
 *   - public/images/hand-on-a4.svg              the static template hand on A4
 * from the same pure functions (src/lib/particles/), seeded, so a run is
 * reproducible. Pairing and interpolation are PR B.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { SKETCH_DIR, buildArtifacts } from "../src/lib/particles/artifacts";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");

const sketches: Record<string, string> = {};
for (const file of readdirSync(resolve(root, SKETCH_DIR)).sort()) {
  if (file.endsWith(".svg")) {
    sketches[basename(file, ".svg")] = readFileSync(
      resolve(root, SKETCH_DIR, file),
      "utf8",
    );
  }
}
if (Object.keys(sketches).length === 0) {
  console.error(`No sketches in ${SKETCH_DIR}`);
  process.exit(1);
}

let stale = 0;
for (const [path, text] of Object.entries(buildArtifacts(sketches))) {
  const target = resolve(root, path);
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (check) {
    if (current !== text) {
      console.error(`stale: ${path}`);
      stale += 1;
    }
    continue;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  console.log(
    `${current === text ? "unchanged" : "wrote"}: ${path} (${text.length} bytes)`,
  );
}
if (stale > 0) {
  console.error("Run `npm run particles:build` and commit the result.");
  process.exit(1);
}
