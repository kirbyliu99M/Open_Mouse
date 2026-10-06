/**
 * One-off generator for the committed fake-camera video fixtures under
 * tests/e2e/fixtures/camera/ (docs/design/camera-capture-2026-09-25/
 * README.md: "a generated .y4m/.mjpeg of the real sheet layout") — one
 * printed-sheet fixture (markers, still the shipped default flow) and two
 * paper-edge fixtures (blank paper, no markers — the real
 * `detectPaperQuad`'s lock-on target: see paper-scene.ts). Opt-in only,
 * same convention as tests/e2e/journey-screenshots.spec.ts — a normal
 * `playwright test` run must never silently rewrite the committed
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
 * frame into a Y4M (uncompressed YUV4MPEG2). **Y4M, not MJPEG**: verified
 * by hand (dumped what Chromium's fake capture device actually served back
 * to a `<video>` element into a PNG) that this Chromium build's
 * `--use-file-for-fake-video-capture` silently falls back to its default
 * solid-green synthetic pattern for our MJPEG output — content that
 * `ffprobe` reads back fine is not proof Chromium's own fake-capture
 * demuxer accepts it — while the identical scene as Y4M is served
 * correctly, markers intact even after the live loop's own 640px
 * downscale. One frame is enough (the fixture is a static prop, not a
 * recording), so despite being uncompressed this is still ~1-2MB.
 */
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "@playwright/test";
import type { Homography } from "../../../src/client/geometry/homography";
import { buildCameraScenePng } from "./camera-scene";
import { buildPaperScenePng } from "./paper-scene";

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

// Paper-edge fixture: a genuine (non-affine) perspective, and a slightly
// different scale/position — verified by hand against the real
// `detectPaperQuad` (both at full resolution and downscaled to the live
// loop's 640px long edge) to land all 4 corners with the hand occluder in
// place; see this file's own generation run for the numbers reported in
// the PR.
//
// The easy scan looks only at the part of the stream that is ON SCREEN (the
// stage shows it with object-fit: cover; src/client/camera/visibleView.ts):
// on the fake phone's 390x844 screen that is the middle 601 columns of this
// 1000x1300 frame (x 200 to 801), the whole height. So the sheet is drawn
// 85 % as wide as that, the guide rectangle's own width (GUIDE_INSETS), and
// not wider: 210 mm x 2.45 = 514 px of 601 (before this change it was 3.6,
// 756 px, a sheet that is wider than what the screen shows and could be found
// by a detector that looked at the whole frame, but not by one that looks at
// the screen).
const PAPER_SCALE = 2.45;
const PAPER_TX = (CANVAS_WIDTH - A4_MM.width * PAPER_SCALE) / 2;
const PAPER_TY = (CANVAS_HEIGHT - A4_MM.height * PAPER_SCALE) / 2 - 20;
const PAPER_HOMOGRAPHY: Homography = [
  [PAPER_SCALE, 0.06, PAPER_TX],
  [-0.02, PAPER_SCALE, PAPER_TY],
  [0.00003, -0.00002, 1],
];

// Paper-edge "partial" fixture: framed so ONLY the bottom edge falls
// outside the frame (top/left/right all comfortably inside with margin) —
// the real detector fits 3 sides, so only the two TOP corners (each needs
// its two adjacent sides fit) are computable: cornersSeen === 2. Zooming
// so every side clips (verified by hand first) instead leaves 0 sides
// fittable and reports 0, not 2 — worth noting for next time this needs
// regenerating. No hand occluder (not the thing being demonstrated here).
const PARTIAL_SCALE = 4.3;
const PARTIAL_TX = (CANVAS_WIDTH - A4_MM.width * PARTIAL_SCALE) / 2;
const PARTIAL_TY = 150;
const PARTIAL_HOMOGRAPHY: Homography = [
  [PARTIAL_SCALE, 0, PARTIAL_TX],
  [0, PARTIAL_SCALE, PARTIAL_TY],
  [0, 0, 1],
];

async function ffmpeg(args: string[]): Promise<void> {
  await run("ffmpeg", ["-y", ...args]);
}

async function pngToY4m(pngPath: string, outPath: string): Promise<void> {
  // A single frame — the fake capture device loops it for as long as a
  // test keeps the stream open.
  await ffmpeg([
    "-loop",
    "1",
    "-i",
    pngPath,
    "-frames:v",
    "1",
    "-pix_fmt",
    "yuv420p",
    outPath,
  ]);
}

test("generates the committed fake-camera .y4m fixtures under tests/e2e/fixtures/camera/", async ({
  page,
}) => {
  test.skip(
    process.env.GEN_CAMERA_FIXTURES !== "1",
    "Fixture generation is opt-in — set GEN_CAMERA_FIXTURES=1 to run it.",
  );

  await mkdir(OUT_DIR, { recursive: true });

  // Printed-sheet fixture (createMarkerBasedQuadSource's lock-on target;
  // still the shipped default flow).
  const fullPng = await buildCameraScenePng(page, {
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    homography: HOMOGRAPHY,
    paperSizeMm: A4_MM,
    markerIds: [0, 1, 2, 3],
  });

  // Paper-edge fixtures: blank paper, no markers — the real
  // detectPaperQuad's lock-on target. "full" has a genuine perspective and
  // a skin-tone hand occluder crossing the bottom edge; "partial" is
  // zoomed so the bottom two corners fall outside the frame (2-of-4
  // lock-on / "move back" cue).
  const paperEdgePng = await buildPaperScenePng(page, {
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    homography: PAPER_HOMOGRAPHY,
    paperSizeMm: A4_MM,
    includeHand: true,
  });
  const paperEdgePartialPng = await buildPaperScenePng(page, {
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
    homography: PARTIAL_HOMOGRAPHY,
    paperSizeMm: A4_MM,
    includeHand: false,
  });

  const fullPngPath = path.join(OUT_DIR, "_full.png");
  const paperEdgePngPath = path.join(OUT_DIR, "_paper-edge.png");
  const paperEdgePartialPngPath = path.join(OUT_DIR, "_paper-edge-partial.png");
  await writeFile(fullPngPath, fullPng);
  await writeFile(paperEdgePngPath, paperEdgePng);
  await writeFile(paperEdgePartialPngPath, paperEdgePartialPng);

  await pngToY4m(fullPngPath, path.join(OUT_DIR, "sheet-full.y4m"));
  await pngToY4m(paperEdgePngPath, path.join(OUT_DIR, "paper-edge-full.y4m"));
  await pngToY4m(
    paperEdgePartialPngPath,
    path.join(OUT_DIR, "paper-edge-partial.y4m"),
  );

  await rm(fullPngPath);
  await rm(paperEdgePngPath);
  await rm(paperEdgePartialPngPath);
});
