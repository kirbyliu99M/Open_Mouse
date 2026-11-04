import { expect, test, type Page } from "@playwright/test";
import { en as cardEn } from "../../src/lib/copy/card-reference";
import { dismissFirstRun } from "./fixtures/first-run";

/**
 * v3.4 card reference (candidate 未拍板), card build only
 * (`NEXT_PUBLIC_CARD_REFERENCE_ENABLED=1`): choose the card, see its slot,
 * shoot, answer the outline question (yes / no), and send. Project
 * "chromium-camera-card": the fake camera shows card-beside-hand.y4m (a
 * light ID-1 card in the G-M2 slot, a skin-tone blob, no real hand).
 *
 * REAL detector: the card-mode live loop on that scene (MediaPipe, no hand:
 * the "no hand" cue, no auto-shot) and, on `/scan/easy`, the real card
 * analysis of a manual shot (turned back: no hand).
 * INJECTED: `/scan/easy/card-live-demo` passes `runCardPhotoImpl`, a fake card
 * analysis that answers "measured" with a fixed hand and a card outline on
 * the real shot, so the outline question, the sheet and the POST can run.
 * Everything else on that route (camera, chip, slot, shutter, the question,
 * the sheet, the send) is the real screen.
 */
const CARD_ON = process.env.NEXT_PUBLIC_CARD_REFERENCE_ENABLED === "1";
const CARD_DEMO = "/scan/easy/card-live-demo";

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(
    testInfo.project.name !== "chromium-camera-card",
    "Needs the card fake-camera project (card-beside-hand.y4m).",
  );
  test.skip(!CARD_ON, "Needs NEXT_PUBLIC_CARD_REFERENCE_ENABLED=1.");
});

const chip = (page: Page) => page.locator('[data-tour="reference-chip"]');
const cardSlot = (page: Page) => page.locator('[data-tour="card-slot"]');
const question = (page: Page) =>
  page.getByRole("dialog", { name: /Hand measured|Retake needed/ });
const cardCalls = (page: Page) =>
  page.evaluate(
    () =>
      (window as Window & { __easyScanCardCalls?: unknown[] })
        .__easyScanCardCalls?.length ?? 0,
  );

async function openCard(page: Page, url: string) {
  await page.goto(url);
  await dismissFirstRun(page);
  await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible();
  await expect(chip(page)).toHaveText("A4");
  await chip(page).click(); // Letter
  await chip(page).click(); // Card
  await expect(chip(page)).toHaveText(cardEn.chip);
  await expect(cardSlot(page)).toBeVisible({ timeout: 10_000 });
}

async function shoot(page: Page) {
  await page.getByRole("button", { name: "Take photo" }).click();
}

test("[real detector] choosing the card shows the slot beside the hand box, the card rule and the no-hand cue; nothing is taken by itself", async ({
  page,
}) => {
  await openCard(page, "/scan/easy");
  const slot = await cardSlot(page).boundingBox();
  const stage = await page.locator(".easyStage").boundingBox();
  expect(slot && stage).toBeTruthy();
  // G-M2 right hand: the slot is in the right part of the picture
  // (x 0.68-0.90 of the view, centred near y 0.42).
  const cx = (slot!.x + slot!.width / 2 - stage!.x) / stage!.width;
  const cy = (slot!.y + slot!.height / 2 - stage!.y) / stage!.height;
  expect(cx).toBeGreaterThan(0.68);
  expect(cx).toBeLessThan(0.9);
  expect(cy).toBeGreaterThan(0.3);
  expect(cy).toBeLessThan(0.55);
  await expect(page.getByTestId("easy-hint")).toHaveText(cardEn.cardRule);
  await expect(page.getByTestId("camera-cue")).toContainText(cardEn.hintNoHand);
  await page.waitForTimeout(6_000);
  await expect(page.locator("dialog.easyResultSheet[open]")).toHaveCount(0);
});

test("[real detector] a manual shot is analysed by the real card path: no hand -> retake sheet -> back to the card camera", async ({
  page,
}) => {
  await openCard(page, "/scan/easy");
  await shoot(page);
  const retake = page.getByRole("dialog", { name: "Retake needed" });
  await expect(retake).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("card-check-yes")).toHaveCount(0);
  await retake
    .getByRole("button", { name: /Retake|Try again/ })
    .first()
    .click();
  await expect(retake).toBeHidden();
  await expect(chip(page)).toHaveText(cardEn.chip);
  await expect(cardSlot(page)).toBeVisible({ timeout: 10_000 });
});

test("[injected] outline question NO: back to the card camera with nothing measured shown, and a new shot asks again", async ({
  page,
}) => {
  await openCard(page, CARD_DEMO);
  await shoot(page);
  const sheet = question(page);
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  await expect(sheet).toContainText(cardEn.confirmQuestion);
  // The outline question comes before any number.
  await expect(page.getByTestId("easy-sheet-numbers")).toHaveCount(0);
  await expect(page.getByTestId("card-check-yes")).toHaveText(
    cardEn.confirmYes,
  );
  await page.getByTestId("card-check-no").click();
  await expect(page.locator("dialog.easyResultSheet[open]")).toHaveCount(0, {
    timeout: 10_000,
  });
  // Retake: the live card camera again.
  await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible();
  await expect(chip(page)).toHaveText(cardEn.chip);
  await expect(cardSlot(page)).toBeVisible({ timeout: 10_000 });
  expect(await cardCalls(page)).toBe(1);
  await shoot(page);
  await expect(question(page)).toContainText(cardEn.confirmQuestion, {
    timeout: 30_000,
  });
  expect(await cardCalls(page)).toBe(2);
});

test("[injected] outline question YES: the measured sheet, the two questions, and the POST body has calibration.method card-edge (and no picture)", async ({
  page,
}) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/scans", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    bodies.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ scanId: "623e4567-e89b-12d3-a456-426614174012" }),
    });
  });
  await openCard(page, CARD_DEMO);
  await shoot(page);
  await expect(question(page)).toContainText(cardEn.confirmQuestion, {
    timeout: 30_000,
  });
  await page.getByTestId("card-check-yes").click();
  const sheet = page.getByRole("dialog", { name: "Hand measured" });
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toContainText(cardEn.confirmQuestion);
  await expect(page.getByTestId("easy-sheet-numbers")).toBeVisible();
  await expect(page.getByTestId("easy-sheet-numbers")).toContainText("19");
  await sheet.getByRole("button", { name: "Continue" }).click();
  await page
    .getByRole("dialog", { name: "How you hold a mouse" })
    .getByRole("button", { name: "Skip" })
    .click();
  await page
    .getByRole("dialog", { name: "Palm thickness" })
    .getByRole("button", { name: "Skip and see results" })
    .click();
  await expect.poll(() => bodies.length).toBe(1);
  const body = bodies[0];
  const calibration = body.calibration as Record<string, unknown>;
  expect(calibration.method).toBe("card-edge");
  expect(calibration.cardSizeMm).toEqual({ longMm: 85.6, shortMm: 53.98 });
  expect(calibration.searchPass).toBe("slot");
  expect(calibration.parallaxCorrected).toBe(true);
  expect(calibration).not.toHaveProperty("paperSize");
  expect((body.measurements as Record<string, number>).handLengthMm).toBe(190);
  expect(body.hand).toBe("right");
  // Rule 5: numbers only, no picture in the body.
  expect(JSON.stringify(body)).not.toMatch(/data:image|base64/);
  expect(JSON.stringify(body).length).toBeLessThan(4_000);
});

test("[injected] switching away from the card after a NO starts the paper loop clean: no slot, no card question", async ({
  page,
}) => {
  await openCard(page, CARD_DEMO);
  await shoot(page);
  await expect(question(page)).toContainText(cardEn.confirmQuestion, {
    timeout: 30_000,
  });
  await page.getByTestId("card-check-no").click();
  await expect(page.locator("dialog.easyResultSheet[open]")).toHaveCount(0, {
    timeout: 10_000,
  });
  await chip(page).click(); // Card -> A4
  await expect(chip(page)).toHaveText("A4");
  await expect(cardSlot(page)).toHaveCount(0);
  await expect(page.getByTestId("easy-hint")).not.toHaveText(cardEn.cardRule);
  await expect(page.getByTestId("camera-cue")).not.toContainText(
    cardEn.hintNoHand,
  );
  await expect(page.getByTestId("easy-corners")).toBeVisible();
});
