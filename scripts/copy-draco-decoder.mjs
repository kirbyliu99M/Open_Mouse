/**
 * The 3D viewer's Draco decoder, self-hosted (no CDN; the CSP allows only
 * 'self').
 *
 *   npm run viewer:draco             copy the files
 *   npm run viewer:draco -- --check  fail if the committed copy differs
 *
 * three ships the decoder next to its glTF loader. DRACOLoader fetches these
 * three files from the path it is given (`/draco/`): the WebAssembly decoder
 * with its small JS wrapper, and a pure-JS decoder for a browser without
 * WebAssembly. Copied unmodified and committed, so a build never depends on
 * an install script (a Vercel build runs `npm ci` with install scripts
 * blocked) and so the files a browser gets are the ones reviewed here. A unit
 * test compares the copy with node_modules, so upgrading three without
 * re-running this fails the tests.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "node_modules/three/examples/jsm/libs/draco/gltf");
const target = resolve(root, "public/draco");
const FILES = [
  "draco_decoder.js",
  "draco_decoder.wasm",
  "draco_wasm_wrapper.js",
];
const check = process.argv.includes("--check");

let stale = 0;
for (const file of FILES) {
  const from = resolve(source, file);
  const to = resolve(target, file);
  const same = existsSync(to) && readFileSync(from).equals(readFileSync(to));
  if (check) {
    if (!same) {
      console.error(`stale: public/draco/${file}`);
      stale += 1;
    }
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  if (!same) copyFileSync(from, to);
  console.log(`${same ? "unchanged" : "copied"}: public/draco/${file}`);
}
if (stale > 0) {
  console.error("Run `npm run viewer:draco` and commit the result.");
  process.exit(1);
}
