import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { appendFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { chromium, devices, expect, test, type Page } from "@playwright/test";
import { chooseReference } from "./fixtures/reference";

/**
 * v3.4 LOCAL measurement, never CI (skips unless V34_REAL=1): the whole easy
 * scan on Kirby's own photos as the fake camera, card build on, real
 * detectors end to end (paper detector or card mode's live loop, the
 * auto-shutter, MediaPipe on the shot, the card or paper analysis, the
 * outline/frame confirm, the questions, the POST body).
 *
 * The photos and the y4m made from them stay in V34_REAL_TMP, outside the
 * repo; nothing about them is committed. Needs ffmpeg on PATH and
 *
 *   NEXT_PUBLIC_CARD_REFERENCE_ENABLED=1 V34_REAL=1 \
 *   V34_REAL_LIST=<json: [{id, file, mode: "a4"|"card", stream: "full"|"lab"}]> \
 *   V34_REAL_OUT=<results .jsonl> V34_REAL_TMP=<scratch dir> \
 *     npx playwright test tests/e2e/v34-real-photos.spec.ts --project=chromium --workers=1
 *
 * stream "full": the file IS the 1080x1920 stream (the S25 photo, EXIF-turned
 * and scaled, the same pixels the offline v34-acc run used); the fake screen
 * shows all of it (360x640). stream "lab": a 1080x1768 lab shot, i.e. the
 * visible part of a 1080x1920 stream from y 76; it is padded back to the
 * stream and the fake screen (360x589) shows the shot again.
 */
const run = promisify(execFile);

interface Item {
  readonly id: string;
  readonly file: string;
  readonly mode: "a4" | "card";
  readonly stream: "full" | "lab";
}

async function toY4m(item: Item, out: string) {
  const vf =
    item.stream === "lab"
      ? "scale=1080:1768,pad=1080:1920:0:76:black"
      : "scale=1080:1920";
  await run("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    item.file,
    "-vf",
    `${vf},format=yuv420p`,
    "-frames:v",
    "1",
    out,
  ]);
}

async function finishQuestions(page: Page) {
  const sheet = page.getByRole("dialog", { name: "Hand measured" });
  await sheet.getByRole("button", { name: "Continue" }).click();
  await page
    .getByRole("dialog", { name: "How you hold a mouse" })
    .getByRole("button", { name: "Skip" })
    .click();
  await page
    .getByRole("dialog", { name: "Palm thickness" })
    .getByRole("button", { name: "Skip and see results" })
    .click();
}

const ITEMS: Item[] =
  process.env.V34_REAL === "1" && process.env.V34_REAL_LIST
    ? (JSON.parse(readFileSync(process.env.V34_REAL_LIST, "utf8")) as Item[])
    : [];

test("v3.4 real photos: set V34_REAL=1 and V34_REAL_LIST to run", () => {
  test.skip(true, "Local measurement only.");
});

/** One test per photo, so a hang on one photo is that photo's error only. */
for (const item of ITEMS) {
  test(`v3.4 real photo ${item.id} (${item.mode}, local only)`, async ({
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Opens its own browser.");
    test.setTimeout(300_000);
    const outFile = process.env.V34_REAL_OUT!;
    const tmp = process.env.V34_REAL_TMP!;
    await mkdir(tmp, { recursive: true });
    const y4m = path.join(tmp, `${item.id}.y4m`);
    await toY4m(item, y4m);
    const row: Record<string, unknown> = {
      id: item.id,
      mode: item.mode,
      file: path.basename(item.file),
    };
    const browser = await chromium.launch({
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-video-capture=${y4m}`,
      ],
    });
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        new Promise((_, reject) => {
          watchdog = setTimeout(
            () => reject(new Error("watchdog: no end within 200 s")),
            200_000,
          );
        }),
        (async () => {
          const context = await browser.newContext({
            ...devices["Pixel 7"],
            viewport:
              item.stream === "lab"
                ? { width: 360, height: 589 }
                : { width: 360, height: 640 },
            permissions: ["camera"],
            baseURL,
            locale: "en-US",
          });
          await context.addInitScript(() => {
            window.localStorage.setItem(
              "openMouse.easyScan.firstRunTipSeen",
              "1",
            );
          });
          if (item.mode === "card") {
            // Choose the card on the screen with the live loop held (no frame
            // callback runs, so the photo cannot be taken in A4 first); the page
            // keeps the choice for the next load, however it stores it.
            const setup = await context.newPage();
            await setup.addInitScript(() => {
              window.requestAnimationFrame = () => 0;
            });
            await setup.goto("/scan/easy");
            await chooseReference(setup, "Card");
            await setup.close();
          }
          const page = await context.newPage();
          const bodies: Record<string, unknown>[] = [];
          await page.route("**/api/scans", async (route) => {
            if (route.request().method() !== "POST") return route.fallback();
            bodies.push(JSON.parse(route.request().postData() ?? "{}"));
            await route.fulfill({
              status: 201,
              contentType: "application/json",
              body: JSON.stringify({
                scanId: "623e4567-e89b-12d3-a456-426614174099",
              }),
            });
          });
          await page.goto("/scan/easy?debug=1&hints=0");
          // The debug panel (kept for its numbers) lies over the dock on a
          // 360 px screen: taps go through it to the shutter.
          await page.addStyleTag({
            content: "[data-testid=scan-debug-panel] { pointer-events: none; }",
          });
          await expect(page.locator('[data-tour="reference-chip"]')).toHaveText(
            item.mode === "card" ? "Card" : "A4",
            { timeout: 30_000 },
          );
          await expect(page.locator("video.cameraVideo.ready")).toBeVisible({
            timeout: 30_000,
          });
          const t0 = Date.now();
          const adjust = page.getByTestId("paper-adjust");
          const anySheet = page.locator("dialog.easyResultSheet[open]");
          const shot = adjust.or(anySheet).first();
          let auto = true;
          try {
            await expect(shot).toBeVisible({ timeout: 30_000 });
          } catch {
            auto = false;
            row.cueAtTimeout = await page
              .getByTestId("camera-cue")
              .innerText()
              .catch(() => null);
            await page.getByRole("button", { name: "Take photo" }).click();
            await expect(shot).toBeVisible({ timeout: 90_000 });
          }
          row.autoShot = auto;
          row.secondsToShot = Math.round((Date.now() - t0) / 100) / 10;
          if (await adjust.isVisible()) {
            row.adjustEntry = await adjust.getAttribute("data-entry");
            await page.screenshot({
              path: path.join(tmp, `${item.id}-adjust.png`),
            });
            // "review": measured, confirm as it opened. Otherwise the paper
            // was not taken by itself (a rescue, F14): the person's path is
            // to check the frame and measure with it, which is what is done
            // here (recorded, so these rows are told apart).
            row.frameConfirm = row.adjustEntry === "review";
            await page.getByTestId("paper-adjust-confirm").click();
          }
          await expect(anySheet).toBeVisible({ timeout: 60_000 });
          if (await page.getByTestId("card-check-yes").isVisible()) {
            row.outlineQuestion = true;
            await page.screenshot({
              path: path.join(tmp, `${item.id}-outline.png`),
            });
            await page.getByTestId("card-check-yes").click();
          }
          const measured = page.getByRole("dialog", { name: "Hand measured" });
          if (await measured.isVisible().catch(() => false)) {
            row.sheet = "measured";
            row.sheetNumbers = await page
              .getByTestId("easy-sheet-numbers")
              .innerText()
              .catch(() => null);
            const shown = /Hand length\s+(\d+(?:\.\d+)?)\s*mm/.exec(
              String(row.sheetNumbers ?? ""),
            );
            row.shownHandLengthMm = shown ? Number(shown[1]) : null;
            await finishQuestions(page);
            await expect.poll(() => bodies.length, { timeout: 30_000 }).toBe(1);
            const body = bodies[0] as {
              measurements: Record<string, number>;
              calibration: Record<string, unknown>;
              hand: string;
            };
            row.hand = body.hand;
            row.handLengthMm = body.measurements.handLengthMm;
            row.palmWidthMm = body.measurements.palmWidthMm;
            row.method = body.calibration.method;
            row.calibration = body.calibration;
            row.bodyHasImage = /data:image|base64/.test(JSON.stringify(body));
          } else {
            row.sheet = "retake";
            row.retakeText = (await anySheet.innerText()).slice(0, 300);
            await page.screenshot({
              path: path.join(tmp, `${item.id}-retake.png`),
            });
          }
        })(),
      ]);
    } catch (error) {
      row.error = String(error)
        .replace(new RegExp(String.fromCharCode(27) + "\[[0-9;]*m", "g"), "")
        .slice(0, 400);
    } finally {
      clearTimeout(watchdog);
      await browser.close().catch(() => undefined);
      await rm(y4m, { force: true });
    }
    console.log(`V34 REAL ${JSON.stringify(row)}`);
    await appendFile(outFile, JSON.stringify(row) + "\n");
  });
}
