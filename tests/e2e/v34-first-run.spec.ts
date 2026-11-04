import { expect, test, type Page } from "@playwright/test";
import { en as cardEn } from "../../src/lib/copy/card-reference";
import { en as tour } from "../../src/lib/copy/scan-tour";

/**
 * v3.4 (candidate): the FIRST visit, on a fresh profile — nothing seeded in
 * storage, no helper that closes the first-run screen. Each Playwright test
 * gets a new browser context, so this is what a first-time phone user sees.
 *
 *  - the camera picture appears (a playing <video> with real, non-black
 *    pixels from the fake camera),
 *  - the tour's question opens OVER that picture,
 *  - closing it starts the live loop: on paper the auto-shutter takes the
 *    photo by itself; on the card the live card hint runs (the fake scene has
 *    no hand, so the card ring cannot fill; the shot is taken by hand and the
 *    injected card analysis answers).
 *
 * Paper runs in both builds (flag off and on), the card in the card build.
 * REAL: camera, tour, paper detector, auto-shutter, card live loop.
 * INJECTED: the measured results (`live-measured-demo`, `card-live-demo`).
 */
const CARD_ON = process.env.NEXT_PUBLIC_CARD_REFERENCE_ENABLED === "1";

/** The live <video> is playing and shows a picture (not a black frame). */
async function expectLivePicture(page: Page) {
  const video = page.locator(".easyStage video.cameraVideo");
  await expect(video).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      () =>
        video.evaluate((v: HTMLVideoElement) => {
          if (!v.srcObject || v.readyState < 2 || v.videoWidth === 0) return -1;
          const c = document.createElement("canvas");
          c.width = 64;
          c.height = 64;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(v, 0, 0, 64, 64);
          const d = ctx.getImageData(0, 0, 64, 64).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4)
            sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
          return sum / (d.length / 4);
        }),
      { timeout: 20_000, message: "a playing camera picture, not black" },
    )
    .toBeGreaterThan(20);
  // The element itself is shown (faded in), not transparent.
  await expect
    .poll(() => video.evaluate((v) => Number(getComputedStyle(v).opacity)))
    .toBeGreaterThan(0.9);
}

async function expectStorageEmpty(page: Page) {
  expect(
    await page.evaluate(() =>
      Object.keys(window.localStorage).filter((k) =>
        k.startsWith("openMouse.easyScan."),
      ),
    ),
  ).toEqual([]);
}

test("paper, first visit: picture, then the tour over it, then 'not my first time' starts the auto-shutter", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-camera-paper-edge",
    "Needs the paper fake camera.",
  );
  await page.goto("/scan/easy/live-measured-demo");
  await expectStorageEmpty(page);
  const welcome = page.getByRole("dialog", { name: tour.welcomeTitle });
  await expect(welcome).toBeVisible({ timeout: 20_000 });
  await expectLivePicture(page);
  await welcome.getByRole("button", { name: tour.welcomeReturning }).click();
  await expect(welcome).toBeHidden();
  // The auto-shutter fires on the sheet by itself (no tap anywhere).
  await expect(page.getByTestId("paper-adjust")).toBeVisible({
    timeout: 30_000,
  });
});

test("paper, first visit, the long way: 'first time, show me', walk to the end, Start scanning starts the auto-shutter", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-camera-paper-edge",
    "Needs the paper fake camera.",
  );
  await page.goto("/scan/easy/live-measured-demo");
  await page.getByRole("button", { name: tour.welcomeFirst }).click();
  await expectLivePicture(page);
  const card = page.getByTestId("scan-tour-card");
  for (let i = 0; i < 6; i++) {
    await expect(card).toBeVisible();
    const start = page.getByRole("button", { name: tour.start, exact: true });
    if (await start.count()) {
      await start.click();
      break;
    }
    await page.getByRole("button", { name: tour.next, exact: true }).click();
  }
  await expect(page.getByTestId("scan-tour")).toHaveCount(0);
  await expect(page.getByTestId("paper-adjust")).toBeVisible({
    timeout: 30_000,
  });
});

test("card, first visit: picture, tour over it, Card chosen in the tour, then the live card loop runs and a shot reaches the outline question", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-camera-card",
    "Needs the card fake camera.",
  );
  test.skip(!CARD_ON, "Needs NEXT_PUBLIC_CARD_REFERENCE_ENABLED=1.");
  await page.goto("/scan/easy/card-live-demo");
  await expectStorageEmpty(page);
  await page.getByRole("button", { name: tour.welcomeFirst }).click();
  await expectLivePicture(page);
  await page
    .getByTestId("scan-tour-card")
    .getByRole("radio", { name: tour.referenceCard })
    .check();
  await expect(page.locator('[data-tour="reference-chip"]')).toHaveText(
    cardEn.chip,
  );
  await page.getByRole("button", { name: tour.skip }).click();
  await expect(page.getByTestId("scan-tour")).toHaveCount(0);
  await expectLivePicture(page);
  // The live loop runs in card mode: its own cue (no hand in the scene).
  await expect(page.getByTestId("camera-cue")).toContainText(
    cardEn.hintNoHand,
    { timeout: 20_000 },
  );
  await expect(page.locator('[data-tour="card-slot"]')).toBeVisible();
  await page.getByRole("button", { name: "Take photo" }).click();
  await expect(page.locator("dialog.easyResultSheet[open]")).toContainText(
    cardEn.confirmQuestion,
    { timeout: 30_000 },
  );
});
