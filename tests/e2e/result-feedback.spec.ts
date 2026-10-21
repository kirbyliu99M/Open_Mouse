import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { en } from "../../src/lib/copy/result-feedback";
import { RESULT_FEEDBACK_NOTICE_VERSION } from "../../src/lib/contracts/result-feedback";
import { RESULT_FEEDBACK_MIN_DWELL_MS } from "../../src/lib/results/resultFeedback";

/**
 * The results page's feedback sheet (v2) in a real browser. The scan routes and
 * the feedback route are stubbed (no database in e2e); nothing is sent to a
 * real server. The page is English here (Playwright's locale is en-US).
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
) as { scanId: string };

const SCAN_ID = FIXTURE.scanId;
const MAIN = `/results/${SCAN_ID}`;

const ANALYSIS = {
  output: {
    headline: "A close match for your claw grip",
    whyTopPick: "The top pick's length and grip width both land close.",
    tradeoffs: ["It runs slightly heavier than you prefer."],
    whatToAvoid: ["Mice with an aggressive back hump."],
    caveats: [],
  },
  source: "model",
  cached: false,
};

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

interface Stub {
  posts: unknown[];
  /** The statuses the next POSTs answer, in order; 201 after they run out. */
  postStatuses: number[];
}

async function stubScan(
  page: Page,
  options: { answered?: boolean; postStatuses?: number[] } = {},
): Promise<Stub> {
  const stub: Stub = { posts: [], postStatuses: options.postStatuses ?? [] };
  await page.route(`**/api/scans/${SCAN_ID}/fit`, (route) =>
    json(route, 200, FIXTURE),
  );
  await page.route(`**/api/scans/${SCAN_ID}/analysis`, (route) =>
    json(route, 200, ANALYSIS),
  );
  await page.route(`**/api/scans/${SCAN_ID}/measurements`, (route) =>
    json(route, 404, { error: "Scan not found." }),
  );
  await page.route(`**/api/scans/${SCAN_ID}/feedback`, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      return json(route, 200, { answered: options.answered ?? false });
    }
    stub.posts.push(request.postDataJSON());
    const status = stub.postStatuses.shift() ?? 201;
    if (status === 201) {
      return json(route, 201, { stored: true, withdrawable: false });
    }
    return json(route, status, { error: "stub" });
  });
  return stub;
}

/** The accessible name of one star: both numbers come from the page, not the words. */
const star = (n: number) => en.starName(n, 5);

const sheet = (page: Page) => page.locator(".results-feedback-sheet");

async function scrollToEnd(page: Page) {
  await expect(page.locator(".results-score-rank")).toBeVisible();
  // A real scroll, in two steps, so the end marker comes into view after one.
  await page.mouse.wheel(0, 400);
  await page.evaluate(() =>
    window.scrollTo(0, document.documentElement.scrollHeight),
  );
}

/**
 * V3.2 F11 (candidate): reaching the end of the list shows the sheet only
 * once the tab has been visible for `RESULT_FEEDBACK_MIN_DWELL_MS` (20 s).
 * The clock is installed before the page loads and keeps flowing; this moves
 * it past the 20 s.
 */
async function passMinDwell(page: Page) {
  await page.clock.runFor(RESULT_FEEDBACK_MIN_DWELL_MS + 1_000);
}

async function openSheet(page: Page) {
  await page.clock.install();
  await page.goto(MAIN);
  await scrollToEnd(page);
  await passMinDwell(page);
  await expect(sheet(page)).toBeVisible();
  // Let the entrance finish, so a measured box is the resting one.
  await expect
    .poll(() => sheet(page).evaluate((el) => el.getAnimations().length))
    .toBe(0);
}

test.describe("feedback sheet v2", () => {
  test("A, B, C: stars first, then the comment and the pill, then the data note", async ({
    page,
  }) => {
    await stubScan(page);
    await openSheet(page);

    // A non-modal dialog named by its title.
    await expect(page.getByRole("dialog", { name: en.title })).toBeVisible();
    expect(
      await page.locator(".results-feedback").getAttribute("aria-modal"),
    ).toBeNull();

    // A: the title, five unchecked stars, the data link; no box, no pill.
    await expect(sheet(page).getByText(en.title)).toBeVisible();
    // 1 and 5 are described for a screen reader, since the end labels are for the eye.
    await expect(sheet(page).getByLabel(star(1))).toHaveAccessibleDescription(
      en.lowHint(1),
    );
    await expect(sheet(page).getByLabel(star(5))).toHaveAccessibleDescription(
      en.highHint(5),
    );
    const radios = sheet(page).getByRole("radio");
    await expect(radios).toHaveCount(5);
    await expect(sheet(page).getByRole("radio", { checked: true })).toHaveCount(
      0,
    );
    await expect(sheet(page).locator(".results-feedback-primary")).toHaveCount(
      0,
    );
    await expect(sheet(page).locator("textarea")).toBeHidden();
    const link = sheet(page).getByRole("button", { name: en.dataLink });
    await expect(link).toHaveAttribute("aria-expanded", "false");

    // B: a star opens the comment box and the pill; the focus is not moved.
    await sheet(page).getByLabel(star(4)).check({ force: true });
    await expect(sheet(page).getByLabel(star(4))).toBeChecked();
    await expect(sheet(page).locator("textarea")).toBeVisible();
    await expect(sheet(page).locator("textarea")).not.toBeFocused();
    await expect(sheet(page).locator(".results-feedback-count")).toHaveText(
      "0 / 500",
    );
    const pill = sheet(page).getByRole("button", { name: en.send });
    await expect(pill).toBeVisible();
    await expect(sheet(page).locator('label[data-filled="true"]')).toHaveCount(
      4,
    );
    // A tap on another star changes the count.
    await sheet(page).getByLabel(star(2)).check({ force: true });
    await expect(sheet(page).locator('label[data-filled="true"]')).toHaveCount(
      2,
    );
    await sheet(page).locator("textarea").fill("abc");
    await expect(sheet(page).locator(".results-feedback-count")).toHaveText(
      "3 / 500",
    );

    // C: the data note opens in place, then folds.
    await link.click();
    await expect(link).toHaveAttribute("aria-expanded", "true");
    await expect(sheet(page).getByText(en.keptBody)).toBeVisible();
    await expect(sheet(page).getByText(en.notKeptBody)).toBeVisible();
    await expect(sheet(page).getByText(en.withdrawBody)).toBeVisible();
    await link.click();
    await expect(link).toHaveAttribute("aria-expanded", "false");
    await expect(sheet(page).getByText(en.keptBody)).toBeHidden();
  });

  test("keyboard: arrows move between the stars, and the group is named", async ({
    page,
  }) => {
    await stubScan(page);
    await openSheet(page);
    await sheet(page).getByLabel(star(3)).focus();
    await page.keyboard.press("ArrowRight");
    await expect(sheet(page).getByLabel(star(4))).toBeChecked();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(sheet(page).getByLabel(star(2))).toBeChecked();
    await expect(
      sheet(page).getByRole("group", { name: en.starsGroup }),
    ).toBeVisible();
  });

  test("submit: sends the notice version, shows thanks, closes by itself, and does not come back", async ({
    page,
  }) => {
    const stub = await stubScan(page);
    await openSheet(page);
    await sheet(page).getByLabel(star(5)).check({ force: true });
    await sheet(page).locator("textarea").fill("  G305 too low  ");
    await sheet(page).getByRole("button", { name: en.send }).click();

    await expect(sheet(page).getByText(en.done)).toBeVisible();
    expect(stub.posts).toEqual([
      {
        notice: RESULT_FEEDBACK_NOTICE_VERSION,
        stars: 5,
        comment: "G305 too low",
        locale: "en",
      },
    ]);
    // The live region announces it without moving the focus.
    await expect(
      page.getByRole("status").filter({ hasText: en.done }),
    ).toHaveCount(1);
    await expect(sheet(page)).toBeHidden({ timeout: 8000 });

    await page.reload();
    await scrollToEnd(page);
    await page.waitForTimeout(800);
    await expect(sheet(page)).toHaveCount(0);
  });

  test("a failed send is shown under the box, the pill says try again, and a second try works", async ({
    page,
  }) => {
    const stub = await stubScan(page, { postStatuses: [500] });
    await openSheet(page);
    await sheet(page).getByLabel(star(2)).check({ force: true });
    const pill = sheet(page).getByRole("button", { name: en.send });
    const before = await pill.boundingBox();
    await pill.click();

    await expect(sheet(page).getByRole("alert")).toHaveText(en.sendFailed);
    const retry = sheet(page).getByRole("button", { name: en.retry });
    await expect(retry).toBeVisible();
    // The pill keeps its width whichever word it carries.
    const after = await retry.boundingBox();
    expect(Math.abs((after?.width ?? 0) - (before?.width ?? 1))).toBeLessThan(
      1,
    );

    await retry.click();
    await expect(sheet(page).getByText(en.done)).toBeVisible();
    expect(stub.posts).toHaveLength(2);
  });

  test("Escape closes, focus lands in the page, and the choice is remembered", async ({
    page,
  }) => {
    const stub = await stubScan(page);
    await openSheet(page);
    await sheet(page).getByLabel(star(3)).focus();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    expect(stub.posts).toHaveLength(0);
    const focused = await page.evaluate(
      () => document.activeElement?.tagName.toLowerCase() ?? "",
    );
    expect(focused).toBe("main");

    await page.reload();
    await scrollToEnd(page);
    await page.waitForTimeout(800);
    await expect(sheet(page)).toHaveCount(0);
  });

  test("the X is named for what closing means", async ({ page }) => {
    await stubScan(page);
    await openSheet(page);
    const close = sheet(page).getByRole("button", { name: en.closeLabel });
    await expect(close).toBeVisible();
    const box = await close.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await close.click();
    await expect(sheet(page)).toHaveCount(0);
  });

  test("an already rated scan never shows the sheet", async ({ page }) => {
    await stubScan(page, { answered: true });
    await page.goto(MAIN);
    await scrollToEnd(page);
    await page.waitForTimeout(800);
    await expect(sheet(page)).toHaveCount(0);
  });

  test("it does not cover the page: no backdrop, and the footer and share button scroll above it", async ({
    page,
  }) => {
    await stubScan(page);
    await openSheet(page);
    await sheet(page).getByLabel(star(3)).check({ force: true });
    // Nothing in the page is blocked behind a scrim.
    expect(await page.locator("dialog[open]").count()).toBe(0);
    // The sheet never grows past 60 % of the window height.
    const viewport = page.viewportSize()!;
    const sheetBox = (await sheet(page).boundingBox())!;
    expect(sheetBox.height).toBeLessThanOrEqual(viewport.height * 0.6 + 1);

    // At the very bottom of the page, the whole footer is above the sheet.
    // (The page grows by the sheet's height, so keep scrolling until it is settled.)
    await expect
      .poll(() =>
        page.evaluate(() => {
          window.scrollTo(0, document.documentElement.scrollHeight);
          // The comment box opens over 200 ms: wait until nothing is moving.
          if (document.getAnimations().length > 0) return false;
          return (
            Math.abs(
              window.scrollY +
                window.innerHeight -
                document.documentElement.scrollHeight,
            ) < 2
          );
        }),
      )
      .toBe(true);
    const footer = (await page.locator(".siteFooter").boundingBox())!;
    const top = (await sheet(page).boundingBox())!.y;
    expect(footer.y + footer.height).toBeLessThanOrEqual(top + 1);
    // And the share button too.
    const share = page
      .locator('[data-testid="share-card-button"]:visible')
      .last();
    const shareBox = (await share.boundingBox())!;
    expect(shareBox.y + shareBox.height).toBeLessThanOrEqual(top + 1);
  });

  test("the timer alone does not show it on a page that can scroll", async ({
    page,
  }) => {
    await page.clock.install();
    await stubScan(page);
    await page.goto(MAIN);
    await expect(page.locator(".results-score-rank")).toBeVisible();
    await page.clock.runFor(60_000);
    await expect(sheet(page)).toHaveCount(0);
    // Once the person scrolls (not to the end), the visible 45 s has already
    // passed, so it shows.
    await page.mouse.wheel(0, 200);
    await page.clock.runFor(2_000);
    await expect(sheet(page)).toBeVisible();
  });

  test("Escape is ignored while an input method is composing, and keeps a typed comment", async ({
    page,
  }) => {
    await stubScan(page);
    await openSheet(page);
    await sheet(page).getByLabel(star(3)).check({ force: true });
    await sheet(page).locator("textarea").focus();
    // The Escape of an IME candidate window.
    await page.evaluate(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: true,
          bubbles: true,
        }),
      );
    });
    await expect(sheet(page)).toBeVisible();
    // A typed comment is not thrown away by Escape; the X still closes.
    await sheet(page).locator("textarea").fill("G305 too low");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await expect(sheet(page)).toBeVisible();
    // Once it is empty, Escape closes.
    await sheet(page).locator("textarea").fill("");
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
  });

  test("a 409 (already sent) keeps the focus in the sheet, Escape closes it, and it is remembered", async ({
    page,
  }) => {
    const stub = await stubScan(page, { postStatuses: [409] });
    await openSheet(page);
    await sheet(page).getByLabel(star(3)).check({ force: true });
    await sheet(page).getByRole("button", { name: en.send }).click();
    await expect(sheet(page).getByText(en.already)).toBeVisible();
    expect(stub.posts).toHaveLength(1);
    const inside = () =>
      page.evaluate(
        () => !!document.activeElement?.closest(".results-feedback"),
      );
    await expect.poll(inside).toBe(true);
    await expect(
      sheet(page).getByRole("button", { name: en.ok }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);

    await page.reload();
    await scrollToEnd(page);
    await page.waitForTimeout(800);
    await expect(sheet(page)).toHaveCount(0);
  });

  test("only the time the tab is visible counts toward the 45 s", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      let state = "visible";
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => state,
      });
      (
        window as unknown as { __setVisibility: (value: string) => void }
      ).__setVisibility = (value) => {
        state = value;
      };
    });
    const setVisibility = (value: "visible" | "hidden") =>
      page.evaluate(
        (v) =>
          (
            window as unknown as { __setVisibility: (x: string) => void }
          ).__setVisibility(v),
        value,
      );
    await page.clock.install();
    await stubScan(page);
    await page.goto(MAIN);
    await expect(page.locator(".results-score-rank")).toBeVisible();
    await page.mouse.wheel(0, 200); // a real scroll, so only the timer is left
    await setVisibility("hidden");
    await page.clock.runFor(120_000);
    await expect(sheet(page)).toHaveCount(0);
    await setVisibility("visible");
    await page.clock.runFor(30_000);
    await expect(sheet(page)).toHaveCount(0);
    await page.clock.runFor(20_000);
    await expect(sheet(page)).toBeVisible();
  });
});

test.describe("feedback sheet v2: forced colors", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the comment box keeps a visible focus outline in Windows high contrast", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await stubScan(page);
    await openSheet(page);
    await sheet(page).getByLabel(star(3)).check({ force: true });
    await sheet(page).locator("textarea").focus();
    const outline = await sheet(page)
      .locator("textarea")
      .evaluate((el) => {
        const css = getComputedStyle(el);
        return { style: css.outlineStyle, width: parseFloat(css.outlineWidth) };
      });
    expect(outline.style).toBe("solid");
    expect(outline.width).toBeGreaterThanOrEqual(2);
  });
});

test.describe("feedback sheet v2: small phones", () => {
  for (const size of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
  ]) {
    test(`${size.width}x${size.height}: the submit pill and the data link stay in view at the bottom of the sheet`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await stubScan(page);
      await openSheet(page);
      await sheet(page).getByLabel(star(3)).check({ force: true });
      const check = async () => {
        const box = (await sheet(page).boundingBox())!;
        const pill = (await sheet(page)
          .getByRole("button", { name: en.send })
          .boundingBox())!;
        const link = (await sheet(page)
          .getByRole("button", { name: en.dataLink })
          .boundingBox())!;
        expect(pill.y).toBeGreaterThanOrEqual(box.y);
        expect(pill.y + pill.height).toBeLessThanOrEqual(
          box.y + box.height + 1,
        );
        expect(pill.y + pill.height).toBeLessThanOrEqual(size.height);
        expect(link.y + link.height).toBeLessThanOrEqual(size.height);
      };
      await check();
      // With the data note open, the row is still the bottom row of the sheet.
      await sheet(page).getByRole("button", { name: en.dataLink }).click();
      await page.waitForTimeout(400);
      await check();
    });
  }
});

test.describe("feedback sheet v2: a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("is a bottom sheet with a handle; pulling it down more than 64 px closes it", async ({
    page,
  }) => {
    await stubScan(page);
    await openSheet(page);
    const box = (await sheet(page).boundingBox())!;
    expect(box.width).toBeCloseTo(390, 0);
    expect(box.y + box.height).toBeCloseTo(844, 0);
    const handle = page.locator(".results-feedback-handle");
    await expect(handle).toBeVisible();
    const h = (await handle.boundingBox())!;
    const x = h.x + h.width / 2;
    const y = h.y + h.height / 2;

    // A short pull springs back.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 40, { steps: 5 });
    await page.mouse.up();
    await expect(sheet(page)).toBeVisible();
    // Wait for the spring back, so the handle is where it was.
    await expect
      .poll(() => sheet(page).evaluate((el) => el.getAnimations().length))
      .toBe(0);
    await expect(sheet(page)).toHaveCSS("transform", "none");

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 90, { steps: 6 });
    await page.mouse.up();
    await expect(sheet(page)).toHaveCount(0);

    await page.reload();
    await scrollToEnd(page);
    await page.waitForTimeout(800);
    await expect(sheet(page)).toHaveCount(0);
  });

  test("a real touch pull on the handle closes it (and does not scroll the page)", async ({
    page,
  }) => {
    await stubScan(page);
    await openSheet(page);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const h = (await page.locator(".results-feedback-handle").boundingBox())!;
    const x = h.x + h.width / 2;
    const y = h.y + h.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", dy: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y: y + dy }],
      });
    await touch("touchStart", 0);
    for (let dy = 15; dy <= 90; dy += 15) await touch("touchMove", dy);
    await touch("touchEnd", 90);
    await expect(sheet(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  });

  test("reduced motion: the sheet does not follow the pull, and the pull still closes it", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubScan(page);
    await openSheet(page);
    const h = (await page.locator(".results-feedback-handle").boundingBox())!;
    const x = h.x + h.width / 2;
    const y = h.y + h.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 30, { steps: 3 });
    const transform = await sheet(page).evaluate(
      (el) => (el as HTMLElement).style.transform,
    );
    expect(transform).toBe("");
    await page.mouse.move(x, y + 100, { steps: 3 });
    await page.mouse.up();
    await expect(sheet(page)).toHaveCount(0);
  });
});

test.describe("feedback sheet v2: a small phone", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("the data link and the pill share a row in English, and a jump past the end marker shows the sheet", async ({
    page,
  }) => {
    await stubScan(page);
    await page.clock.install();
    await page.goto(MAIN);
    await expect(page.locator(".results-score-rank")).toBeVisible();
    // A jump to the very bottom: the end marker is never in view.
    await page.mouse.wheel(0, 300);
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await passMinDwell(page);
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByLabel(star(3)).check({ force: true });
    const link = await sheet(page)
      .getByRole("button", { name: en.dataLink })
      .boundingBox();
    const pill = await sheet(page)
      .getByRole("button", { name: en.send })
      .boundingBox();
    expect(Math.abs((link?.y ?? 0) - (pill?.y ?? 99))).toBeLessThan(8);
  });
});

test.describe("feedback sheet v2: axe", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("no WCAG 2.2 AA violation in the sheet's four states", async ({
    page,
  }) => {
    await stubScan(page, { postStatuses: [500] });
    await openSheet(page);
    const scan = async (state: string) => {
      // Let any opening or closing finish, so the colours are the resting ones.
      await page.waitForTimeout(400);
      const results = await new AxeBuilder({ page })
        .include(".results-feedback")
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        results.violations.map((v) => `${state}: ${v.id}`),
        JSON.stringify(
          results.violations.map((v) => v.nodes.map((n) => n.html)),
        ),
      ).toEqual([]);
    };
    await scan("A");
    await sheet(page).getByLabel(star(4)).check({ force: true });
    await scan("B");
    await sheet(page).getByRole("button", { name: en.dataLink }).click();
    await scan("C");
    await sheet(page).getByRole("button", { name: en.dataLink }).click();
    await sheet(page).getByRole("button", { name: en.send }).click();
    await expect(sheet(page).getByRole("alert")).toBeVisible();
    await scan("E");
  });
});

test.describe("feedback sheet v2: a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("is a floating card at the bottom right, 400 px wide, without a handle", async ({
    page,
  }) => {
    await stubScan(page);
    await openSheet(page);
    const box = (await sheet(page).boundingBox())!;
    expect(box.width).toBeCloseTo(400, 0);
    expect(1280 - (box.x + box.width)).toBeCloseTo(24, 0);
    expect(800 - (box.y + box.height)).toBeCloseTo(24, 0);
    await expect(page.locator(".results-feedback-handle")).toBeHidden();
  });
});
