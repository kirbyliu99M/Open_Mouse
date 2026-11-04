import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { en as tour } from "../../src/lib/copy/scan-tour";

/**
 * v3.4 tour screenshots for the design check (opt-in, never CI:
 * TOUR_SHOTS=<output dir>). 390 x 844, each screen of the tour: the paper
 * tour on the paper fake camera, the card tour on the card fake camera
 * (card build). Images are written outside the repo.
 */
const OUT = process.env.TOUR_SHOTS;
const CARD_ON = process.env.NEXT_PUBLIC_CARD_REFERENCE_ENABLED === "1";

test("tour screens, one image each", async ({ page }, testInfo) => {
  test.skip(!OUT, "Opt-in: TOUR_SHOTS=<dir>.");
  const paper = testInfo.project.name === "chromium-camera-paper-edge";
  const cardProject = testInfo.project.name === "chromium-camera-card";
  test.skip(!paper && !cardProject, "Fake-camera projects only.");
  test.skip(cardProject && !CARD_ON, "The card tour needs the card build.");
  const kind = cardProject ? "card" : CARD_ON ? "paper-cardbuild" : "paper";
  const dir = path.join(OUT!, kind);
  await mkdir(dir, { recursive: true });
  await page.goto("/scan/easy");
  const welcome = page.getByRole("dialog", { name: tour.welcomeTitle });
  await expect(welcome).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(dir, "0-welcome.png") });
  await page.getByRole("button", { name: tour.welcomeFirst }).click();
  const card = page.getByTestId("scan-tour-card");
  if (cardProject)
    await card.getByRole("radio", { name: tour.referenceCard }).check();
  for (let i = 1; i <= 6; i++) {
    await expect(card).toBeVisible();
    await page.waitForTimeout(800); // spotlight and card settle
    const id = (await card.getAttribute("data-step")) ?? "step";
    await page.screenshot({ path: path.join(dir, `${i}-${id}.png`) });
    const start = page.getByRole("button", { name: tour.start, exact: true });
    if (await start.count()) break;
    await page.getByRole("button", { name: tour.next, exact: true }).click();
  }
});
