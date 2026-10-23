import { expect, type Page } from "@playwright/test";

/**
 * V3.2 F15 (candidate): a photo measured from the detector's own four corners
 * opens the paper-frame adjustment by itself, before its sheet and lengths are
 * shown. This confirms the frame as it opened (no corner moved), so the sheet
 * then shows the very result the pipeline gave (nothing runs again).
 */
export async function confirmAutoFrame(page: Page, timeout = 20_000) {
  const adjust = page.getByTestId("paper-adjust");
  await expect(adjust).toBeVisible({ timeout });
  await expect(adjust).toHaveAttribute("data-entry", "review");
  await expectNothingMeasuredShown(page);
  await page.getByTestId("paper-adjust-confirm").click();
  await expect(adjust).toBeHidden();
}

/**
 * For a real photo whose end is not known in advance (measured, or turned
 * back): waits for the result sheet or the adjustment, and confirms the
 * adjustment only when it opened on a measured photo (`review`). A rescue
 * after a paper failure (F14) is left open: confirming it would measure again.
 */
export async function confirmAutoFrameIfShown(page: Page, timeout = 30_000) {
  const adjust = page.getByTestId("paper-adjust");
  const sheet = page.locator("dialog.easyResultSheet[open]");
  await expect(adjust.or(sheet).first()).toBeVisible({ timeout });
  if (
    (await adjust.isVisible()) &&
    (await adjust.getAttribute("data-entry")) === "review"
  ) {
    await expectNothingMeasuredShown(page);
    await page.getByTestId("paper-adjust-confirm").click();
    await expect(adjust).toBeHidden();
  }
}

/**
 * F15 AC1: while the adjustment that opened by itself is on screen, the
 * result sheet is closed and no length is drawn on the photo; both come only
 * after the confirm.
 */
export async function expectNothingMeasuredShown(page: Page) {
  await expect(page.locator("dialog.easyResultSheet[open]")).toHaveCount(0);
  await expect(page.getByTestId("easy-sheet-numbers")).toBeHidden();
  await expect(
    page.locator(".easyDimLabelText, .easyFrozenSvg text"),
  ).toHaveCount(0);
}
