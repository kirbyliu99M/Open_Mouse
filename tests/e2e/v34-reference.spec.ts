import { expect, test, type Page } from "@playwright/test";
import { en as cardEn } from "../../src/lib/copy/card-reference";
import { confirmAutoFrame } from "./fixtures/confirm-frame";
import { dismissFirstRun } from "./fixtures/first-run";
import {
  chooseReference,
  openReferenceChip,
  referenceChip,
  referenceMenu,
} from "./fixtures/reference";

/**
 * v3.4 (candidate 未拍板): the reference chip on the easy scan — A4 / Letter,
 * plus the card behind `NEXT_PUBLIC_CARD_REFERENCE_ENABLED`. A4 and the card
 * live side by side ("make no mistake on the build", Kirby 2026-11-05), so
 * this spec pins both builds:
 *
 *  - flag OFF (the default build, = production today): the chip is the old
 *    A4 <-> Letter toggle, nothing of the card exists, a stored "card"
 *    preference reads as A4.
 *  - flag ON: the chip steps A4 -> Letter -> Card -> A4; every switch into or
 *    out of the card resets the overlay, the hint and the auto-shutter; the
 *    choice survives a reload; and A4 still goes all the way to a sent scan.
 *
 * The flag is build-time, so one server is one build: run the suite twice,
 *   npx playwright test tests/e2e/v34-*.spec.ts                       (flag off)
 *   NEXT_PUBLIC_CARD_REFERENCE_ENABLED=1 npx playwright test tests/e2e/v34-*.spec.ts
 * (playwright.config.ts passes the variable to the dev server). Each test
 * skips itself in the build it does not belong to.
 *
 * Fake camera: paper-edge-full.y4m (a blank A4 sheet, a skin-tone blob, no
 * real hand). What runs for REAL here: the paper detector (corners found),
 * the auto-shutter on the paper path, the card-mode live loop (MediaPipe sees
 * no hand, so the card ring never fills) and, after a manual shot in card
 * mode, the real card analysis (it turns the photo back: no hand). What is
 * INJECTED: the paper path's measured result (`/scan/easy/live-measured-demo`,
 * a fixed hand), so the A4 flow can reach the sheet and the send.
 */
const CARD_ON = process.env.NEXT_PUBLIC_CARD_REFERENCE_ENABLED === "1";
const LIVE_DEMO = "/scan/easy/live-measured-demo";
const PAPER_SIZE_KEY = "openMouse.easyScan.paperSize";

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(
    testInfo.project.name !== "chromium-camera-paper-edge",
    "Needs the fake-camera project (paper-edge-full.y4m).",
  );
});

const chip = referenceChip;
const cardSlot = (page: Page) => page.locator('[data-tour="card-slot"]');
const cue = (page: Page) => page.getByTestId("camera-cue");
const corners = (page: Page) => page.getByTestId("easy-corners");
const foundCorners = (page: Page) =>
  page.locator(".easyCorner[data-found=true]");
const anySheet = (page: Page) => page.locator("dialog.easyResultSheet[open]");

async function presetReference(page: Page, value: string) {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // A refused store: the page falls back by itself.
      }
    },
    { key: PAPER_SIZE_KEY, value },
  );
}

async function openCamera(page: Page, url: string) {
  await page.goto(url);
  // ?debug=1 is used only to keep the ring waiting for a hand (no auto-shot
  // on the fake scene); its panel is not the product and lies over the dock
  // on a 390 px screen, so taps go through it to the real controls.
  if (url.includes("debug=1"))
    await page.addStyleTag({
      content: "[data-testid=scan-debug-panel] { pointer-events: none; }",
    });
  await dismissFirstRun(page);
  await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible();
}

/**
 * Opens `url` in card mode: the card is chosen on the screen (with the ring
 * held, ?debug=1) and the page itself keeps the choice for the next load, so
 * this does not depend on how it is stored.
 */
async function startInCard(page: Page, url: string) {
  await openCamera(page, "/scan/easy?debug=1");
  await chooseReference(page, "Card");
  await page.goto(url);
  await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible();
  await expect(chip(page)).toHaveText(cardEn.chip);
}

/** The paper-path calls the injected demo pipeline received. */
const paperCalls = (page: Page) =>
  page.evaluate(
    () =>
      (window as Window & { __easyScanLiveCalls?: unknown[] })
        .__easyScanLiveCalls?.length ?? 0,
  );

/** The ring's drawn fraction (0 = empty), from its dash offset. */
const ringFraction = (page: Page) =>
  page.locator(".cameraShutterRing circle").evaluate((c) => {
    const total = Number(c.getAttribute("stroke-dasharray"));
    const off = Number.parseFloat(
      (c as SVGCircleElement).style.strokeDashoffset ||
        c.getAttribute("stroke-dashoffset") ||
        String(total),
    );
    return total > 0 ? 1 - off / total : 0;
  });

// ── Flag OFF: exactly the old A4 / Letter screen ────────────────────────────

test.describe("card flag OFF (production default)", () => {
  test.beforeEach(() => {
    test.skip(CARD_ON, "Pins the flag-off build.");
  });

  test("the chip toggles A4 <-> Letter only; no card option, slot, card copy or card name anywhere", async ({
    page,
  }) => {
    // ?debug=1: the ring waits for a hand (soft hints), so no auto-shot
    // replaces the viewfinder while the chip is stepped through.
    await openCamera(page, "/scan/easy?debug=1");
    await expect(chip(page)).toHaveText("A4");
    // Flag off keeps the old accessible name (the visible text).
    await expect(chip(page)).not.toHaveAttribute("aria-label", /.+/);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      await chip(page).click();
      seen.push((await chip(page).innerText()).trim());
      await expect(cardSlot(page)).toHaveCount(0);
    }
    expect(seen).toEqual(["Letter", "A4", "Letter", "A4"]);
    const text = await page.locator("body").innerText();
    for (const s of [cardEn.cardRule, cardEn.hintNoHand, cardEn.handZone])
      expect(text).not.toContain(s);
    await expect(page.locator('[aria-label^="Reference: "]')).toHaveCount(0);
    // The paper path is untouched: the corners are found on the sheet.
    await expect(foundCorners(page)).toHaveCount(4, { timeout: 20_000 });
  });

  test('a stored "card" preference (from a card-enabled build) reads as A4 and is not acted on', async ({
    page,
  }) => {
    await presetReference(page, "card");
    await openCamera(page, "/scan/easy?debug=1");
    await expect(chip(page)).toHaveText("A4");
    await expect(cardSlot(page)).toHaveCount(0);
    await expect(corners(page)).toBeVisible();
    await expect(foundCorners(page)).toHaveCount(4, { timeout: 20_000 });
  });

  test("no motion-sensor permission is asked for on any chip tap", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as Window & { __motionAsks?: number };
      w.__motionAsks = 0;
      const ask = () => {
        w.__motionAsks = (w.__motionAsks ?? 0) + 1;
        return Promise.resolve("granted");
      };
      for (const name of ["DeviceOrientationEvent", "DeviceMotionEvent"]) {
        const ctor = (window as unknown as Record<string, unknown>)[name] as
          { requestPermission?: unknown } | undefined;
        if (ctor) ctor.requestPermission = ask;
      }
    });
    await openCamera(page, "/scan/easy?debug=1");
    for (let i = 0; i < 3; i++) await chip(page).click();
    expect(
      await page.evaluate(
        () => (window as Window & { __motionAsks?: number }).__motionAsks,
      ),
    ).toBe(0);
  });
});

// ── Flag ON ─────────────────────────────────────────────────────────────────

test.describe("card flag ON", () => {
  test.beforeEach(() => {
    test.skip(!CARD_ON, "Needs NEXT_PUBLIC_CARD_REFERENCE_ENABLED=1.");
  });

  test("the chip offers exactly A4, Letter and Card (a menu, closed by Escape)", async ({
    page,
  }) => {
    await openCamera(page, "/scan/easy?debug=1");
    await expect(chip(page)).toHaveText("A4");
    if (await openReferenceChip(page)) {
      const items = referenceMenu(page).locator('[role^="menuitem"]');
      await expect(items).toHaveCount(3);
      const texts = (await items.allInnerTexts()).map((t) => t.trim());
      expect(texts.map((t) => t.split(/\s/)[0])).toEqual([
        "A4",
        "Letter",
        cardEn.chip,
      ]);
      // The current one is marked as chosen.
      await expect(items.first()).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");
      await expect(referenceMenu(page)).toBeHidden();
      await expect(chip(page)).toHaveText("A4");
    } else {
      // A cycling chip (before the menu): one tap is the next one in order.
      await expect(chip(page)).toHaveText("Letter");
    }
  });

  test("A4 -> Card -> Letter -> A4 -> Card: overlay, hint and slot follow each choice, and a reload keeps it", async ({
    page,
  }) => {
    await openCamera(page, "/scan/easy?debug=1");
    await expect(chip(page)).toHaveText("A4");
    await expect(chip(page)).toHaveAttribute(
      "aria-label",
      cardEn.chipAccessibleName("A4"),
    );
    // A4: the paper overlay, found on the sheet; no slot, no card copy.
    await expect(foundCorners(page)).toHaveCount(4, { timeout: 20_000 });
    await expect(cardSlot(page)).toHaveCount(0);
    await expect(cue(page)).not.toContainText(cardEn.hintNoHand);

    const noCardRule = () =>
      expect(page.getByTestId("card-rule")).toHaveCount(0);
    const expectPaper = async (label: "A4" | "Letter") => {
      await expect(chip(page)).toHaveText(label);
      await expect(chip(page)).toHaveAttribute(
        "aria-label",
        cardEn.chipAccessibleName(label),
      );
      await expect(cardSlot(page)).toHaveCount(0);
      await expect(corners(page)).toBeVisible();
      await noCardRule();
      await expect(cue(page)).not.toContainText(cardEn.hintNoHand);
    };
    const expectCard = async () => {
      await expect(chip(page)).toHaveText(cardEn.chip);
      await expect(chip(page)).toHaveAttribute(
        "aria-label",
        cardEn.chipAccessibleName(cardEn.chip),
      );
      // The paper overlay is gone at once: no corner of the sheet survives.
      await expect(corners(page)).toHaveCount(0);
      await expect(foundCorners(page)).toHaveCount(0);
      // The card slot and the card's own words.
      await expect(cardSlot(page)).toBeVisible({ timeout: 10_000 });
      // The card rule line: its own element (data-testid card-rule) since 3fb670a9.
      await expect(page.getByTestId("card-rule")).toBeVisible();
      await expect(page.getByTestId("card-rule")).toHaveText(cardEn.cardRule);
      // MediaPipe finds no hand in the fake scene: the card cue asks for one.
      await expect(cue(page)).toContainText(cardEn.hintNoHand);
    };

    await chooseReference(page, "Card");
    await expectCard();
    await chooseReference(page, "Letter");
    await expectPaper("Letter");
    await chooseReference(page, "A4");
    await expectPaper("A4");
    // Back on A4 the paper is found again from scratch.
    await expect(foundCorners(page)).toHaveCount(4, { timeout: 20_000 });
    await chooseReference(page, "Card");
    await expectCard();

    // A reload keeps the card.
    await page.reload();
    await page.addStyleTag({
      content: "[data-testid=scan-debug-panel] { pointer-events: none; }",
    });
    await expect(chip(page)).toHaveText(cardEn.chip);
    await expect(cardSlot(page)).toBeVisible({ timeout: 10_000 });
    await expect(corners(page)).toHaveCount(0);
    // ...and Letter, chosen next, is kept too.
    await chooseReference(page, "Letter");
    await page.reload();
    await expect(chip(page)).toHaveText("Letter");
    await expect(cardSlot(page)).toHaveCount(0);
  });

  test("auto-shutter: card mode with no hand never fires and takes no paper photo; switching to A4 starts the paper ring from empty and it fires", async ({
    page,
  }) => {
    await startInCard(page, LIVE_DEMO);
    await expect(chip(page)).toHaveText(cardEn.chip);
    await expect(cardSlot(page)).toBeVisible({ timeout: 10_000 });
    // The same scene that fires the paper shutter within a second or two:
    // in card mode, with no hand, nothing is taken for 8 s.
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(1_000);
      expect(await ringFraction(page)).toBeLessThan(0.01);
      await expect(anySheet(page)).toHaveCount(0);
      await expect(page.getByTestId("paper-adjust")).toBeHidden();
    }
    expect(await paperCalls(page)).toBe(0);

    // To A4: the paper loop starts over and fires by itself.
    await chooseReference(page, "A4");
    await expect(cardSlot(page)).toHaveCount(0);
    await confirmAutoFrame(page, 30_000);
    await expect(
      page.getByRole("dialog", { name: "Hand measured" }),
    ).toBeVisible({ timeout: 20_000 });
    expect(await paperCalls(page)).toBe(1);
  });

  test("A4 with the flag on goes all the way: auto-shot, frame confirm, sheet, questions, and the POST carries paper-edge / a4", async ({
    page,
  }) => {
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/api/scans", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      bodies.push(JSON.parse(route.request().postData() ?? "{}"));
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          scanId: "623e4567-e89b-12d3-a456-426614174011",
        }),
      });
    });
    await openCamera(page, LIVE_DEMO);
    await expect(chip(page)).toHaveText("A4");
    await confirmAutoFrame(page, 30_000);
    const sheet = page.getByRole("dialog", { name: "Hand measured" });
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    // Not the card question: the paper path has no outline question.
    await expect(page.getByTestId("card-check-yes")).toHaveCount(0);
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
    const calibration = bodies[0].calibration as Record<string, unknown>;
    expect(calibration.method).toBe("paper-edge");
    expect(calibration.paperSize).toBe("a4");
    expect(calibration).not.toHaveProperty("cardSizeMm");
    // Rule 5: numbers only, no picture in the body.
    expect(JSON.stringify(bodies[0])).not.toMatch(/data:image|base64/);
  });

  test("a manual shot in card mode runs the REAL card analysis (not the paper pipeline): no hand -> retake, and retake returns to card mode", async ({
    page,
  }) => {
    await startInCard(page, LIVE_DEMO);
    await expect(cardSlot(page)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Take photo" }).click();
    const retake = page.getByRole("dialog", { name: "Retake needed" });
    await expect(retake).toBeVisible({ timeout: 60_000 });
    // The injected paper pipeline was never called: card mode has its own.
    expect(await paperCalls(page)).toBe(0);
    // The card outline question is only for a measured card photo.
    await expect(page.getByTestId("card-check-yes")).toHaveCount(0);
    await retake
      .getByRole("button", { name: /Retake|Try again/ })
      .first()
      .click();
    await expect(retake).toBeHidden();
    await expect(chip(page)).toHaveText(cardEn.chip);
    await expect(cardSlot(page)).toBeVisible({ timeout: 10_000 });
    await expect(corners(page)).toHaveCount(0);
  });
});
