/**
 * One-off generator for the two committed fake-camera video fixtures under
 * tests/e2e/fixtures/camera/ (docs/design/camera-capture-2026-09-25/
 * README.md: "a generated .y4m/.mjpeg of the real sheet layout"). Opt-in
 * only, same convention as tests/e2e/journey-screenshots.spec.ts — a
 * normal `playwright test` run must never silently rewrite the committed
 * fixtures. Run by hand whenever they need regenerating (needs `ffmpeg` on
 * PATH):
 *
 *   GEN_CAMERA_FIXTURES=1 npx playwright test tests/e2e/fixtures/gen-camera-fixtures.spec.ts
 *
 * (Run through the Playwright test runner rather than plain `tsx` because
 * `camera-scene.ts`'s `page.evaluate` callback doesn't survive tsx's
 * standalone esbuild transform — Playwright's own transform serializes it
 * to the browser correctly, the same way every other fixture builder in
 * this directory is already exercised.)
 *
 * Renders two PNG frames with `camera-scene.ts` (a real Chromium canvas —
 * Node has no canvas here), then shells out to `ffmpeg` to mux each single
 * frame into a tiny looping MJPEG. Chromium's
 * `--use-file-for-fake-video-capture` loops whatever frames the file
 * contains, so a handful of identical frames is enough to serve as a
 * "camera feed" for as long as a test needs it — this is a static prop,
 * not a real recording, and its whole point is to be deterministic.
 */
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "@playwright/test";
import type { Homography } from "../../../src/client/geometry/homography";
import { buildCameraScenePng } from "./camera-scene";

const run = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "camera");
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 1300;
// Mirrors (not yet merged) contract PR #58's PAPER_SIZES_MM.a4.
const A4_MM = { width: 210, height: 297 };

// Pure scale + translate (no perspective): the A4 paper maps to roughly the
// middle 80% of the canvas width, which is well inside the live loop's
// 55-95% "ok" size band and produces an exactly square (unskewed) tracked
// quad — the fixture is meant to sail through every check, not exercise
// their failure edges (those are unit-tested in tests/unit/camera-*.test.ts
// instead).
const SCALE = 3.81;
const TX = (CANVAS_WIDTH - A4_MM.width * SCALE) / 2;
const TY = (CANVAS_HEIGHT - A4_MM.height * SCALE) / 2;
const HOMOGRAPHY: Homography = [
  [SCALE, 0, TX],
  [0, SCALE, TY],
  [0, 0, 1],
];

async function ffmpeg(args: string[]): Promise<void> {
  await run("ffmpeg", ["-y", ...args]);
}

test("generates tests/e2e/fixtures/camera/sheet-{full,partial}.mjpeg", async ({
  page,
}) => {
  test.skip(
    process.env.GEN_CAMERA_FIXTURES !== "1",
    "Fixture generation is opt-in — set GEN_CAMERA_FIXTURES=1 to run it.",
  );

  await mkdir(OUT_DIR, { recursive: true });

  const fullPng = await buildCameraScenePng(page, {
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    homography: HOMOGRAPHY,
    paperSizeMm: A4_MM,
    markerIds: [0, 1, 2, 3],
  });
  const partialPng = await buildCameraScenePng(page, {
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    homography: HOMOGRAPHY,
    paperSizeMm: A4_MM,
    markerIds: [0, 1], // top two only — "move back" / 2-of-4 lock-on
  });

  const fullPngPath = path.join(OUT_DIR, "_full.png");
  const partialPngPath = path.join(OUT_DIR, "_partial.png");
  await writeFile(fullPngPath, fullPng);
  await writeFile(partialPngPath, partialPng);

  // 3 identical frames at 3fps (1s) is plenty — the fake capture device
  // loops the file for as long as the test keeps the stream open.
  await ffmpeg([
    "-loop",
    "1",
    "-i",
    fullPngPath,
    "-frames:v",
    "3",
    "-r",
    "3",
    "-q:v",
    "3",
    path.join(OUT_DIR, "sheet-full.mjpeg"),
  ]);
  await ffmpeg([
    "-loop",
    "1",
    "-i",
    partialPngPath,
    "-frames:v",
    "3",
    "-r",
    "3",
    "-q:v",
    "3",
    path.join(OUT_DIR, "sheet-partial.mjpeg"),
  ]);

  await rm(fullPngPath);
  await rm(partialPngPath);
});
