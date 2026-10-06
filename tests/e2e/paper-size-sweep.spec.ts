import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  ATTEMPT_LOG_KEY,
  type AttemptRecord,
} from "../../src/client/camera/attemptLog";
import { buildPaperScenePng } from "./fixtures/paper-scene";

/**
 * Measurement, not a test of the suite: how the pipeline's paper gates react
 * to the size of the sheet in what the person SAW (docs/design/
 * scan-v2-2026-09-30/README.md, "What you see is what is analysed"). Run by
 * hand:
 *
 *   PAPER_SWEEP=1 npx playwright test tests/e2e/paper-size-sweep.spec.ts --project=mobile
 *
 * The easy scan analyses the part of the photo that was on screen
 * (visibleView.ts). On a 390x844 screen that is a region with the screen's
 * shape, 0.462 wide for every 1 tall: 1386x3000 of the S25's decoded
 * 2250x3000 photo. Each step draws exactly that region at full resolution
 * (1848x4000 before the decoder scales it down), with the sheet at a given
 * fraction of ITS WIDTH, uploads it through the real `#easy-scan-upload` on the
 * real `/scan/easy` and reads the attempt record the app kept (attemptLog.ts).
 * Nothing is mocked: the numbers are the shipped pipeline's, and they are the
 * numbers it gets after the crop, which is what an upload of the region is.
 *
 * "85 %" is where the guide rectangle puts the sheet (GUIDE_INSETS: 0.85 of
 * the screen's width); the live cue says "Move closer" below 55 % and "Move
 * back" above 95 % (CAMERA_CONSTANTS.size).
 *
 * The synthetic scene's "hand" is a blob that MediaPipe does not take for a
 * hand, so a synthetic photo can never come back "ok": what the sweep reads is
 * the PAPER gates (`paper.gateFailures`, the part of the pipeline the sheet's
 * size acts on), next to the error the result reported. `PAPER_SWEEP_PHOTO`
 * (a path to a real hand photo on a sheet, never committed) adds a second
 * sweep that shrinks that photo inside a plain desk-coloured frame of the same
 * region, the experiment Kirby ran by hand on the live site, with a real hand.
 * `PAPER_SWEEP_OUT` writes the rows as JSON.
 */
/** The sheet's share of the region's width, from 100 % down to 50 %. */
const STEPS = Array.from({ length: 11 }, (_, i) => 1 - i * 0.05);
/** The region the person saw, in the photo's own pixels: the screen's shape at the photo's full height. */
const HEIGHT = 4000;
const WIDTH = Math.round((HEIGHT * 390) / 844);
const A4_MM = { width: 210, height: 297 };
/** In the real photo the sheet is about as wide as the photo (measured: 100 % of its 2252 px at the first run). */
const REAL_PHOTO_PAPER_SHARE = 1;

interface Row {
  readonly scene: string;
  readonly scale: number;
  readonly widthPct: number | null;
  readonly heightPct: number | null;
  readonly residualMm: number | null;
  readonly coverage: number | null;
  readonly cornersSeen: number | null;
  readonly paperGateFailures: string;
  readonly reportedErrors: string;
  readonly result: string;
  readonly handDetected: boolean | null;
  readonly totalMs: number | null;
}

async function readAttempts(page: Page): Promise<AttemptRecord[]> {
  return page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? "[]"),
    ATTEMPT_LOG_KEY,
  );
}

async function runStep(
  page: Page,
  scene: string,
  scale: number,
  png: Buffer,
  mimeType: string,
): Promise<Row> {
  await page.goto("/scan/easy?debug=1");
  const gotIt = page.getByRole("button", { name: "Got it" });
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  // The log keeps 20, so each step starts from an empty one.
  await page.evaluate(
    (key) => window.localStorage.removeItem(key),
    ATTEMPT_LOG_KEY,
  );
  await page.locator("#easy-scan-upload").setInputFiles({
    name: `sweep-${Math.round(scale * 100)}.${mimeType === "image/png" ? "png" : "jpg"}`,
    mimeType,
    buffer: png,
  });
  await expect
    .poll(async () => (await readAttempts(page)).length, { timeout: 120_000 })
    .toBe(1);
  const attempts = await readAttempts(page);
  const a = attempts[attempts.length - 1];
  return {
    scene,
    scale,
    widthPct:
      a.paper?.widthFraction == null ? null : a.paper.widthFraction * 100,
    heightPct:
      a.paper?.heightFraction == null ? null : a.paper.heightFraction * 100,
    residualMm: a.paper?.edgeFitResidualMm ?? null,
    coverage: a.paper?.minSideCoverage ?? null,
    cornersSeen: a.paper?.cornersSeen ?? null,
    paperGateFailures:
      a.paper?.gateFailures.join("+") || (a.paper ? "-" : "n/a"),
    reportedErrors: a.errors.map((e) => e.code).join("+") || "-",
    result: a.result,
    handDetected: a.hand.detected,
    totalMs: a.timingMs.total,
  };
}

/** The synthetic scene: the sheet `scale` as wide as the region, centred. */
async function syntheticScene(page: Page, scale: number): Promise<Buffer> {
  const pxPerMm = (WIDTH * scale) / A4_MM.width;
  const tx = (WIDTH - A4_MM.width * pxPerMm) / 2;
  const ty = (HEIGHT - A4_MM.height * pxPerMm) / 2;
  return buildPaperScenePng(page, {
    canvasWidth: WIDTH,
    canvasHeight: HEIGHT,
    homography: [
      [pxPerMm, 0, tx],
      [0, pxPerMm, ty],
      [0, 0, 1],
    ],
    paperSizeMm: A4_MM,
    includeHand: true,
  });
}

/** A real photo shrunk so that its sheet is `scale` as wide as the region, inside a plain desk-coloured frame of that shape, as a JPEG. */
async function realScene(
  page: Page,
  photo: Buffer,
  scale: number,
): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ b64, width, height, scale, paperShare }) => {
      // Not fetch(data:...): the page's connect-src does not allow it.
      const blob = new Blob(
        [Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))],
        {
          type: "image/jpeg",
        },
      );
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: "from-image",
      });
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      // The desk colour of the photo, sampled in its bottom-left corner.
      const probe = document.createElement("canvas");
      probe.width = probe.height = 1;
      const pctx = probe.getContext("2d")!;
      pctx.drawImage(bitmap, 0, bitmap.height - 40, 30, 30, 0, 0, 1, 1);
      const [r, g, b] = pctx.getImageData(0, 0, 1, 1).data;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, width, height);
      // The sheet is about `paperShare` of the photo's width: draw the photo
      // so that the sheet is `scale` of the frame's width.
      const fit = (width * scale) / (bitmap.width * paperShare);
      const w = bitmap.width * fit;
      const h = bitmap.height * fit;
      ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
      return canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
    },
    {
      b64: photo.toString("base64"),
      width: WIDTH,
      height: HEIGHT,
      scale,
      paperShare: REAL_PHOTO_PAPER_SHARE,
    },
  );
  return Buffer.from(base64, "base64");
}

const fmt = (v: number | null, digits: number) =>
  v === null ? "-" : v.toFixed(digits);

function table(rows: readonly Row[]): string {
  const head =
    "| sheet, share of the screen's width | width % | height % | residual mm | coverage | corners | paper gates failed | reported errors | result |";
  const rule = "|---|---|---|---|---|---|---|---|---|";
  const lines = rows.map(
    (r) =>
      `| ${Math.round(r.scale * 100)} % | ${fmt(r.widthPct, 1)} | ${fmt(r.heightPct, 1)} | ${fmt(r.residualMm, 3)} | ${fmt(r.coverage, 2)} | ${r.cornersSeen ?? "-"} | ${r.paperGateFailures} | ${r.reportedErrors} | ${r.result} |`,
  );
  return [head, rule, ...lines].join("\n");
}

test("sheet size sweep: paper gates against the sheet's share of what the person saw", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.PAPER_SWEEP !== "1",
    "A measurement, run by hand: set PAPER_SWEEP=1.",
  );
  test.skip(testInfo.project.name !== "mobile", "Uses the upload path.");
  test.setTimeout(30 * 60_000);

  const rows: Row[] = [];
  for (const scale of STEPS) {
    const png = await syntheticScene(page, scale);
    rows.push(await runStep(page, "synthetic", scale, png, "image/png"));
  }
  console.log(
    `SWEEP synthetic (paper-scene.ts, the on-screen region ${WIDTH}x${HEIGHT}, PNG)\n${table(rows)}`,
  );

  const realPath = process.env.PAPER_SWEEP_PHOTO;
  if (realPath) {
    const photo = await readFile(realPath);
    const real: Row[] = [];
    for (const scale of STEPS) {
      const jpeg = await realScene(page, photo, scale);
      real.push(await runStep(page, "real hand", scale, jpeg, "image/jpeg"));
    }
    console.log(
      `SWEEP real hand photo, shrunk in a desk-coloured frame of the on-screen region\n${table(real)}`,
    );
    rows.push(...real);
  }

  const out = process.env.PAPER_SWEEP_OUT;
  if (out) await writeFile(path.resolve(out), JSON.stringify(rows, null, 2));
  expect(rows.length).toBeGreaterThan(0);
});
