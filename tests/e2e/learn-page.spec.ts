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
  test("shows the title, five cards in order, the chart and the button, with no digits", async ({
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
    await expect(cards).toHaveCount(5);
    await expect(cards.locator("h2")).toHaveText([
      /Know your hand/,
      /Know your grip/,
      /Match the size/,
      /Look at the shape/,
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
    // Hard rule 2 and the brief: the page shows no number. "A4" is a paper
    // name, and the step badges 1 to 5 are the order of the steps (they are
    // aria-hidden but still in innerText, so they are taken out of a clone
    // first). Every other digit fails. textContent also covers the sentences
    // that are visually hidden on a wide screen.
    const text = (
      await page.locator("main").evaluate((main) => {
        const clone = main.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(".learn-card-number").forEach((n) => n.remove());
        return clone.textContent ?? "";
      })
    ).replaceAll("A4", "");
    expect(text).not.toMatch(/\d/);
  });

  test("links go to the scan and to How it works, and the primary button scans", async ({
    page,
  }) => {
    await page.goto("/learn");
    // The chevron is aria-hidden, so the names do not include it; and each
    // link is looked for inside its own card, because "Scan my hand" is also
    // the name of the button at the bottom.
    await expect(
      page
        .locator(".learn-card--hand")
        .getByRole("link", { name: "Scan my hand", exact: true }),
    ).toHaveAttribute("href", "/scan/easy");
    await expect(
      page
        .locator(".learn-card--score")
        .getByRole("link", { name: "How it works", exact: true }),
    ).toHaveAttribute("href", "/how-it-works");
    const button = page
      .locator(".learn-info-cta")
      .and(page.getByRole("link", { name: "Scan my hand", exact: true }));
    await expect(button).toHaveCount(1);
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

  test("card 4 shows four tiles, each with its drawing, its text marks and its name", async ({
    page,
  }) => {
    await page.goto("/learn");
    await expect(page.locator(".learn-shape-tile")).toHaveCount(4);
    // 4 base drawings + 4 arrow overlays, all decorative.
    await expect(page.locator(".learn-shape img")).toHaveCount(8);
    await expect(page.locator(".learn-shape figcaption")).toHaveText([
      "Symmetrical",
      "Ergonomic",
      "Hump",
      "Flare",
    ]);
    // The marks are real text, in the page for a screen reader too.
    for (const mark of [
      "Centred peak",
      "Rear peak",
      "Schematic: exaggerated flare",
    ]) {
      await expect(
        page.locator(".learn-shape-mark", { hasText: mark }),
      ).toHaveCount(1);
    }
    const sizes = await page
      .locator(".learn-shape-mark")
      .evaluateAll((marks) =>
        marks.map((m) => parseFloat(getComputedStyle(m).fontSize)),
      );
    expect(sizes).toHaveLength(7);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(12);
  });

  test("no sketch mark spills out of its tile, and the tiles are four across, two across or one, by width", async ({
    page,
  }) => {
    const columns = async () =>
      new Set(
        await page
          .locator(".learn-shape-tile")
          .evaluateAll((tiles) =>
            tiles.map((t) => Math.round(t.getBoundingClientRect().x)),
          ),
      ).size;
    const spill = () =>
      page.locator(".learn-shape-tile").evaluateAll((tiles) =>
        tiles.flatMap((tile) => {
          const box = tile.getBoundingClientRect();
          return [...tile.querySelectorAll(".learn-shape-mark")]
            .filter((m) => {
              const r = m.getBoundingClientRect();
              return (
                r.left < box.left - 0.5 ||
                r.right > box.right + 0.5 ||
                r.top < box.top - 0.5 ||
                r.bottom > box.bottom + 0.5
              );
            })
            .map((m) => m.textContent);
        }),
      );
    for (const [width, across] of [
      [1440, 4],
      [900, 2],
      [390, 1],
      [320, 1],
    ] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/learn");
      await page.locator(".learn-shapes").scrollIntoViewIfNeeded();
      expect(await columns(), `${width} px`).toBe(across);
      expect(await spill(), `${width} px`).toEqual([]);
    }
  });

  test("on a wide screen the cards sit on the fixed grid: 1 and 2 share a row, then 3, 4 and 5 each take the full width in order", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/learn");
    const box = async (id: string) => {
      const b = await page.locator(`.learn-card--${id}`).boundingBox();
      if (!b) throw new Error(`no card ${id}`);
      return b;
    };
    const [hand, grip, size, shape, score] = await Promise.all(
      ["hand", "grip", "size", "shape", "score"].map(box),
    );
    expect(Math.abs(hand.y - grip.y)).toBeLessThan(2);
    expect(hand.x).toBeLessThan(grip.x);
    // 3, 4 and 5 (the chart) are as wide as 1 and 2 together, stacked in order.
    for (const full of [size, shape, score]) {
      expect(full.width).toBeGreaterThan(hand.width * 1.9);
      expect(Math.abs(full.x - hand.x)).toBeLessThan(2);
    }
    expect(size.y).toBeGreaterThan(hand.y + hand.height - 1);
    expect(shape.y).toBeGreaterThan(size.y + size.height - 1);
    expect(score.y).toBeGreaterThan(shape.y + shape.height - 1);
    // The compact card 3 is about 116 px high.
    expect(size.height).toBeLessThan(160);
  });

  test("nothing scrolls sideways at 320 px wide", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/learn");
    await expect(page.locator(".learn-shape-tile")).toHaveCount(4);
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);
  });

  test("between 56rem and 70rem card 1 stacks, and from 70rem its text column is at least 200 px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto("/learn");
    const text = page.locator(".learn-card--hand p").first();
    const image = page.locator(".learn-card--hand .learn-figure");
    const [t, i] = [await text.boundingBox(), await image.boundingBox()];
    expect(i!.y).toBeGreaterThan(t!.y + t!.height - 1);
    // 1200 px, not the 1120 px edge of the breakpoint: the text column is then
    // about 244 px (card 518 px inside its padding, less the 250 px drawing and
    // the 24 px gap), so 200 px leaves room for a scrollbar.
    await page.setViewportSize({ width: 1200, height: 800 });
    const wide = await text.boundingBox();
    expect(wide!.width).toBeGreaterThanOrEqual(200);
    const side = await image.boundingBox();
    expect(side!.x).toBeGreaterThan(wide!.x + wide!.width - 1);
  });

  test("the grip names are read once: the visible captions are hidden from a screen reader", async ({
    page,
  }) => {
    await page.goto("/learn");
    await expect(page.locator(".learn-grips figcaption")).toHaveCount(3);
    for (const caption of await page.locator(".learn-grips figcaption").all()) {
      await expect(caption).toHaveAttribute("aria-hidden", "true");
    }
    await expect(page.locator(".learn-grips-text dt")).toHaveText([
      "Palm",
      "Claw",
      "Fingertip",
    ]);
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
