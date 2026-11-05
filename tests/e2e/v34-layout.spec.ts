import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { LOCALE_COOKIE } from "../../src/lib/contracts/locale";
import { zhTW as cardZh } from "../../src/lib/copy/card-reference";
import { zhTW as tourZh } from "../../src/lib/copy/scan-tour";
import { skipFirstRun } from "./fixtures/first-run";
import { chooseReference } from "./fixtures/reference";

/**
 * v3.4 card-mode chrome (candidate), card build, zh-TW, three phone sizes:
 * the controls laid over the live card screen must not overlap one another
 * (cue, card rule, tilt button, wrist label, chip, shutter, upload). Runs on
 * the card fake camera. With LAYOUT_SHOTS=<dir> it also saves the live card
 * screen and tour step 2 (paper on the paper camera, card on the card camera)
 * for the design check; images are written outside the repo.
 */
const CARD_ON = process.env.NEXT_PUBLIC_CARD_REFERENCE_ENABLED === "1";
const OUT = process.env.LAYOUT_SHOTS;
const SIZES = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

async function zh(page: Page) {
  await page.context().addCookies([
    {
      name: LOCALE_COOKIE,
      value: "zh-TW",
      url: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? 3100}`,
    },
  ]);
}

interface Box {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(name: string, loc: Locator): Promise<Box | null> {
  if ((await loc.count()) === 0) return null;
  const first = loc.first();
  if (!(await first.isVisible())) return null;
  const b = await first.boundingBox();
  return b && b.width > 0 && b.height > 0 ? { name, ...b } : null;
}

function overlaps(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0.5 && h > 0.5 ? Math.round(w * h) : 0;
}

for (const size of SIZES) {
  test(`card screen ${size.width}x${size.height} (zh-TW): cue, card rule, tilt button, wrist label, chip, shutter and upload do not overlap`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "chromium-camera-card", "Card camera.");
    test.skip(!CARD_ON, "Needs the card build.");
    await page.setViewportSize(size);
    await zh(page);
    await skipFirstRun(page);
    await page.goto("/scan/easy");
    await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible({
      timeout: 20_000,
    });
    await chooseReference(page, "Card");
    await expect(page.locator('[data-tour="card-slot"]')).toBeVisible({
      timeout: 15_000,
    });
    await page.waitForTimeout(1_000); // the cue and guide settle
    const boxes = (
      await Promise.all([
        boxOf("cue", page.locator('[data-tour="cue"]')),
        boxOf("card-rule", page.getByTestId("card-rule")),
        boxOf("tilt button", page.getByRole("button", { name: /水平/ })),
        boxOf(
          "wrist label",
          page.locator(".cardGuideLabel", { hasText: cardZh.wristLine }),
        ),
        boxOf(
          "slot label",
          page.locator(".cardGuideLabel", { hasText: /放這裡/ }),
        ),
        boxOf("chip", page.locator('[data-tour="reference-chip"]')),
        boxOf("shutter", page.locator('[data-tour="shutter"]')),
        boxOf("upload", page.locator(".easyUploadIconButton")),
      ])
    ).filter((b): b is Box => b !== null);
    if (OUT) {
      const dir = path.join(OUT, `${size.width}x${size.height}`);
      await mkdir(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, "card-live.png") });
    }
    console.log(
      `LAYOUT ${size.width}x${size.height} ${JSON.stringify(boxes.map((b) => [b.name, Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]))}`,
    );
    // Each named control is on screen (the tilt button only where the page
    // offers it).
    for (const name of [
      "cue",
      "card-rule",
      "wrist label",
      "slot label",
      "chip",
      "shutter",
      "upload",
    ])
      expect(
        boxes.map((b) => b.name),
        `${name} on screen`,
      ).toContain(name);
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const area = overlaps(boxes[i], boxes[j]);
        if (area) hits.push(`${boxes[i].name} x ${boxes[j].name}: ${area} px²`);
      }
    expect(hits).toEqual([]);
  });

  test(`tour step 2 screenshot ${size.width}x${size.height} (zh-TW)`, async ({
    page,
  }, info) => {
    test.skip(!OUT, "Opt-in: LAYOUT_SHOTS=<dir>.");
    test.skip(!CARD_ON, "Needs the card build.");
    const card = info.project.name === "chromium-camera-card";
    test.skip(
      !card && info.project.name !== "chromium-camera-paper-edge",
      "Fake cameras only.",
    );
    await page.setViewportSize(size);
    await zh(page);
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: tourZh.welcomeFirst }).click();
    const tourCard = page.getByTestId("scan-tour-card");
    if (card)
      await tourCard.getByRole("radio", { name: tourZh.referenceCard }).check();
    await page.getByRole("button", { name: tourZh.next, exact: true }).click();
    await expect(tourCard).toHaveAttribute("data-step", "placement");
    await page.waitForTimeout(800);
    const dir = path.join(OUT!, `${size.width}x${size.height}`);
    await mkdir(dir, { recursive: true });
    await page.screenshot({
      path: path.join(dir, card ? "tour-card-2.png" : "tour-paper-2.png"),
    });
    if (!card) {
      // The wrist line lies on the paper frame's bottom edge (±2 px): the
      // frame's bottom corners are the two lower corner dots.
      const edge = page.locator(".scanTourEdge");
      await expect(edge, "the wrist line is drawn").toBeVisible();
      const e = (await edge.boundingBox())!;
      const corners = await page.locator(".easyCorner").evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return r.top + r.height / 2;
        }),
      );
      expect(corners.length, "the four corner dots").toBe(4);
      const bottom =
        corners
          .sort((a, b) => b - a)
          .slice(0, 2)
          .reduce((a, b) => a + b) / 2;
      const lineY = e.y + e.height / 2;
      console.log(
        `WRIST ${size.width}x${size.height} line ${lineY.toFixed(1)} frame bottom ${bottom.toFixed(1)}`,
      );
      expect(Math.abs(lineY - bottom)).toBeLessThanOrEqual(2);
    }
  });
}
