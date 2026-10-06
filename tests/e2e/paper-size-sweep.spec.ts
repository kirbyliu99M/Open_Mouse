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
 * to the size of the sheet in the photo (docs/design/scan-v2-2026-09-30/
 * README.md, "Preview shape and attempt log"). Run by hand:
 *
 *   PAPER_SWEEP=1 npx playwright test tests/e2e/paper-size-sweep.spec.ts --project=mobile
 *
 * Each step draws a 3000x4000 portrait photo (the shape and size of the
 * S25's takePhoto() output) with the sheet at a given fraction of the "fills
 * the frame" size, uploads it through the real `#easy-scan-upload` on the
 * real `/scan/easy` and reads the attempt record the app kept
 * (attemptLog.ts). Nothing is mocked: the numbers are the shipped pipeline's.
 *
 * "100 %" is a sheet 92 % as tall as the photo (86.7 % as wide, A4 in a 3:4
 * frame); 50 % is half that size in both directions.
 *
 * The synthetic scene's "hand" is a blob that MediaPipe does not take for a
 * hand, so a synthetic photo can never come back "ok": what the sweep reads is
 * the PAPER gates (`paper.gateFailures`, the part of the pipeline the sheet's
 * size acts on), next to the error the result reported. `PAPER_SWEEP_PHOTO`
 * (a path to a real hand photo on a sheet, never committed) adds a second
 * sweep that shrinks that photo inside a plain desk-coloured frame, the
 * experiment Kirby ran by hand on the live site, with a real hand.
 * `PAPER_SWEEP_OUT` writes the rows as JSON.
 */
const STEPS = Array.from({ length: 11 }, (_, i) => 1 - i * 0.05);
const WIDTH = 3000;
const HEIGHT = 4000;
const A4_MM = { width: 210, height: 297 };
/** The sheet's height at "100 %", as a share of the photo's height. */
const FULL_HEIGHT_SHARE = 0.92;

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
  const before = (await readAttempts(page)).length;
  await page.locator("#easy-scan-upload").setInputFiles({
    name: `sweep-${Math.round(scale * 100)}.${mimeType === "image/png" ? "png" : "jpg"}`,
    mimeType,
    buffer: png,
  });
  await expect
    .poll(async () => (await readAttempts(page)).length, { timeout: 120_000 })
    .toBe(before + 1);
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

/** The synthetic scene at `scale`, drawn centred in a 3000x4000 photo. */
async function syntheticScene(page: Page, scale: number): Promise<Buffer> {
  const pxPerMm = ((HEIGHT * FULL_HEIGHT_SHARE) / A4_MM.height) * scale;
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

/** A real photo shrunk to `scale` inside a plain desk-coloured 3000x4000 frame, as a JPEG. */
async function realScene(
  page: Page,
  photo: Buffer,
  scale: number,
): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ b64, width, height, scale }) => {
      const blob = await (await fetch(`data:image/jpeg;base64,${b64}`)).blob();
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
      // 100 % is the photo at the frame's height.
      const fit = height / bitmap.height;
      const w = bitmap.width * fit * scale;
      const h = bitmap.height * fit * scale;
      ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
      return canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
    },
    { b64: photo.toString("base64"), width: WIDTH, height: HEIGHT, scale },
  );
  return Buffer.from(base64, "base64");
}

const fmt = (v: number | null, digits: number) =>
  v === null ? "-" : v.toFixed(digits);

function table(rows: readonly Row[]): string {
  const head =
    "| sheet scale | width % | height % | residual mm | coverage | corners | paper gates failed | reported errors | result |";
  const rule = "|---|---|---|---|---|---|---|---|---|";
  const lines = rows.map(
    (r) =>
      `| ${Math.round(r.scale * 100)} % | ${fmt(r.widthPct, 1)} | ${fmt(r.heightPct, 1)} | ${fmt(r.residualMm, 3)} | ${fmt(r.coverage, 2)} | ${r.cornersSeen ?? "-"} | ${r.paperGateFailures} | ${r.reportedErrors} | ${r.result} |`,
  );
  return [head, rule, ...lines].join("\n");
}

test("sheet size sweep: paper gates against the sheet's share of a 3000x4000 photo", async ({
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
    `SWEEP synthetic (paper-scene.ts, 3000x4000, PNG)\n${table(rows)}`,
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
      `SWEEP real hand photo, shrunk in a desk-coloured frame\n${table(real)}`,
    );
    rows.push(...real);
  }

  const out = process.env.PAPER_SWEEP_OUT;
  if (out) await writeFile(path.resolve(out), JSON.stringify(rows, null, 2));
  expect(rows.length).toBeGreaterThan(0);
});
