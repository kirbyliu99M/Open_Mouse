/**
 * The 3D viewer's compact shell index.
 *
 *   npm run viewer:index            write the output
 *   npm run viewer:index -- --check fail if the committed output is stale
 *
 * Reads public/models/manifest.json (Codex's, never edited here) and writes
 * src/lib/viewer/shell-index.generated.json: each shell's slug and path, plus
 * the slugs that have no shell. The full manifest is 130 kB of sources and
 * audit numbers the browser has no use for.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildShellIndex } from "../src/lib/viewer/shells";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");

const manifest = JSON.parse(
  readFileSync(resolve(root, "public/models/manifest.json"), "utf8"),
);
const target = resolve(root, "src/lib/viewer/shell-index.generated.json");
const text = `${JSON.stringify(buildShellIndex(manifest), null, 2)}\n`;
const current = existsSync(target) ? readFileSync(target, "utf8") : null;

if (check) {
  if (current !== text) {
    console.error("stale: src/lib/viewer/shell-index.generated.json");
    console.error("Run `npm run viewer:index` and commit the result.");
    process.exit(1);
  }
  console.log("shell index is current");
} else {
  writeFileSync(target, text);
  console.log(
    `${current === text ? "unchanged" : "wrote"}: src/lib/viewer/shell-index.generated.json`,
  );
}
