import type { Page } from "@playwright/test";

/**
 * The written analysis sits behind the one line under the large card on the
 * 「綜合」 page (Kirby 2026-10-28 hotfix; before, it was in Details). Opens
 * the line when the page has it and it is closed; a page without it (a
 * detail page, a shape page, no analysis) is left as it is.
 */
export async function openAnalysisLine(page: Page): Promise<void> {
  const button = page.locator(".results-analysisLine").getByRole("button");
  if ((await button.count()) === 0) return;
  if ((await button.getAttribute("aria-expanded")) === "false")
    await button.click();
}
