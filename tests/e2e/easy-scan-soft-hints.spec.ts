/**
 * V3.3 WP3 (candidate 未拍板): the soft hints in a real browser on the fake
 * camera (paper-edge-full.y4m). Without ?debug=1 no hand hint and no banner
 * ever appear; with ?debug=1 a hint may appear, and the auto-capture still
 * takes the photo by itself (hints never gate). The fixture's "hand" is a
 * skin-tone blob, so the hand detector most likely finds no hand and the
 * hint, if any, is "Place your hand on the paper".
 */
import { expect, test, type Page } from "@playwright/test";

const LIVE_DEMO = "/scan/easy/live-measured-demo";
const HAND_HINTS = [
  "Place your hand on the paper",
  "Move your wrist to the bottom edge",
  "Keep your hand inside the paper",
  "Point your fingers to the top edge",
  "Lay your hand flat",
];

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(
    testInfo.project.name !== "chromium-camera-paper-edge",
    "Needs the fake-camera project (paper-edge-full.y4m).",
  );
});

/** Records every text the cue line shows until the measured sheet is up. */
async function watchCue(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as Window & { __cueSeen?: string[] }).__cueSeen = seen;
    const observe = () => {
      const cue = document.querySelector("[data-testid=camera-cue]");
      const text = cue?.textContent?.trim();
      if (text && seen[seen.length - 1] !== text) seen.push(text);
    };
    new MutationObserver(observe).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}
const cueSeen = (page: Page) =>
  page.evaluate(
    () => (window as Window & { __cueSeen?: string[] }).__cueSeen ?? [],
  );

test("hints off (no ?debug=1): no hand hint and no banner, the photo is taken as before", async ({
  page,
}) => {
  await watchCue(page);
  await page.goto(LIVE_DEMO);
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("dialog", { name: "Hand measured" })).toBeVisible(
    { timeout: 20_000 },
  );
  const seen = await cueSeen(page);
  for (const hint of HAND_HINTS) expect(seen).not.toContain(hint);
  await expect(page.locator(".cameraCueSoftHint")).toHaveCount(0);
  await expect(page.getByTestId("easy-soft-hint")).toHaveCount(0);
});

test("hints on (?debug=1): the auto-capture still takes the photo by itself", async ({
  page,
}) => {
  await watchCue(page);
  await page.goto(`${LIVE_DEMO}?debug=1`);
  await page.getByRole("button", { name: "Got it" }).click();
  const sheet = page.getByRole("dialog", { name: "Hand measured" });
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  // Continue and retake are there whatever hint was shown.
  await expect(sheet.getByTestId("answers-continue-button")).toBeEnabled();
  await expect(
    sheet.getByRole("button", { name: /retake/i }).first(),
  ).toBeVisible();
  const seen = await cueSeen(page);
  // A hand hint, if one showed, is one of the five candidate lines.
  const hints = seen.filter((t) => HAND_HINTS.includes(t));
  test.info().annotations.push({
    type: "hand hints seen",
    description: hints.join(" | ") || "(none)",
  });
});

test("hints on: a banner, when one shows, closes with its button and leaves Continue working", async ({
  page,
}) => {
  await page.goto(`${LIVE_DEMO}?debug=1`);
  await page.getByRole("button", { name: "Got it" }).click();
  const sheet = page.getByRole("dialog", { name: "Hand measured" });
  await expect(sheet).toBeVisible({ timeout: 30_000 });
  const banner = page.getByTestId("easy-soft-hint");
  if ((await banner.count()) === 0) {
    test.info().annotations.push({
      type: "banner",
      description: "none for this photo (the demo result has no placement)",
    });
  } else {
    const close = page.getByTestId("easy-soft-hint-close");
    const b = await close.boundingBox();
    expect(b?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(b?.height ?? 0).toBeGreaterThanOrEqual(44);
    await close.click();
    await expect(banner).toHaveCount(0);
  }
  await sheet.getByTestId("answers-continue-button").click();
  await expect(sheet).toBeHidden();
});
