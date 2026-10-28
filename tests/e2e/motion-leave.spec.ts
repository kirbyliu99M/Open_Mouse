import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import { leaveMs } from "../../src/lib/motion";
import { RESULT_FEEDBACK_MIN_DWELL_MS } from "../../src/lib/results/resultFeedback";

/**
 * V3.2 motion pass (candidate / 未拍板), builder B's review round: things that
 * close leave the way they came, and when they have gone the page is fully
 * usable again. For the nav menu, the enlarged photo, the share preview, the
 * delete-scan confirmation and the feedback sheet:
 *   - right after the close action the element carries `data-leaving` (a
 *     MutationObserver records it, so a short leave is never missed);
 *   - it is gone within leaveMs + 300 ms;
 *   - then no ancestor of <main> is inert, the body scrolls, a button on the
 *     page takes a click, and focus is on the documented target.
 * The photo and the share preview are also opened again during their leave:
 * they end open and usable; and a double click on their close buttons
 * presses nothing underneath (a leaving element swallows the second tap).
 *
 * The scan routes are stubbed (no database in e2e), as in results-back.spec.ts.
 * The account sheets need a signed-in user and are not covered here.
 * WRITTEN BUT NOT RUN by its author (Playwright crashes that machine).
 * Run: `--project=chromium --workers=1`.
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
const FADE = leaveMs("fade", false);
const SHEET = leaveMs("sheet", false);

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** The real results page, stubbed, with the top mouse's committed photo. */
async function stubScan(
  page: Page,
  options: { feedbackAnswered?: boolean } = {},
) {
  const fit = {
    ...FIXTURE,
    results: FIXTURE.results.map((r) => ({
      ...r,
      mouse: { ...r.mouse, imageUrl: `/images/mice/${r.mouse.slug}.webp` },
    })),
  };
  await page.route(`**/api/scans/${SCAN_ID}/fit`, (route) =>
    json(route, 200, fit),
  );
  await page.route(`**/api/scans/${SCAN_ID}/analysis`, (route) =>
    json(route, 503, { error: "stub" }),
  );
  await page.route(`**/api/scans/${SCAN_ID}/measurements`, (route) =>
    json(route, 404, { error: "Scan not found." }),
  );
  await page.route(`**/api/scans/${SCAN_ID}/feedback`, (route) =>
    json(route, 200, { answered: options.feedbackAnswered ?? true }),
  );
  // Signed out: the anonymous delete action is there.
  await page.route("**/api/auth/session", (route) => json(route, 200, {}));
}

/**
 * Records every element that gets `data-leaving="true"`, from the first
 * script on: `window.__leaving` holds a selector-matchable mark per change.
 */
async function recordLeaving(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __leaving: Element[] };
    w.__leaving = [];
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as Element;
        if (el.getAttribute("data-leaving") === "true") w.__leaving.push(el);
      }
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-leaving"],
    });
  });
}

async function clearLeaving(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __leaving: Element[] }).__leaving = [];
  });
}

/** Whether an element matching `selector` was marked leaving since the last clear. */
function sawLeaving(page: Page, selector: string): Promise<boolean> {
  return page.evaluate(
    (sel) =>
      (window as unknown as { __leaving: Element[] }).__leaving.some((el) =>
        el.matches(sel),
      ),
    selector,
  );
}

/** Close, see it leave, see it gone in time. */
async function closesWithLeave(
  page: Page,
  target: Locator,
  selector: string,
  ms: number,
  close: () => Promise<void>,
) {
  await clearLeaving(page);
  await close();
  await expect.poll(() => sawLeaving(page, selector)).toBe(true);
  await expect(target).toHaveCount(0, { timeout: ms + 300 });
}

/** After it has gone: the page is whole again, and focus is where it belongs. */
async function pageIsUsable(
  page: Page,
  focus: Locator | null,
  clickable: Locator,
) {
  const inertAbove = await page.evaluate(() => {
    let el: Element | null = document.querySelector("main");
    const found: string[] = [];
    while (el) {
      if (el.hasAttribute("inert")) found.push(el.tagName);
      el = el.parentElement;
    }
    return found;
  });
  expect(inertAbove).toEqual([]);
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");
  // Actionable (visible, enabled, receives the pointer), without side effects.
  await clickable.click({ trial: true, timeout: 2_000 });
  if (focus) await expect(focus).toBeFocused();
  // Never left on something that has gone.
  expect(
    await page.evaluate(() => document.activeElement?.isConnected ?? true),
  ).toBe(true);
}

test.describe("motion: things leave, and the page is usable after", () => {
  test.beforeEach(async ({ page }) => {
    await recordLeaving(page);
  });

  test("the nav menu slides out on Esc and on its close button", async ({
    page,
  }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Open menu" });
    const menu = page.locator("dialog.navMenu");

    await trigger.click();
    await expect(menu).toBeVisible();
    await closesWithLeave(page, menu, "dialog.navMenu", SHEET, () =>
      page.keyboard.press("Escape"),
    );
    await pageIsUsable(page, trigger, trigger);

    await trigger.click();
    await expect(menu).toBeVisible();
    await closesWithLeave(page, menu, "dialog.navMenu", SHEET, () =>
      menu.getByRole("button", { name: "Close menu" }).click(),
    );
    await pageIsUsable(page, trigger, trigger);
  });

  test.describe("on a results page", () => {
    test.beforeEach(async ({ page }) => {
      await stubScan(page);
      await page.goto(MAIN);
      await expect(page.locator(".results-score-rank")).toBeVisible({
        timeout: 30_000,
      });
    });

    test("the enlarged photo fades out (close button, Esc), and opened again mid-fade it stays", async ({
      page,
    }) => {
      const open = page.locator(".results-photoZoom-btn").first();
      const dialog = page.locator("dialog.results-photoDialog");

      await open.click();
      await expect(dialog).toBeVisible();
      await closesWithLeave(
        page,
        dialog,
        "dialog.results-photoDialog",
        FADE,
        () => dialog.locator(".results-photoDialog-close").click(),
      );
      await pageIsUsable(page, open, open);

      await open.click();
      await expect(dialog).toBeVisible();
      await closesWithLeave(
        page,
        dialog,
        "dialog.results-photoDialog",
        FADE,
        () => page.keyboard.press("Escape"),
      );
      await pageIsUsable(page, open, open);

      // Open, close, and open again within 80 ms. The page behind a modal is
      // inert, so the button is pressed from script (a person would reach it
      // only once the photo has gone); the code must still end open.
      await open.click();
      await expect(dialog).toBeVisible();
      await dialog.locator(".results-photoDialog-close").click();
      await open.evaluate((el) => (el as HTMLElement).click());
      // Longer than the fade: had it closed, it would be gone by now.
      await page.waitForTimeout(FADE + 300);
      await expect(dialog).toBeVisible();
      await expect(dialog).not.toHaveAttribute("data-leaving", "true");
      await expect(dialog).not.toHaveAttribute("inert", "");
      await expect(dialog).toHaveCSS("opacity", "1");
      // Usable: its close button works and focus comes back.
      await closesWithLeave(
        page,
        dialog,
        "dialog.results-photoDialog",
        FADE,
        () => dialog.locator(".results-photoDialog-close").click(),
      );
      await pageIsUsable(page, open, open);
    });

    test("the share preview fades out (close button, Esc), and opened again mid-fade it stays", async ({
      page,
    }) => {
      const entry = page
        .locator('[data-testid="share-card-button"]:visible')
        .first();
      const preview = page.getByTestId("share-preview");

      await entry.click();
      await expect(preview).toBeVisible();
      await closesWithLeave(
        page,
        preview,
        '[data-testid="share-preview"]',
        FADE,
        () => preview.locator(".sharePreview-close").click(),
      );
      await pageIsUsable(page, entry, entry);

      await entry.click();
      await expect(preview).toBeVisible();
      await closesWithLeave(
        page,
        preview,
        '[data-testid="share-preview"]',
        FADE,
        () => page.keyboard.press("Escape"),
      );
      await pageIsUsable(page, entry, entry);

      // Open, close, open again within 80 ms (from script, as above).
      await entry.click();
      await expect(preview).toBeVisible();
      await preview.locator(".sharePreview-close").click();
      await entry.evaluate((el) => (el as HTMLElement).click());
      await page.waitForTimeout(FADE + 300);
      await expect(preview).toBeVisible();
      await expect(preview).not.toHaveAttribute("data-leaving", "true");
      await expect(preview).not.toHaveAttribute("inert", "");
      await expect(preview).toHaveCSS("opacity", "1");
      await closesWithLeave(
        page,
        preview,
        '[data-testid="share-preview"]',
        FADE,
        () => preview.locator(".sharePreview-close").click(),
      );
      await pageIsUsable(page, entry, entry);
    });

    // A leaving dialog swallows taps (inert, aria-hidden, still hit-tested):
    // the second click of a double click lands on it and does nothing. With
    // pointer-events: none it would fall through to the page underneath.
    test("a double click on the photo's close button presses nothing underneath", async ({
      page,
    }) => {
      const open = page.locator(".results-photoZoom-btn").first();
      const dialog = page.locator("dialog.results-photoDialog");
      const url = page.url();
      const history = await page.evaluate(() => window.history.length);

      await open.click();
      await expect(dialog).toBeVisible();
      await clearLeaving(page);
      await dialog.locator(".results-photoDialog-close").dblclick();
      await expect
        .poll(() => sawLeaving(page, "dialog.results-photoDialog"))
        .toBe(true);
      await expect(dialog).toHaveCount(0, { timeout: FADE + 300 });
      await page.waitForTimeout(300);
      // Nothing under the button was pressed.
      expect(page.url()).toBe(url);
      expect(await page.evaluate(() => window.history.length)).toBe(history);
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await expect(page.getByTestId("share-preview")).toHaveCount(0);
      await pageIsUsable(page, open, open);
    });

    test("a double click on the share preview's close button presses nothing underneath", async ({
      page,
    }) => {
      const entry = page
        .locator('[data-testid="share-card-button"]:visible')
        .first();
      const preview = page.getByTestId("share-preview");
      const url = page.url();
      const history = await page.evaluate(() => window.history.length);

      await entry.click();
      await expect(preview).toBeVisible();
      await clearLeaving(page);
      await preview.locator(".sharePreview-close").dblclick();
      await expect
        .poll(() => sawLeaving(page, '[data-testid="share-preview"]'))
        .toBe(true);
      await expect(preview).toHaveCount(0, { timeout: FADE + 300 });
      await page.waitForTimeout(300);
      // Not reopened by a share entry underneath, and no navigation.
      await expect(preview).toHaveCount(0);
      expect(page.url()).toBe(url);
      expect(await page.evaluate(() => window.history.length)).toBe(history);
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await pageIsUsable(page, entry, entry);
    });

    test("the delete-scan confirmation fades out on Cancel and on Esc", async ({
      page,
    }) => {
      const trigger = page.getByRole("button", {
        name: "Delete this scan now",
      });
      const backdrop = page.locator(".dialog-backdrop");

      await trigger.click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await closesWithLeave(page, backdrop, ".dialog-backdrop", FADE, () =>
        page.getByRole("button", { name: "Cancel" }).click(),
      );
      await pageIsUsable(page, trigger, trigger);

      await trigger.click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await closesWithLeave(page, backdrop, ".dialog-backdrop", FADE, () =>
        page.keyboard.press("Escape"),
      );
      await pageIsUsable(page, trigger, trigger);
    });
  });

  test.describe("the feedback sheet (a phone)", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    async function openFeedback(page: Page) {
      await stubScan(page, { feedbackAnswered: false });
      await page.clock.install();
      await page.goto(MAIN);
      await expect(page.locator(".results-score-rank")).toBeVisible({
        timeout: 30_000,
      });
      await page.mouse.wheel(0, 400);
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      await page.clock.runFor(RESULT_FEEDBACK_MIN_DWELL_MS + 1_000);
      const sheet = page.locator(".results-feedback-sheet");
      await expect(sheet).toBeVisible();
      await expect
        .poll(() => sheet.evaluate((el) => el.getAnimations().length))
        .toBe(0);
      return sheet;
    }

    test("the X slides it down; focus lands on the page", async ({ page }) => {
      const sheet = await openFeedback(page);
      await closesWithLeave(page, sheet, ".results-feedback", SHEET, () =>
        sheet.locator(".results-feedback-close").click(),
      );
      // The room under the footer goes with it, not before.
      expect(
        await page.evaluate(() =>
          document.documentElement.style.getPropertyValue("--feedback-room"),
        ),
      ).toBe("");
      await pageIsUsable(
        page,
        page.locator("main"),
        page.locator('[data-testid="share-card-button"]:visible').first(),
      );
    });

    test("a double click on its X presses nothing underneath (a tap shield covers it while it leaves)", async ({
      page,
    }) => {
      const sheet = await openFeedback(page);
      const url = page.url();
      const history = await page.evaluate(() => window.history.length);
      await clearLeaving(page);
      await sheet.locator(".results-feedback-close").dblclick();
      await expect.poll(() => sawLeaving(page, ".results-feedback")).toBe(true);
      // The second click landed on the shield, not on what is under the sheet.
      await expect(page.getByTestId("leave-shield")).toHaveCount(1);
      await page.clock.runFor(SHEET + 100);
      await expect(sheet).toHaveCount(0, { timeout: SHEET + 300 });
      await expect(page.getByTestId("leave-shield")).toHaveCount(0);
      expect(page.url()).toBe(url);
      expect(await page.evaluate(() => window.history.length)).toBe(history);
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await expect(page.getByTestId("share-preview")).toHaveCount(0);
    });

    test("a pull on the handle carries it down; focus lands on the page", async ({
      page,
    }) => {
      const sheet = await openFeedback(page);
      const h = (await page.locator(".results-feedback-handle").boundingBox())!;
      const x = h.x + h.width / 2;
      const y = h.y + h.height / 2;
      await clearLeaving(page);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + 90, { steps: 6 });
      await page.mouse.up();
      await expect.poll(() => sawLeaving(page, ".results-feedback")).toBe(true);
      await expect(sheet).toHaveCount(0, { timeout: SHEET + 300 });
      // The handle is not focusable: focus stays where it was, never on the
      // sheet that has gone (checked inside pageIsUsable).
      await pageIsUsable(
        page,
        null,
        page.locator('[data-testid="share-card-button"]:visible').first(),
      );
    });
  });
});
