import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * /learn, the information page (candidate wording; see
 * src/lib/copy/learn-page.ts). Not run by the builder who wrote it (no
 * Playwright on that machine): the first run is for whoever reviews the PR.
 * The learning kit moved to /learn/kit and answers only on `next dev`, which
 * is what this suite runs.
 */
test.describe("/learn information page", () => {
  test("shows the title, six cards in order, the chart and the button, with no digits", async ({
    page,
  }) => {
    await page.goto("/learn");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "How to choose a mouse that fits",
      }),
    ).toBeVisible();
    const cards = page.locator("ol.learn-cards > li");
    await expect(cards).toHaveCount(6);
    await expect(cards.locator("h2")).toHaveText([
      /Know your hand/,
      /Know your grip/,
      /Match the size/,
      /Look at the shape/,
      /Weight and connection/,
      /How we score/,
    ]);
    for (const label of [
      "Length",
      "Grip width",
      "Height and hump",
      "Front flare",
      "Thumb rest",
      "Weight",
    ]) {
      await expect(
        page.locator(".learn-bar-label", { hasText: new RegExp(`^${label}$`) }),
      ).toBeVisible();
    }
    await expect(page.getByText("Longer bar = counts more")).toBeVisible();
    // The longest bar is the widest, and the weight bar the shortest.
    const widths = await page
      .locator(".learn-bar")
      .evaluateAll((bars) => bars.map((b) => b.getBoundingClientRect().width));
    expect(widths).toHaveLength(6);
    expect(widths[0]).toBeGreaterThan(widths[5]);
    // Hard rule 2 and the brief: the page shows no number. "A4" is a paper name.
    const text = (await page.locator("main").innerText()).replaceAll("A4", "");
    expect(text).not.toMatch(/\d/);
  });

  test("links go to the scan and to How it works, and the primary button scans", async ({
    page,
  }) => {
    await page.goto("/learn");
    await expect(
      page.getByRole("link", { name: /^Scan my hand ›$/ }),
    ).toHaveAttribute("href", "/scan/easy");
    await expect(
      page.getByRole("link", { name: /^How it works ›$/ }),
    ).toHaveAttribute("href", "/how-it-works");
    const button = page.getByRole("link", {
      name: "Scan my hand",
      exact: true,
    });
    await expect(button).toHaveAttribute("href", "/scan/easy");
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test("the three grip drawings sit side by side, also on a phone", async ({
    page,
  }) => {
    await page.goto("/learn");
    const images = page.locator(".learn-grips img");
    await expect(images).toHaveCount(3);
    await images.last().scrollIntoViewIfNeeded();
    const boxes = await images.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width };
      }),
    );
    expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBe(1);
    expect(boxes[0].x).toBeLessThan(boxes[1].x);
    expect(boxes[1].x).toBeLessThan(boxes[2].x);
    for (const b of boxes) expect(b.w).toBeGreaterThanOrEqual(90);
  });

  test("card 4 shows the two mouse drawings with the results page's shape words", async ({
    page,
  }) => {
    await page.goto("/learn");
    const mice = page.locator(".learn-mice img");
    await expect(mice).toHaveCount(2);
    await expect(page.locator(".learn-mice figcaption")).toHaveText([
      "Symmetrical",
      "Ergonomic",
    ]);
  });

  test("on a wide screen the cards sit on the fixed grid: 1 and 2 share a row, 5 is under 3, 4 spans both, 6 is full width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/learn");
    const box = async (id: string) => {
      const b = await page.locator(`.learn-card--${id}`).boundingBox();
      if (!b) throw new Error(`no card ${id}`);
      return b;
    };
    const [hand, grip, size, shape, weight, score] = await Promise.all(
      ["hand", "grip", "size", "shape", "weight", "score"].map(box),
    );
    expect(Math.abs(hand.y - grip.y)).toBeLessThan(2);
    expect(hand.x).toBeLessThan(grip.x);
    expect(Math.abs(size.x - weight.x)).toBeLessThan(2);
    expect(weight.y).toBeGreaterThan(size.y + size.height - 1);
    expect(shape.x).toBeGreaterThan(size.x);
    expect(shape.height).toBeGreaterThan(size.height + weight.height - 2);
    expect(score.width).toBeGreaterThan(hand.width * 1.9);
    expect(score.y).toBeGreaterThan(shape.y + shape.height - 1);
  });

  test("the footer's Learn link opens this page, not the kit", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByTestId("site-footer")
      .getByRole("link", { name: "Learn" })
      .click();
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.locator("ol.learn-cards")).toBeVisible();
  });

  test("has no axe violations", async ({ page }) => {
    await page.goto("/learn");
    await expect(page.locator("ol.learn-cards")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("answers in zh-TW for a zh-TW visitor", async ({ browser }) => {
    const context = await browser.newContext({ locale: "zh-TW" });
    const page = await context.newPage();
    await page.goto("/learn");
    await expect(
      page.getByRole("heading", { level: 1, name: "怎麼挑一支合手的滑鼠" }),
    ).toBeVisible();
    await expect(page.getByText("條越長影響越大")).toBeVisible();
    await context.close();
  });
});

test.describe("the learning kit moved to /learn/kit", () => {
  test("the kit index answers on next dev", async ({ page }) => {
    await page.goto("/learn/kit");
    await expect(
      page.getByRole("heading", { level: 1, name: "Learning kit" }),
    ).toBeVisible();
  });
});
