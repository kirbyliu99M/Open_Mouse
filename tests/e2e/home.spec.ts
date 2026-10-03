import { expect, test } from "@playwright/test";

const CAPTION = "G Pro X Superlight 2 · sketch";
const PREVIEW_NOTE = "Early preview — measurements are still being validated.";

test("home shows the headline, the story's three parts and the CTA destinations", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Find the mouse that fits.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("A blank sheet of A4 and your phone are all it takes."),
  ).toBeVisible();

  // The buttons and the Early preview note appear twice: in the hero and in
  // the final section. Each locator is scoped to its region, so Playwright's
  // strict mode never meets two elements.
  for (const region of ["home-hero", "home-final"]) {
    const scope = page.getByTestId(region);
    await expect(
      scope.getByRole("link", { name: "Scan my hand" }),
    ).toHaveAttribute("href", "/scan/easy");
    await expect(
      scope.getByRole("link", { name: "How it works" }),
    ).toHaveAttribute("href", "/how-it-works");
    await expect(scope.locator(".landing-preview-note")).toHaveText(
      PREVIEW_NOTE,
    );
  }
  await expect(page.getByRole("link", { name: "Scan my hand" })).toHaveCount(2);
  await expect(page.getByRole("link", { name: "How it works" })).toHaveCount(2);
  await expect(page.getByText(PREVIEW_NOTE)).toHaveCount(2);

  // The three mice: each one's name is real text under its sketch.
  const captions = page.getByText(CAPTION);
  await expect(captions).toHaveCount(3);
  for (let i = 0; i < 3; i += 1) await expect(captions.nth(i)).toBeVisible();
  await expect(page.locator(".story-mouse img")).toHaveCount(3);

  await expect(
    page.getByText(
      "Not affiliated with Logitech. Sizes from Logitech's published specs.",
    ),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("home no longer carries the removed lines: the taglines, 'Measure your hand.', the catalogue count, the sketch's dimensions and the photo-privacy sentence", async ({
  page,
}) => {
  await page.goto("/");
  const body = page.locator("body");
  // The three taglines under the CTA.
  for (const tagline of [
    "One photo. No printing.",
    "Ranked for your hand, not the hype.",
    "Private by design.",
  ]) {
    await expect(body.getByText(tagline)).toHaveCount(0);
  }
  await expect(page.locator(".landing-points")).toHaveCount(0);
  // The line above the headline, in every language.
  await expect(body.getByText("Measure your hand.")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 1, name: /Measure your hand/ }),
  ).toHaveCount(0);
  // The catalogue-count sentence and the old sketch's dimension line.
  await expect(body.getByText(/Logitech mice scored on/)).toHaveCount(0);
  await expect(page.locator(".landing-dimension")).toHaveCount(0);
  await expect(page.locator(".landing-annotation")).toHaveCount(0);
  // The photo-privacy promise is not on the home page (Kirby, 2026-10-03). It
  // stays on How it works, the scan screens and the camera.
  await expect(body.getByText(/never leaves/)).toHaveCount(0);
  await expect(body.getByText(/Only measurements are sent/)).toHaveCount(0);
});

test("How it works still carries the photo-privacy promise that left the home page", async ({
  page,
}) => {
  await page.goto("/how-it-works");
  await expect(
    page.getByText(
      "Your photo never leaves your phone. Only measurements are sent.",
    ),
  ).toBeVisible();
});

test("the h1 comes first; the logo, the hand and the sketches are decorative and follow it", async ({
  page,
}) => {
  await page.goto("/");
  const order = await page.evaluate(() => {
    const h1 = document.querySelector("h1")!;
    const images = [...document.querySelectorAll("section.story img")];
    return {
      images: images.map((img) => ({
        alt: img.getAttribute("alt"),
        src: img.getAttribute("src"),
        // 4 = the image follows the h1 in document order.
        afterH1: Boolean(
          h1.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        // The logo is the one image that sits before the h1.
        beforeH1: Boolean(
          h1.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_PRECEDING,
        ),
      })),
      main: document.querySelectorAll("main").length,
      h1s: document.querySelectorAll("h1").length,
    };
  });
  expect(order.main).toBe(1);
  expect(order.h1s).toBe(1);
  // logo, hand, then the three mice
  expect(order.images.map((i) => i.src)).toEqual([
    "/images/logo-placeholder.svg",
    "/images/hand-on-a4.svg",
    "/images/sketches/g-pro-sketch.svg",
    "/images/sketches/g-pro-sketch.svg",
    "/images/sketches/g-pro-sketch.svg",
  ]);
  // Decorative: an empty alt. The wordmark in the nav names the site and each
  // mouse's caption names the mouse, so nothing here needs a description.
  for (const image of order.images) expect(image.alt).toBe("");
  expect(order.images[0]!.beforeH1).toBe(true);
  for (const image of order.images.slice(1)) expect(image.afterH1).toBe(true);
});

test("every home image loads, and the page is one dark theme whatever the system asks for", async ({
  page,
}) => {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll("img")]
        .filter((img) => !img.complete || img.naturalWidth === 0)
        .map((img) => img.getAttribute("src")),
    );
    expect(bad, colorScheme).toEqual([]);
    expect(
      await page.evaluate(() => getComputedStyle(document.body).color),
      colorScheme,
    ).toBe("rgb(245, 245, 247)");
    // The page background is the --bg token, on the root.
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).backgroundColor,
      ),
      colorScheme,
    ).toBe("rgb(6, 7, 9)");
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).colorScheme,
      ),
      colorScheme,
    ).toBe("dark");
  }
});

test("print stays light: a white page with black text", async ({ page }) => {
  await page.goto("/");
  await page.emulateMedia({ media: "print" });
  const colours = await page.evaluate(() => ({
    root: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    text: getComputedStyle(document.body).color,
  }));
  expect(colours.root).toBe("rgb(255, 255, 255)");
  expect(colours.text).toBe("rgb(0, 0, 0)");
  // The body has no background of its own, so the white root shows through.
  expect(["rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"]).toContain(colours.body);
});

test.describe("the two buttons", () => {
  type Box = { x: number; y: number; width: number; height: number };

  /** Where the hero's two buttons sit, and how wide the row they live in is. */
  async function layout(page: import("@playwright/test").Page) {
    return page.evaluate(() => {
      const box = (el: Element): Box => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      const hero = document.querySelector('[data-testid="home-hero"]')!;
      const scan = hero.querySelector(".home-cta")!;
      const how = hero.querySelector(".home-cta-secondary")!;
      const row = hero.querySelector(".home-actions")!;
      return {
        scan: box(scan),
        how: box(how),
        row: box(row),
        scanScrolls: scan.scrollWidth > scan.clientWidth + 1,
        howScrolls: how.scrollWidth > how.clientWidth + 1,
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      };
    });
  }

  for (const [width, height] of [
    [320, 568],
    [360, 640],
    [375, 667],
    [390, 844],
    [1440, 900],
  ] as const) {
    // The rule is font-independent: a button is never narrower than its own
    // label, so the pair sits on one line when both fit and stacks, each at
    // the full width of the row and the primary on top, when they do not. How
    // many viewports fit depends on the font (Linux's is a quarter wider than
    // Windows'), so this checks the rule, not which side of it a width is on.
    test(`${width}x${height}: one row, or stacked at full width with the primary on top; never a clipped or broken label`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const { scan, how, row, scanScrolls, howScrolls, rem } =
        await layout(page);
      // Each is a real touch target and a pill.
      for (const button of [scan, how]) {
        expect(button.height).toBeGreaterThanOrEqual(44);
        // One line of label: never taller than the 3.125rem minimum plus slack.
        expect(button.height).toBeLessThan(3.125 * rem + 8);
      }
      expect(scanScrolls).toBe(false);
      expect(howScrolls).toBe(false);
      const sameRow = Math.abs(scan.y - how.y) < 2;
      if (sameRow) {
        expect(scan.x).toBeLessThan(how.x);
        // Both inside the row, with the 0.75rem gap between them.
        expect(how.x + how.width).toBeLessThanOrEqual(row.x + row.width + 1);
        expect(how.x - (scan.x + scan.width)).toBeGreaterThanOrEqual(
          0.75 * rem - 1,
        );
      } else {
        expect(how.y).toBeGreaterThanOrEqual(scan.y + scan.height);
        expect(scan.width).toBeGreaterThanOrEqual(row.width - 1);
        expect(how.width).toBeGreaterThanOrEqual(row.width - 1);
      }
      // Whatever the state, nothing sticks out of the viewport.
      for (const button of [scan, how]) {
        expect(button.x).toBeGreaterThanOrEqual(0);
        expect(button.x + button.width).toBeLessThanOrEqual(width);
      }
    });
  }

  test("320 wide: they no longer fit, so they stack at full width, the primary on top", async ({
    page,
  }) => {
    // 10 rem + 8 rem + the gap is wider than a 320 px row in any font.
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/");
    const { scan, how, row } = await layout(page);
    expect(how.y).toBeGreaterThanOrEqual(scan.y + scan.height);
    expect(Math.abs(scan.width - row.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(how.width - row.width)).toBeLessThanOrEqual(1);
  });

  test("1440 wide: one row, the primary about 14rem and the secondary about 10.5rem", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const { scan, how, rem } = await layout(page);
    expect(Math.abs(scan.y - how.y)).toBeLessThan(2);
    expect(scan.width).toBeGreaterThanOrEqual(14 * rem - 1);
    expect(scan.width).toBeLessThan(14 * rem + 24);
    expect(how.width).toBeGreaterThanOrEqual(10.5 * rem - 1);
    expect(how.width).toBeLessThan(10.5 * rem + 24);
  });
});

test.describe("the hero logo slot", () => {
  for (const [width, height, markRem] of [
    [375, 667, 9.5],
    [390, 844, 11],
    [1440, 900, 19],
  ] as const) {
    test(`${width}x${height}: the slot and the mark follow the spec's sizes`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      const sizes = await page.evaluate(() => {
        const slot = document
          .querySelector(".story-logo")!
          .getBoundingClientRect();
        const img = document
          .querySelector(".story-logo img")!
          .getBoundingClientRect();
        return {
          slot: slot.height,
          img: img.height,
          rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
        };
      });
      // The SVG's box holds the mark at 176 of 196, so the mark is 0.898 of the image.
      const mark = sizes.img * (176 / 196);
      expect(mark / sizes.rem).toBeGreaterThan(markRem - 1.5);
      expect(mark / sizes.rem).toBeLessThan(markRem + 1.5);
      // The mark is about 60 % of the slot (the spec's own words), with room for the glow.
      expect(sizes.img / sizes.slot).toBeGreaterThan(0.55);
      expect(sizes.img / sizes.slot).toBeLessThan(0.8);
    });
  }
});

test("home has no horizontal scroll from 320 px wide up, nor at 200 % text", async ({
  page,
}) => {
  for (const [width, height] of [
    [320, 568],
    [375, 667],
    [390, 844],
    [1440, 900],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `${width}x${height}`,
    ).toBe(true);
  }
  // 200 % text: the root font size doubles. Everything is in rem, so it follows.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.addStyleTag({ content: "html { font-size: 200% }" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("landing side menu lists How it works and returns focus on Escape", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open menu" });
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Navigation" });
  await expect(
    menu.getByRole("link", { name: "How it works" }),
  ).toHaveAttribute("href", "/how-it-works");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("the nav's controls are at least 44 x 44 px, and Sign in leads to the account page", async ({
  page,
}) => {
  await page.goto("/");
  const signIn = page.getByRole("link", { name: "Sign in" });
  await expect(signIn).toHaveAttribute("href", "/account");
  for (const control of [
    signIn,
    page.getByRole("button", { name: "Open menu" }),
  ]) {
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
});

test("the focus ring is the accent text colour, 2 px, visible on the dark page", async ({
  page,
}) => {
  await page.goto("/");
  const scan = page
    .getByTestId("home-hero")
    .getByRole("link", { name: "Scan my hand" });
  await scan.focus();
  const ring = await scan.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      colour: style.outlineColor,
      width: style.outlineWidth,
      offset: style.outlineOffset,
      style: style.outlineStyle,
    };
  });
  expect(ring).toEqual({
    colour: "rgb(127, 168, 255)", // --accent-text
    width: "2px",
    offset: "2px",
    style: "solid",
  });
});

test("every piece of text on the home page is one of the token colours, never the retired #6E6E73", async ({
  page,
}) => {
  await page.goto("/");
  const colours = await page.evaluate(() => {
    const found = new Set<string>();
    for (const el of document.querySelectorAll("main *")) {
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent!.trim())
        .join("");
      if (own) found.add(getComputedStyle(el).color);
    }
    return [...found].sort();
  });
  // --text-primary, --text-secondary, --text-tertiary, --on-accent.
  const allowed = [
    "rgb(138, 138, 143)",
    "rgb(161, 161, 166)",
    "rgb(245, 245, 247)",
    "rgb(255, 255, 255)",
  ];
  for (const colour of colours) expect(allowed).toContain(colour);
  expect(colours).not.toContain("rgb(110, 110, 115)"); // #6E6E73, 3.97:1
});

test("with more contrast the outline button's border is solid #8A8A8F and the glow is gone", async ({
  page,
}) => {
  await page.emulateMedia({ contrast: "more" });
  await page.goto("/");
  const style = await page.evaluate(() => ({
    border: getComputedStyle(document.querySelector(".home-cta-secondary")!)
      .borderTopColor,
    shadow: getComputedStyle(document.querySelector(".home-cta")!).boxShadow,
    slot: getComputedStyle(document.querySelector(".story-logo")!)
      .backgroundImage,
  }));
  expect(style.border).toBe("rgb(138, 138, 143)");
  // The glow colour is --glow at an alpha; with --glow transparent no blue is left.
  expect(style.shadow).not.toMatch(/59, 130, 246/);
  expect(style.shadow).toMatch(/(\/ 0\)|, 0\))/);
  expect(style.slot).not.toMatch(/59, 130, 246/);
});

test("with forced colours both buttons keep a visible 1 px border", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active" });
  await page.goto("/");
  for (const selector of [".home-cta", ".home-cta-secondary"]) {
    const border = await page.evaluate((sel) => {
      const style = getComputedStyle(document.querySelector(sel)!);
      return {
        width: style.borderTopWidth,
        style: style.borderTopStyle,
        colour: style.borderTopColor,
        adjust: style.forcedColorAdjust,
      };
    }, selector);
    expect(border.width, selector).toBe("1px");
    expect(border.style, selector).toBe("solid");
    // Drawn in a system colour, never transparent.
    expect(border.colour, selector).not.toBe("rgba(0, 0, 0, 0)");
    expect(border.adjust, selector).toBe("auto");
  }
});

test("the printed-sheet flow stays reachable from /scan", async ({ page }) => {
  const response = await page.goto("/scan");
  expect(response?.status()).toBe(200);
  await expect(page.getByText("Step 2 of 2 · Photo")).toBeVisible();
});
