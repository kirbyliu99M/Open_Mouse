import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import { RESULT_FEEDBACK_MIN_DWELL_MS } from "../../src/lib/results/resultFeedback";

/**
 * V3.2 F11 (Kirby's phone test, 2026-10-21: "after pressing other buttons the
 * results page's back no longer works"): the buttons on a results page add no
 * history entries, so the browser's back leaves the results. Only a card that
 * opens another mouse's page adds one. The scan routes are stubbed (no
 * database in e2e). Run alone: `--project=chromium --workers=1`.
 *
 * The tests from "the enlarged photo, Other mice, share and the feedback
 * sheet" on were NOT RUN by their author (Playwright crashes the machine this
 * was written on); they are type-checked only. Until the verifier has run this
 * file alone (`--project=chromium --workers=1`) and they pass, they are NOT
 * evidence for acceptance 3 or 4: in particular the router.refresh test is
 * the only browser check of "the stamp survives router.refresh" (the logic is
 * unit-tested in tests/unit/results-f11.test.ts, "F11-8: resolveStamp"), and
 * its selectors (`language-switcher` .last(), aria-pressed="false") and the
 * headless share resolving at once are unconfirmed. The top-bar "‹ 重新掃描"
 * history back is not driven here at all; its handoff wiring is unit-tested in
 * tests/unit/use-scan-submit-handoff.test.ts.
 */

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../src/components/results/fixtures/many-results.json",
        import.meta.url,
      ),
    ),
    "utf-8",
  ),
) as {
  scanId: string;
  results: { mouse: { slug: string; imageUrl?: string | null } }[];
};

const SCAN_ID = FIXTURE.scanId;
const MAIN = `/results/${SCAN_ID}`;
const RANK_2 = FIXTURE.results[1].mouse.slug;

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function stubScan(
  page: Page,
  options: { feedbackAnswered?: boolean; photo?: boolean } = {},
) {
  // The top mouse gets its real committed photo, so the enlarge button exists.
  const fit = options.photo
    ? {
        ...FIXTURE,
        results: FIXTURE.results.map((r) => ({
          ...r,
          mouse: { ...r.mouse, imageUrl: `/images/mice/${r.mouse.slug}.webp` },
        })),
      }
    : FIXTURE;
  await page.route(`**/api/scans/${SCAN_ID}/fit`, (route) =>
    json(route, 200, fit),
  );
  await page.route(`**/api/scans/${SCAN_ID}/analysis`, (route) =>
    json(route, 503, { error: "stub" }),
  );
  await page.route(`**/api/scans/${SCAN_ID}/measurements`, (route) =>
    json(route, 404, { error: "Scan not found." }),
  );
  // Rated already (the default): the feedback sheet stays away.
  await page.route(`**/api/scans/${SCAN_ID}/feedback`, (route) =>
    json(route, 200, { answered: options.feedbackAnswered ?? true }),
  );
  // Signed out, questionnaire not answered on this device.
  await page.route("**/api/auth/session", (route) => json(route, 200, {}));
}

/** A page before the results, so "left the results" has somewhere to land. */
async function startOutside(page: Page) {
  await page.goto("about:blank");
}

const historyLength = (page: Page) => page.evaluate(() => history.length);

test.describe("results: the back button leaves the results page", () => {
  // The phone layout: the filter is a bottom sheet (a modal dialog).
  test.use({ viewport: { width: 390, height: 844 } });

  test("toggle, open and close the filter, open Details, then back", async ({
    page,
  }) => {
    // The dev server compiles the route on first use (about 10 s measured on
    // the V3.2 branch, results-detail-flow.spec.ts).
    test.setTimeout(90_000);
    await stubScan(page);
    await startOutside(page);
    await page.goto(MAIN);
    await expect(page.locator(".results-score-rank")).toBeVisible({
      timeout: 30_000,
    });
    const before = await historyLength(page);

    // The shape toggle: another segment, the URL may change, no new entry.
    const options = page.locator(
      '.results-shapeToggle [role="radio"][aria-checked="false"]',
    );
    await options.first().click();
    await expect(
      page.locator('.results-shapeToggle [role="radio"][aria-checked="true"]'),
    ).toHaveCount(1);
    // The fixture's mice carry no shape, so a shape segment lists none and has
    // no Details: go back to the first segment (Overall) before going on.
    await page.locator('.results-shapeToggle [role="radio"]').first().click();

    // The filter sheet: open it, then close it with its X (48 x 48).
    await page.locator(".results-filterButton").click();
    const dialog = page.locator("dialog.results-sheet");
    await expect(dialog).toBeVisible();
    const close = dialog.locator(".results-sheet-close");
    const box = (await close.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await close.click();
    await expect(dialog).toHaveCount(0);

    // Details.
    const details = page.locator(".results-details");
    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");

    expect(await historyLength(page)).toBe(before);

    await page.goBack();
    await expect(page).not.toHaveURL(/\/results\//);
  });

  test("a card adds one entry; back returns to the list, the next back leaves", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await stubScan(page);
    await startOutside(page);
    await page.goto(MAIN);
    await expect(page.locator(".results-score-rank")).toBeVisible({
      timeout: 30_000,
    });

    await page.locator(".results-card").filter({ hasText: "G305" }).click();
    await expect(page).toHaveURL(`${MAIN}/m/${RANK_2}`, { timeout: 30_000 });
    // From the detail page, the first place goes back to the list's entry.
    await page.locator(".results-card").first().click();
    await expect(page).toHaveURL(MAIN);

    await page.goBack();
    await expect(page).not.toHaveURL(/\/results\//);
  });

  test("the enlarged photo, Other mice, share and the feedback sheet add no entry", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await stubScan(page, { feedbackAnswered: false, photo: true });
    // Share resolves at once (no system sheet in a headless browser).
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "canShare", {
        value: () => true,
        configurable: true,
      });
      Object.defineProperty(navigator, "share", {
        value: () => Promise.resolve(),
        configurable: true,
      });
    });
    await page.clock.install();
    await startOutside(page);
    await page.goto(MAIN);
    await expect(page.locator(".results-score-rank")).toBeVisible({
      timeout: 30_000,
    });
    const before = await historyLength(page);

    // The enlarged photo: open, then Esc.
    await page.locator(".results-photoZoom-btn").first().click();
    const photo = page.locator("dialog.results-photoDialog");
    await expect(photo).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(photo).toHaveCount(0);

    // Other mice: open the disclosure.
    const other = page.locator(".results-otherMice");
    await other.locator("summary").click();
    await expect(other).toHaveAttribute("open", "");

    // Share.
    await page
      .locator('[data-testid="share-card-button"]:visible')
      .first()
      .click();

    // The feedback sheet: reach the end of the list, wait the 20 s, close it.
    await page.mouse.wheel(0, 400);
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await page.clock.runFor(RESULT_FEEDBACK_MIN_DWELL_MS + 1_000);
    const sheet = page.locator(".results-feedback-sheet");
    await expect(sheet).toBeVisible();
    await sheet.locator(".results-feedback-close").click();
    await expect(sheet).toHaveCount(0);

    expect(await historyLength(page)).toBe(before);
    await page.goBack();
    await expect(page).not.toHaveURL(/\/results\//);
  });

  test("after the language switch (router.refresh), the first place still goes back to the list", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await stubScan(page);
    await startOutside(page);
    await page.goto(MAIN);
    await expect(page.locator(".results-score-rank")).toBeVisible({
      timeout: 30_000,
    });
    const before = await historyLength(page);

    await page.locator(".results-card").filter({ hasText: "G305" }).click();
    await expect(page).toHaveURL(`${MAIN}/m/${RANK_2}`, { timeout: 30_000 });

    // The other language: the footer's switcher refreshes the page in place.
    const switcher = page.getByTestId("language-switcher").last();
    await switcher.locator('button[aria-pressed="false"]').click();
    await expect(switcher.locator('button[aria-pressed="true"]')).toHaveCount(
      1,
    );
    await expect(page.locator(".results-score-rank")).toBeVisible();

    await page.locator(".results-card").first().click();
    await expect(page).toHaveURL(MAIN);
    // A back (not a replace, which would leave the list twice in history): the
    // next back leaves the results.
    expect(await historyLength(page)).toBe(before + 1);
    await page.goBack();
    await expect(page).not.toHaveURL(/\/results\//);
  });
});
