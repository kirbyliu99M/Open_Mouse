import { expect, test } from "@playwright/test";
import { contrast } from "./fixtures/contrast";

// These tests pin the static layout (Home v3 PR A): the story as a stack of
// ordinary blocks. That layout is also what reduced motion keeps, so they run
// under it, and cannot race the particle stage switching the page to its
// animated layout mid-test. The animated layout, and the fallbacks to this
// one, are in home-stage.spec.ts.
test.use({ reducedMotion: "reduce" });

// The finale's headline (Kirby's words, 2026-10-09). It replaced the three
// mice and their captions on 2026-10-11.
const FINALE_TITLE = "Find Your Best Mouse";
// Kirby, 2026-10-10: the site footer carries no explanatory text for now, so
// the Early preview note and the non-affiliation statement appear nowhere on
// the site until he decides where they go.

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

  // The buttons appear twice: in the hero and in the final section. Each
  // locator is scoped to its region, so Playwright's strict mode never meets
  // two elements.
  for (const region of ["home-hero", "home-final"]) {
    const scope = page.getByTestId(region);
    await expect(
      scope.getByRole("link", { name: "Scan my hand" }),
    ).toHaveAttribute("href", "/scan/easy");
    await expect(
      scope.getByRole("link", { name: "How it works" }),
    ).toHaveAttribute("href", "/how-it-works");
    // No copy of the Early preview note under the buttons any more.
    await expect(scope.getByText("Early preview")).toHaveCount(0);
  }
  // Counted in the page body: the site footer (root layout) has a "How it
  // works" link of its own, checked below.
  const body = page.getByRole("main");
  await expect(body.getByRole("link", { name: "Scan my hand" })).toHaveCount(2);
  await expect(body.getByRole("link", { name: "How it works" })).toHaveCount(2);
  // The Early preview note is not on the page at all for now (Kirby,
  // 2026-10-10): not in the body, not in the footer.
  await expect(page.getByText("Early preview")).toHaveCount(0);
  await expect(page.locator(".landing-preview-note")).toHaveCount(0);
  const footerLinks = page
    .getByTestId("site-footer")
    .getByRole("link", { name: "How it works" });
  await expect(footerLinks).toHaveCount(1);
  await expect(footerLinks).toHaveAttribute("href", "/how-it-works");

  // The finale: Kirby's headline is real text over its drawing, and the
  // three mice and their captions are gone.
  await expect(
    page.getByRole("heading", { level: 2, name: FINALE_TITLE }),
  ).toBeVisible();
  await expect(page.locator(".story-finale-art img")).toHaveCount(1);
  await expect(page.locator(".story-finale-art img")).toBeVisible();
  await expect(page.getByText("G Pro X Superlight 2 · sketch")).toHaveCount(0);
  await expect(page.locator(".story-mice, .story-mouse")).toHaveCount(0);

  // Nor is the non-affiliation statement (removed with the note, 2026-10-10).
  await expect(page.getByText("Not affiliated with Logitech")).toHaveCount(0);
  await expect(page.locator(".landing-footer")).toHaveCount(0);

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
  // logo, hand, then the finale's hand on a mouse
  expect(order.images.map((i) => i.src)).toEqual([
    "/images/hero-palmate-mark.svg",
    "/images/hand-on-a4.svg",
    "/images/sketches/finale-grip.svg",
  ]);
  // Decorative: an empty alt. The wordmark in the nav names the site and the
  // finale's headline is real text, so nothing here needs a description.
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

test("print: text that takes its colour from a token prints dark on the white page", async ({
  page,
}) => {
  await page.goto("/");
  await page.emulateMedia({ media: "print" });
  // The headline, the wordmark, the subhead, the finale's
  // headline and the footer: --text-primary, --text-secondary, the footer's
  // tokens on screen, near-white on dark. On paper they must be dark.
  const texts = await page.evaluate(() => {
    const colour = (selector: string) =>
      getComputedStyle(document.querySelector(selector)!).color;
    return {
      "h1 (--text-primary)": colour("h1"),
      "wordmark (--text-primary)": colour(".home-wordmark"),
      "subhead (--text-secondary)": colour(".home-subhead"),
      "footer headline (--text-primary)": colour(".siteFooter-headline"),
      "finale headline (--text-primary)": colour(".story-finale-title"),
      "footer group title (--footer-heading)": colour(".siteFooter-groupTitle"),
      "footer link (--footer-link)": colour(".siteFooter-group a"),
      "Sign in (--text-secondary)": colour(".home-signin-link"),
    };
  });
  for (const [name, colour] of Object.entries(texts)) {
    expect(contrast(colour, "rgb(255, 255, 255)"), name).toBeGreaterThanOrEqual(
      name.startsWith("h1") ? 12 : 7,
    );
  }
  // Chrome does not print backgrounds by default, so a filled button would
  // print as white text on white paper. On paper the primary is a dark label
  // with a dark outline and no fill; the secondary too.
  const buttons = await page.evaluate(() =>
    [".home-cta", ".home-cta-secondary"].map((selector) => {
      const style = getComputedStyle(document.querySelector(selector)!);
      return {
        selector,
        color: style.color,
        background: style.backgroundColor,
        border: style.borderTopColor,
        borderWidth: style.borderTopWidth,
        shadow: style.boxShadow,
      };
    }),
  );
  for (const button of buttons) {
    expect(
      contrast(button.color, "rgb(255, 255, 255)"),
      `${button.selector} label`,
    ).toBeGreaterThanOrEqual(12);
    expect(button.background, `${button.selector} has no fill`).toBe(
      "rgba(0, 0, 0, 0)",
    );
    expect(button.border, `${button.selector} outline`).toBe("rgb(0, 0, 0)");
    expect(button.borderWidth).toBe("1px");
    expect(button.shadow, `${button.selector} glow`).toBe("none");
  }
  // The light-on-dark drawings and the menu icon are left off the page.
  const hidden = await page.evaluate(() =>
    [
      ".story-logo",
      ".story-hand",
      ".story-notes",
      ".story-finale-art img",
      ".navMenuTrigger",
    ].map((selector) => [
      selector,
      getComputedStyle(document.querySelector(selector)!).display,
    ]),
  );
  for (const [selector, display] of hidden) {
    expect(display, `${selector} is not printed`).toBe("none");
  }
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

  test("at 200 % text on a 390 phone they no longer fit, so they stack at full width, the primary on top", async ({
    page,
  }) => {
    // Two labels at twice the size are wider than a 342 px row in any font.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.addStyleTag({ content: "html { font-size: 200% }" });
    const { scan, how, row } = await layout(page);
    expect(how.y).toBeGreaterThanOrEqual(scan.y + scan.height);
    expect(Math.abs(scan.width - row.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(how.width - row.width)).toBeLessThanOrEqual(1);
    expect(scan.x + scan.width).toBeLessThanOrEqual(390);
  });

  // 320 is the one width at which the two buttons share a line in a narrow font
  // and stack in a wide one, so it asserts the rule and not which side of it
  // this font falls on: one row, or full-width rows with the primary on top;
  // and in both cases nothing overflows, whatever the font.
  test("320x568 at 100 % text: one row, or stacked at full width with the primary on top, and nothing overflows", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/");
    const { scan, how, row, scanScrolls, howScrolls } = await layout(page);
    const sameRow = Math.abs(scan.y - how.y) < 2;
    if (sameRow) {
      expect(scan.x).toBeLessThan(how.x);
      expect(how.x + how.width).toBeLessThanOrEqual(row.x + row.width + 1);
    } else {
      expect(how.y).toBeGreaterThanOrEqual(scan.y + scan.height);
      expect(Math.abs(scan.width - row.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(how.width - row.width)).toBeLessThanOrEqual(1);
    }
    // Either way: inside the viewport, no label cut off, no sideways scroll.
    for (const button of [scan, how]) {
      expect(button.x).toBeGreaterThanOrEqual(0);
      expect(button.x + button.width).toBeLessThanOrEqual(320);
    }
    expect(scanScrolls).toBe(false);
    expect(howScrolls).toBe(false);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
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
      // The SVG's box holds the Palmate hand at 59 of 69, so the mark is 0.855 of the image.
      const mark = sizes.img * (59 / 69);
      expect(mark / sizes.rem).toBeGreaterThan(markRem - 1.5);
      expect(mark / sizes.rem).toBeLessThan(markRem + 1.5);
      // The mark is about 54 % of the slot on a phone and 65 % on a desktop
      // (home.css), with room for the glow: this checks the image's share,
      // 0.63 and 22.2 / 29 (0.77) of the slot.
      expect(sizes.img / sizes.slot).toBeGreaterThan(0.55);
      expect(sizes.img / sizes.slot).toBeLessThan(0.8);
    });
  }
});

test("home has no horizontal scroll from 320 px wide up", async ({ page }) => {
  for (const [width, height] of [
    [320, 568],
    [360, 640],
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
});

// 200 % text: the root font size doubles. Everything is in rem, so it follows.
// The logo slot, the nav and the two buttons are what used to be wider than the
// column at this size, so besides the page's own scroll width this names any
// element that sticks out past the viewport.
for (const [width, height] of [
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
] as const) {
  test(`home has no horizontal scroll at 200 % text on ${width}x${height}, and nothing sticks out of the viewport`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.addStyleTag({ content: "html { font-size: 200% }" });
    const result = await page.evaluate(() => {
      const outside = [...document.querySelectorAll("body *")]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return (
            box.width > 0 &&
            (box.left < -0.5 || box.right > window.innerWidth + 0.5)
          );
        })
        .map(
          (el) =>
            `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "")}`,
        );
      return {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        outside,
      };
    });
    expect(result.scrollWidth).toBeLessThanOrEqual(result.innerWidth);
    expect(result.outside).toEqual([]);
    // Both buttons are still there, each inside the column, the primary first.
    const hero = page.getByTestId("home-hero");
    const scan = await hero
      .getByRole("link", { name: "Scan my hand" })
      .boundingBox();
    const how = await hero
      .getByRole("link", { name: "How it works" })
      .boundingBox();
    expect(scan!.x).toBeGreaterThanOrEqual(0);
    expect(how!.x).toBeGreaterThanOrEqual(0);
    expect(scan!.x + scan!.width).toBeLessThanOrEqual(width);
    expect(how!.x + how!.width).toBeLessThanOrEqual(width);
    expect(how!.y).toBeGreaterThanOrEqual(scan!.y + scan!.height - 1);
  });
}

// The spec's acceptance for the buttons: from 360 px up the two sit on one
// line, and both buttons fit the first screen of a
// 375 x 667 phone (screens/02). Both depend on the font, and CI is Linux, whose
// default font is about a quarter wider than Windows', so the sizes in home.css
// are set for the wider one: this must hold in either.
// 361 and 364 are in the list on purpose: the side padding used to step from
// 1.5rem to 1rem at 360 px, which left those widths a few pixels short in a wide
// font (the buttons stacked at 361 to 364 px, though they fit at 360). It ramps
// now, so every width from 360 px up has at least as much room as 360 px has
// (the next test pins that, for any font); 370 is where a faster ramp, 0.8 px
// of padding per px of viewport, left the row narrowest.
for (const [width, height] of [
  [360, 640],
  [361, 640],
  [364, 640],
  [370, 667],
  [375, 667],
  [390, 844],
] as const) {
  test(`${width}x${height} at 100 % text: the two buttons share one line`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const hero = page.getByTestId("home-hero");
    const scan = await hero
      .getByRole("link", { name: "Scan my hand" })
      .boundingBox();
    const how = await hero
      .getByRole("link", { name: "How it works" })
      .boundingBox();
    expect(Math.abs(scan!.y - how!.y)).toBeLessThan(2);
    expect(scan!.x).toBeLessThan(how!.x);
    expect(scan!.height).toBeLessThan(60);
    expect(how!.height).toBeLessThan(60);
  });
}

// The reason those widths fit, stated without a font: the row the buttons live
// in is never narrower than it is at 360 px, where the two share a line. A step
// in the side padding at 360 px narrows it (the old one took 16 px more padding
// for the one pixel more of viewport at 361 px); a ramp that grows by more than
// half a pixel per pixel of viewport on each side narrows it on the way to the
// full padding.
test("from 360 px to 420 px the row the buttons live in is never narrower than at 360 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/");
  const rowWidth = () =>
    page.evaluate(
      () =>
        document
          .querySelector('[data-testid="home-hero"] .home-actions')!
          .getBoundingClientRect().width,
    );
  const at360 = await rowWidth();
  const narrower: string[] = [];
  for (let width = 361; width <= 420; width++) {
    await page.setViewportSize({ width, height: 640 });
    const row = await rowWidth();
    if (row < at360 - 0.01) narrower.push(`${width}: ${row} < ${at360}`);
  }
  expect(narrower).toEqual([]);
});

test("375x667: the first screen holds both buttons", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  const hero = page.getByTestId("home-hero");
  const boxes = {
    scan: await hero.getByRole("link", { name: "Scan my hand" }).boundingBox(),
    how: await hero.getByRole("link", { name: "How it works" }).boundingBox(),
  };
  for (const [name, box] of Object.entries(boxes)) {
    expect(box, name).not.toBeNull();
    expect(box!.y, name).toBeGreaterThanOrEqual(0);
    expect(
      box!.y + box!.height,
      `${name} is above the fold`,
    ).toBeLessThanOrEqual(667);
  }
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
  // --text-primary, --text-secondary, --text-tertiary, --on-accent, and
  // --on-button-primary (the primary pill's label, BTN-1).
  const allowed = [
    "rgb(6, 7, 9)",
    "rgb(138, 138, 143)",
    "rgb(161, 161, 166)",
    "rgb(245, 245, 247)",
    "rgb(255, 255, 255)",
  ];
  for (const colour of colours) expect(allowed).toContain(colour);
  expect(colours).not.toContain("rgb(110, 110, 115)"); // #6E6E73, 3.97:1
});

test("with more contrast the outline button's border is solid #8A8A8F, the primary pill has no glow, and the logo slot's glow is gone", async ({
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
  // The primary pill never has a glow (a blue glow round a white pill reads as a mistake).
  expect(style.shadow).toBe("none");
  // The logo slot's glow is --glow at an alpha; with --glow transparent no blue is left.
  expect(style.slot).not.toMatch(/59, 130, 246/);
});

test("the A4 outline is a hairline that sits on the drawing's sheet, and turns solid with more contrast", async ({
  page,
}) => {
  await page.goto("/");
  const frame = page.locator(".story-hand-sheet");
  const img = page.locator(".story-hand img");
  await expect(frame).toHaveCount(1);
  // The outline is drawn by the page, not by the <img> (which can not read
  // --hairline): a 1 px border in --hairline, #FFFFFF24.
  const outline = () =>
    frame.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        width: style.borderTopWidth,
        style: style.borderTopStyle,
        colour: style.borderTopColor,
      };
    });
  expect(await outline()).toEqual({
    width: "1px",
    style: "solid",
    colour: "rgba(255, 255, 255, 0.14)",
  });
  // It lies exactly over the A4 sheet of the drawing: 210 : 297, centred.
  const [outer, inner] = [await img.boundingBox(), await frame.boundingBox()];
  expect(inner!.width / inner!.height).toBeCloseTo(210 / 297, 2);
  expect(inner!.x + inner!.width / 2).toBeCloseTo(
    outer!.x + outer!.width / 2,
    0,
  );
  expect(inner!.x).toBeGreaterThan(outer!.x);
  expect(inner!.x + inner!.width).toBeLessThan(outer!.x + outer!.width);
  // More contrast: solid #8A8A8F.
  await page.emulateMedia({ contrast: "more" });
  expect(await outline()).toEqual({
    width: "1px",
    style: "solid",
    colour: "rgb(138, 138, 143)",
  });
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

// A tiny SVG, served for the avatar request.
const PIXEL =
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#3b82f6"/></svg>';

test("signed in, the nav shows the Google avatar linking to the account page instead of Sign in", async ({
  page,
}) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        expires: "2099-01-01T00:00:00.000Z",
        user: {
          id: "u1",
          name: "Ada Lovelace",
          image: "https://lh3.googleusercontent.com/ada.png",
        },
      },
    }),
  );
  await page.route("https://lh3.googleusercontent.com/**", (route) =>
    route.fulfill({ body: PIXEL, contentType: "image/svg+xml" }),
  );
  await page.goto("/");
  // Scoped to the nav: the site footer (root layout) has an Account link too.
  const account = page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Account", exact: true });
  await expect(account).toHaveAttribute("href", "/account");
  await expect(account.locator("img")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  const box = await account.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test("signed in with an avatar that fails to load, the nav shows the meteor mouse fallback", async ({
  page,
}) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      json: {
        expires: "2099-01-01T00:00:00.000Z",
        user: {
          id: "u1",
          name: "ada lovelace",
          image: "https://lh3.googleusercontent.com/broken.png",
        },
      },
    }),
  );
  await page.route("https://lh3.googleusercontent.com/**", (route) =>
    route.abort(),
  );
  await page.goto("/");
  // Scoped to the nav: the site footer (root layout) has an Account link too.
  const account = page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Account", exact: true });
  // The fallback is the static meteor mouse, not the name's initial (Kirby,
  // 2026-10-10).
  const fallback = account.getByTestId("avatar-fallback");
  await expect(fallback).toBeVisible();
  await expect(fallback.locator("svg")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
});

test("a failed session fetch keeps the Sign in link", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});
