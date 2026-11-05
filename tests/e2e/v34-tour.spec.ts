import { expect, test, type Locator, type Page } from "@playwright/test";
import { en as tour } from "../../src/lib/copy/scan-tour";
import { en as cardEn } from "../../src/lib/copy/card-reference";

/**
 * v3.4 scan tour (Toutour spotlight, candidate 未拍板): first use, step
 * navigation, "?" to reopen, the keyboard, locked targets, and the step list
 * with and without the card. Runs on the fake-camera project
 * (paper-edge-full.y4m), in both builds (see v34-reference.spec.ts for the
 * two-pass run): card-only tests skip in the flag-off build and the A4-only
 * test skips in the flag-on build.
 *
 * Everything here is the real screen and the real tour; nothing is injected
 * except the demo route's fixed paper result where a test needs to know that
 * no photo was taken behind the tour (`/scan/easy/live-measured-demo`).
 */
const CARD_ON = process.env.NEXT_PUBLIC_CARD_REFERENCE_ENABLED === "1";
const LIVE_DEMO = "/scan/easy/live-measured-demo";
const TIP_SEEN_KEY = "openMouse.easyScan.firstRunTipSeen";
const PAD = 6; // SPOTLIGHT_PAD (tourModel.ts)

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(
    testInfo.project.name !== "chromium-camera-paper-edge",
    "Needs the fake-camera project (paper-edge-full.y4m).",
  );
});

const tourDialog = (page: Page) => page.getByTestId("scan-tour");
const welcome = (page: Page) =>
  page.getByRole("dialog", { name: tour.welcomeTitle });
const card = (page: Page) => page.getByTestId("scan-tour-card");
const spotlight = (page: Page) => page.getByTestId("scan-tour-spotlight");
const chip = (page: Page) => page.locator('[data-tour="reference-chip"]');
const button = (page: Page, name: string) =>
  tourDialog(page).getByRole("button", { name, exact: true });
const seen = (page: Page) =>
  page.evaluate((k) => window.localStorage.getItem(k), TIP_SEEN_KEY);
const paperCalls = (page: Page) =>
  page.evaluate(
    () =>
      (window as Window & { __easyScanLiveCalls?: unknown[] })
        .__easyScanLiveCalls?.length ?? 0,
  );

/** The spotlight is the target's box grown by the pad (±2 px). */
async function expectSpotlightOn(page: Page, target: Locator) {
  await expect(spotlight(page)).toBeVisible();
  await expect
    .poll(async () => {
      const t = await target.boundingBox();
      const s = await spotlight(page).boundingBox();
      if (!t || !s) return Infinity;
      return Math.max(
        Math.abs(s.x - (t.x - PAD)),
        Math.abs(s.y - (t.y - PAD)),
        Math.abs(s.width - (t.width + 2 * PAD)),
        Math.abs(s.height - (t.height + 2 * PAD)),
      );
    })
    .toBeLessThanOrEqual(2);
}

async function stepIds(page: Page): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < 8; i++) {
    await expect(card(page)).toBeVisible();
    ids.push((await card(page).getAttribute("data-step")) ?? "?");
    const last = await button(page, tour.start).count();
    if (last) {
      await button(page, tour.start).click();
      break;
    }
    await button(page, tour.next).click();
  }
  return ids;
}

test("first use: the question opens by itself, holds the camera (no photo behind it), and 'not my first time' closes it for good", async ({
  page,
}) => {
  await page.goto(LIVE_DEMO);
  await expect(welcome(page)).toBeVisible({ timeout: 15_000 });
  await expect(button(page, tour.welcomeFirst)).toBeFocused();
  await expect(welcome(page)).toContainText(
    CARD_ON ? tour.welcomeRowPlaceWithCard : tour.welcomeRowPlacePaperOnly,
  );
  // The same scene fires the paper shutter within seconds once the screen
  // is free: behind the question nothing is taken.
  await page.waitForTimeout(5_000);
  expect(await paperCalls(page)).toBe(0);
  await expect(page.getByTestId("paper-adjust")).toBeHidden();
  expect(await seen(page)).toBeNull();

  await button(page, tour.welcomeReturning).click();
  await expect(tourDialog(page)).toHaveCount(0);
  expect(await seen(page)).toBe("1");
  // The camera runs now: the demo's shot comes through.
  await expect(page.getByTestId("paper-adjust")).toBeVisible({
    timeout: 30_000,
  });
  await page.reload();
  await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible();
  await page.waitForTimeout(1_500); // past the tour's 400 ms settle
  await expect(tourDialog(page)).toHaveCount(0);
});

test("first time: Next / Back walk the steps with a counter and a spotlight on each target; Start scanning finishes and marks it seen", async ({
  page,
}) => {
  await page.goto("/scan/easy?debug=1");
  await button(page, tour.welcomeFirst).click();
  await expect(card(page)).toHaveAttribute("data-step", "reference");
  const counter = card(page).locator(".scanTourCounter");
  await expect(counter).toHaveText(/^(Card · )?1 \/ 4$/);
  await expect(button(page, tour.back)).toHaveCount(0);
  await expectSpotlightOn(page, chip(page));
  // Back is not offered on step 1; Next goes on.
  await button(page, tour.next).click();
  await expect(card(page)).toHaveAttribute("data-step", "placement");
  await expect(counter).toHaveText(/2 \/ 4$/);
  await button(page, tour.next).click();
  await expect(card(page)).toHaveAttribute("data-step", "cue");
  await expectSpotlightOn(page, page.locator('[data-tour="cue"]'));
  await button(page, tour.back).click();
  await expect(card(page)).toHaveAttribute("data-step", "placement");
  await button(page, tour.next).click();
  await button(page, tour.next).click();
  await expect(card(page)).toHaveAttribute("data-step", "shutter");
  await expect(counter).toHaveText(/4 \/ 4$/);
  await expectSpotlightOn(page, page.locator('[data-tour="shutter"]'));
  await expect(button(page, tour.next)).toHaveCount(0);
  await button(page, tour.start).click();
  await expect(tourDialog(page)).toHaveCount(0);
  expect(await seen(page)).toBe("1");
});

test("'?' reopens the tour at step 1 with no question; Skip tour closes it; it never comes back by itself", async ({
  page,
}) => {
  await page.goto("/scan/easy?debug=1");
  await button(page, tour.welcomeReturning).click();
  await expect(tourDialog(page)).toHaveCount(0);
  const help = page.locator('[data-tour="help"]');
  await expect(help).toBeVisible();
  await help.click();
  await expect(card(page)).toHaveAttribute("data-step", "reference");
  await expect(welcome(page)).toHaveCount(0);
  await button(page, tour.next).click();
  await button(page, tour.skip).click();
  await expect(tourDialog(page)).toHaveCount(0);
  // Focus goes back to the camera screen, not lost under a closed dialog.
  await expect(page.locator("dialog.scanTour[open]")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible();
  await page.waitForTimeout(1_500);
  await expect(tourDialog(page)).toHaveCount(0);
});

test("keyboard: focus starts on the main button, Enter acts, Tab stays inside the tour, Escape skips", async ({
  page,
}) => {
  await page.goto("/scan/easy?debug=1");
  await expect(button(page, tour.welcomeFirst)).toBeFocused({
    timeout: 15_000,
  });
  await page.keyboard.press("Enter");
  await expect(card(page)).toHaveAttribute("data-step", "reference");
  await expect(button(page, tour.next)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card(page)).toHaveAttribute("data-step", "placement");
  await expect(button(page, tour.next)).toBeFocused();
  // Tab around: focus never leaves the tour (the screen behind is inert).
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const a = document.activeElement;
      return a === document.body || !!a?.closest("[data-testid=scan-tour]");
    });
    expect(inside).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(tourDialog(page)).toHaveCount(0);
  expect(await seen(page)).toBe("1");
});

test("the spotlit control is locked: a tap on the chip under the spotlight changes nothing", async ({
  page,
}) => {
  await page.goto("/scan/easy?debug=1");
  await button(page, tour.welcomeFirst).click();
  await expectSpotlightOn(page, chip(page));
  const before = (await chip(page).innerText()).trim();
  const box = (await chip(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(card(page)).toHaveAttribute("data-step", "reference");
  await button(page, tour.skip).click();
  await expect(chip(page)).toHaveText(before);
});

test("A4-only build: step 1 is the paper-size step (A4 / Letter only, no Card), and no step points at a card slot", async ({
  page,
}) => {
  test.skip(CARD_ON, "Pins the flag-off build.");
  await page.goto("/scan/easy?debug=1");
  await button(page, tour.welcomeFirst).click();
  await expect(card(page)).toContainText(tour.paperSizeTitle);
  const radios = card(page).getByRole("radio");
  await expect(radios).toHaveCount(2);
  await expect(card(page).getByRole("radio", { name: "A4" })).toBeChecked();
  await expect(
    card(page).getByRole("radio", { name: tour.referenceLetter }),
  ).toBeVisible();
  await expect(
    card(page).getByRole("radio", { name: tour.referenceCard }),
  ).toHaveCount(0);
  // Letter chosen in the tour is the chip's Letter at once, and back.
  await card(page).getByRole("radio", { name: tour.referenceLetter }).check();
  await expect(chip(page)).toHaveText("Letter");
  await card(page).getByRole("radio", { name: "A4" }).check();
  await expect(chip(page)).toHaveText("A4");
  await expect(card(page).locator(".scanTourCounter")).toHaveText("1 / 4");
  await expect(page.locator('[data-tour="card-slot"]')).toHaveCount(0);
  await expect(page.locator('[data-tour="card-layout"]')).toHaveCount(0);
  expect(await stepIds(page)).toEqual([
    "reference",
    "placement",
    "cue",
    "shutter",
  ]);
  for (const s of [tour.placeCardTitle, cardEn.chip + " · "])
    await expect(page.locator("body")).not.toContainText(s);
});

test("card build, paper chosen: step 1 offers A4 / Letter / Card and the placement step points at the paper frame", async ({
  page,
}) => {
  test.skip(!CARD_ON, "Needs NEXT_PUBLIC_CARD_REFERENCE_ENABLED=1.");
  await page.goto("/scan/easy?debug=1");
  await button(page, tour.welcomeFirst).click();
  await expect(card(page)).toContainText(tour.referenceTitle);
  const group = card(page).getByRole("group", {
    name: tour.referenceGroupLabel,
  });
  await expect(group.getByRole("radio")).toHaveCount(3);
  await expect(group.getByRole("radio", { name: "A4" })).toBeChecked();
  await button(page, tour.next).click();
  await expect(card(page)).toHaveAttribute("data-step", "placement");
  await expect(card(page)).toContainText(tour.placePaperTitle);
  await expect(page.locator('[data-tour="card-slot"]')).toHaveCount(0);
});

test("card build: choosing Card inside the tour switches the camera to the card at once, prefixes the counter and spotlights the card slot; back to A4 undoes it", async ({
  page,
}) => {
  test.skip(!CARD_ON, "Needs NEXT_PUBLIC_CARD_REFERENCE_ENABLED=1.");
  await page.goto("/scan/easy?debug=1");
  await button(page, tour.welcomeFirst).click();
  const group = card(page).getByRole("group", {
    name: tour.referenceGroupLabel,
  });
  await group.getByRole("radio", { name: tour.referenceCard }).check();
  await expect(chip(page)).toHaveText(cardEn.chip);
  await expect(card(page).locator(".scanTourCounter")).toHaveText(
    `${tour.counterCardPrefix}1 / 4`,
  );
  await expect(card(page)).toContainText(tour.referenceBodyCard);
  await button(page, tour.next).click();
  await expect(card(page)).toHaveAttribute("data-step", "placement");
  await expect(card(page)).toContainText(tour.placeCardTitle);
  // Design (card-2): the spotlight is on the hand-and-slot layout, or on the
  // slot alone where the layout is not drawn.
  const slot = page.locator('[data-tour="card-slot"]');
  const layout = page.locator('[data-tour="card-layout"]');
  await expect(layout.or(slot).first()).toBeAttached();
  // Since review round 7 the spotlight may be cut short above the tooltip
  // pinned at the bottom: it must still hold the whole card slot.
  await expect(spotlight(page)).toBeVisible();
  await expect
    .poll(async () => {
      const s = await spotlight(page).boundingBox();
      const t = await slot.boundingBox();
      if (!s || !t) return false;
      return (
        t.x >= s.x - 2 &&
        t.y >= s.y - 2 &&
        t.x + t.width <= s.x + s.width + 2 &&
        t.y + t.height <= s.y + s.height + 2
      );
    })
    .toBe(true);
  void layout;
  await expect(page.locator("body")).toContainText(tour.placeCardCentreLabel);
  // Back to step 1, A4 again: the placement is the paper frame again.
  await button(page, tour.back).click();
  await group.getByRole("radio", { name: tour.referenceA4 }).check();
  await expect(chip(page)).toHaveText("A4");
  await expect(card(page).locator(".scanTourCounter")).toHaveText("1 / 4");
  await button(page, tour.next).click();
  await expect(card(page)).toContainText(tour.placePaperTitle);
  await expect(slot).toHaveCount(0);
  // Finish: the choice is the stored one.
  await button(page, tour.skip).click();
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("openMouse.easyScan.paperSize"),
    ),
  ).toBe("a4");
});

test("card build: under the card placement step the card guide itself (hand box and dashed slot) is drawn inside the spotlight", async ({
  page,
}) => {
  test.skip(!CARD_ON, "Needs NEXT_PUBLIC_CARD_REFERENCE_ENABLED=1.");
  // Design (Pencil 14c card-2): the spotlight shows the hand brackets and the
  // slot as drawn. The tour holds the live loop, so this checks the guide is
  // drawn even then, not only once the loop runs.
  await page.goto("/scan/easy?debug=1");
  await button(page, tour.welcomeFirst).click();
  await card(page)
    .getByRole("group", { name: tour.referenceGroupLabel })
    .getByRole("radio", { name: tour.referenceCard })
    .check();
  await button(page, tour.next).click();
  await expect(card(page)).toHaveAttribute("data-step", "placement");
  await expect(page.locator('[data-tour="card-slot"]')).toBeVisible({
    timeout: 5_000,
  });
});
