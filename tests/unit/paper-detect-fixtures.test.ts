/**
 * LOCAL-ONLY: runs `detectPaperQuad` on Kirby's real ground-truth hand
 * photos and prints corner results, following the privacy pattern the
 * removed `scripts/m2-gate-replay.ts` set (kept by `scripts/learn-sort.ts`
 * and `scripts/m2-evaluate.ts`) — the photos live OUTSIDE the repo
 * (`../Fixtures/hands/`, gitignored belt-and-braces too), this file never
 * reads them into anything that gets committed, and the whole describe
 * block is skipped in CI and whenever the folder is absent (it may well be
 * empty — this test asserts nothing about specific fixture content, only
 * that the detector runs and prints something sensible).
 *
 * `findFixturesDir` walks a few levels up from `process.cwd()` looking for
 * `Fixtures/hands`: the removed `scripts/m2-gate-replay.ts` used the
 * convention (`resolve(process.cwd(), "..", "Fixtures", "hands")`), which assumes vitest runs
 * from the checked-out repo's root one level under the photos' actual
 * location. This worktree instead lives several directories deeper
 * (`.claude/worktrees/m2-paper-edge`), so a plain `".."` wouldn't find
 * them; walking up is what makes the test still work from either layout.
 *
 * Decoding a real JPEG into pixel data needs an actual image codec, which
 * the Node/Vitest unit environment doesn't have built in (this repo's
 * printed-sheet equivalent test coverage for that reason lives in
 * `tests/e2e/scan.spec.ts`, a real browser, not Vitest) — this test uses
 * `sharp` if it happens to be installed (as it is transitively in this
 * checkout today) and otherwise logs why it's skipping rather than
 * failing, since a missing optional decoder is not a paper-edge detector
 * bug.
 */
import { describe, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { detectPaperQuad } from "../../src/client/paper/detect";
import type { PaperSize } from "../../src/lib/contracts/measurement";

/**
 * Minimal shape this test needs from `sharp` — deliberately NOT typed via
 * `typeof import("sharp")`. `sharp` isn't a declared dependency here (it's
 * only transitively present in some checkouts, e.g. via Next.js's optional
 * image-optimization support), so its own type declarations may not
 * resolve at all in every checkout; importing it through a non-literal
 * specifier below (`Promise<any>` from TypeScript's point of view) keeps
 * `npm run typecheck` green regardless of whether `sharp` — or even a
 * compatible version of it — happens to be installed.
 */
interface SharpImage {
  ensureAlpha(): SharpImage;
  raw(): SharpImage;
  toBuffer(opts: {
    resolveWithObject: true;
  }): Promise<{ data: Buffer; info: { width: number; height: number } }>;
}
type SharpFactory = (path: string) => SharpImage;

async function loadSharp(): Promise<SharpFactory | null> {
  const moduleName = "sharp"; // non-literal specifier — see the interface's doc comment above.
  try {
    const mod: { default?: SharpFactory } = await import(moduleName);
    return mod.default ?? (mod as unknown as SharpFactory);
  } catch {
    return null;
  }
}

function findFixturesDir(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "Fixtures", "hands");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const fixturesDir = process.env.CI ? null : findFixturesDir();

describe.skipIf(!fixturesDir)(
  "detectPaperQuad — LOCAL ONLY: real fixture photos",
  () => {
    it("runs on every photo under ../Fixtures/hands and prints corner results", async (context) => {
      if (!fixturesDir) return; // describe.skipIf already handles this; guards TypeScript's control-flow narrowing below.

      const sharp = await loadSharp();
      if (!sharp) {
        console.warn(
          'Skipping real-photo paper-edge check: "sharp" isn\'t installed. ' +
            "This is an optional local decoder, not a paper-edge bug — install it manually to run this check.",
        );
        context.skip();
        return;
      }

      const sessionDirs = readdirSync(fixturesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(fixturesDir, e.name));
      const paperSize: PaperSize = "a4";

      let checked = 0;
      for (const sessionDir of sessionDirs) {
        const files = readdirSync(sessionDir).filter((f) =>
          [".jpg", ".jpeg", ".png"].includes(extname(f).toLowerCase()),
        );
        for (const file of files) {
          const filePath = join(sessionDir, file);
          const image = sharp(filePath).ensureAlpha();
          const { data, info } = await image
            .raw()
            .toBuffer({ resolveWithObject: true });
          const imageData = {
            width: info.width,
            height: info.height,
            data: new Uint8ClampedArray(
              data.buffer,
              data.byteOffset,
              data.byteLength,
            ),
          } as unknown as ImageData;

          const t0 = performance.now();
          const result = detectPaperQuad(imageData, paperSize);
          const ms = performance.now() - t0;
          checked++;

          console.log(
            `[paper-fixture] ${file}: ${info.width}x${info.height} ${ms.toFixed(1)}ms ` +
              `cornersSeen=${result.cornersSeen} minSideCoverage=${result.minSideCoverage.toFixed(3)} ` +
              `edgeFitResidualPx=${result.edgeFitResidualPx.toFixed(3)} ` +
              `corners=${result.corners ? JSON.stringify(result.corners) : "null"}`,
          );
        }
      }
      console.log(
        `[paper-fixture] checked ${checked} photo(s) under ${fixturesDir}`,
      );
    });
  },
);
