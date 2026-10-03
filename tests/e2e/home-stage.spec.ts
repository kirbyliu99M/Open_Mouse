import { expect, test } from "@playwright/test";
import {
  CANVAS,
  CAPTION,
  HERO,
  STORY,
  heroGeometry,
  layoutFacts,
  read,
  recordStage,
  scrollToProgress,
  waitForAnimated,
} from "./helpers/home-stage";

/**
 * Home v3, PR B: the particle stage (docs/design/home-v3-2026-10-03/README.md).
 * The first group runs the animated layout; the second the static fallbacks
 * (reduced motion, no JS, small screens, a module that fails to load), which
 * must be exactly PR A's page with no extra height. The static layout's own
 * facts (buttons, sizes, colours) are pinned in home.spec.ts.
 */

test.describe("the animated layout", () => {
  test.beforeEach(async ({ page }) => {
    await recordStage(page);
  });

  test("the first frame is drawn before the layout switches, and the logo is handed over without ever showing two", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    // Let a few more frames go by, so the sampler has seen the switch settle.
    await page.waitForTimeout(500);

    // Order: the canvas had drawn a frame when the class was added (and the
    // static logo was still showing then), and the logo was hidden after that.
    const events = await read<string[]>(page, "__events");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatch(
      /^class added, draws=[1-9]\d*, clears=[1-9]\d*, logoHidden=false$/,
    );
    expect(events[1]).toMatch(/^logo hidden, draws=[1-9]\d*$/);

    // Frame by frame: exactly one logo on show, before, during and after.
    const frames = await read<
      { logo: boolean; canvas: boolean; drawn: number }[]
    >(page, "__frames");
    expect(frames.length).toBeGreaterThan(10);
    const shown = frames.map(
      (f) => Number(f.logo) + Number(f.canvas && f.drawn > 0),
    );
    expect(shown.filter((n) => n !== 1)).toEqual([]);
    // It did switch: the first frames show the image, the last the canvas.
    expect(frames[0]!.logo).toBe(true);
    expect(frames.at(-1)!.logo).toBe(false);
    expect(frames.at(-1)!.canvas).toBe(true);

    const logo = page.locator(".story-logo img");
    await expect(logo).toHaveCSS("visibility", "hidden");
    // The image keeps its box: that is where the canvas draws the logo.
    const box = await logo.evaluate((el) => el.getBoundingClientRect().height);
    expect(box).toBeGreaterThan(100);
  });

  test("the particle module loads after the first paint, not before", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    const timing = await page.evaluate(() => {
      const paint = performance
        .getEntriesByType("paint")
        .find((e) => e.name === "first-contentful-paint");
      const chunks = performance
        .getEntriesByType("resource")
        .filter((e) => e.name.includes("particle-stage"));
      return {
        paint: paint?.startTime ?? null,
        chunkStarts: chunks.map((e) => e.startTime),
      };
    });
    expect(timing.paint).not.toBeNull();
    expect(timing.chunkStarts.length).toBeGreaterThan(0);
    for (const start of timing.chunkStarts) {
      expect(start).toBeGreaterThan(timing.paint!);
    }
  });

  for (const [width, height] of [
    [375, 667],
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`${width}x${height}: switching shifts nothing: the layout shift is 0, and the hero is where the static page has it`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await waitForAnimated(page);
      await page.waitForTimeout(800);
      expect(await read<number>(page, "__cls")).toBeLessThanOrEqual(0.001);
      const animated = await heroGeometry(page);

      // The same page with reduced motion never leaves the static layout.
      const staticPage = await page.context().newPage();
      await staticPage.emulateMedia({ reducedMotion: "reduce" });
      await staticPage.setViewportSize({ width, height });
      await staticPage.goto("/");
      const reference = await heroGeometry(staticPage);
      await staticPage.close();

      for (const key of Object.keys(reference) as (keyof typeof reference)[]) {
        for (const axis of ["x", "y", "width", "height"] as const) {
          expect(
            Math.abs(animated[key][axis] - reference[key][axis]),
            `${key}.${axis}`,
          ).toBeLessThanOrEqual(0.5);
        }
      }
    });
  }

  test("the hero text fades and moves up over the first tenth; its buttons and links turn inert below opacity 0.05; the h1 never does; scrolling back restores everything", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    const hero = page.locator(HERO);
    const links = hero.getByRole("link");
    const h1 = page.getByRole("heading", {
      level: 1,
      name: "Find the mouse that fits.",
    });

    const state = () =>
      page.evaluate(() => {
        const el = document.querySelector<HTMLElement>(
          '[data-testid="home-hero"]',
        )!;
        const style = getComputedStyle(el);
        const matrix =
          style.transform === "none" ? null : new DOMMatrix(style.transform);
        return {
          opacity: Number(style.opacity),
          shift: matrix ? matrix.m42 : 0,
          inert: [...el.querySelectorAll("a, button")].map((a) =>
            a.hasAttribute("inert"),
          ),
          h1Inert: el.querySelector("h1")!.closest("[inert]") !== null,
          h1InTree: true,
        };
      });

    // p = 0: whole, not inert.
    await scrollToProgress(page, 0);
    let s = await state();
    expect(s.opacity).toBe(1);
    expect(s.shift).toBe(0);
    expect(s.inert).toEqual([false, false]);
    await expect(links).toHaveCount(2);

    // p = 0.05: half way. Still not inert.
    await scrollToProgress(page, 0.05);
    s = await state();
    expect(s.opacity).toBeGreaterThan(0.4);
    expect(s.opacity).toBeLessThan(0.6);
    expect(s.shift).toBeLessThan(-10);
    expect(s.shift).toBeGreaterThan(-30);
    expect(s.inert).toEqual([false, false]);

    // p = 0.09: opacity 0.1, above the 0.05 line.
    await scrollToProgress(page, 0.09);
    s = await state();
    expect(s.opacity).toBeGreaterThanOrEqual(0.05);
    expect(s.inert).toEqual([false, false]);

    // From p = 0.0951 on the opacity is below 0.05, and the controls are inert.
    // 0.097 is the nearest the page can be put to it by scrolling alone.
    for (const p of [0.097, 0.12, 0.3, 0.5, 0.8, 0.95]) {
      await scrollToProgress(page, p);
      s = await state();
      expect(s.opacity, `p=${p}`).toBeLessThan(0.05);
      expect(s.inert, `p=${p}`).toEqual([true, true]);
      // The h1 is neither inert nor hidden from assistive technology.
      expect(s.h1Inert, `p=${p}`).toBe(false);
      await expect(h1).toHaveCount(1);
      await expect(h1).not.toHaveAttribute("inert", /.*/);
      await expect(h1).not.toHaveAttribute("aria-hidden", /.*/);
    }

    // Back to the top: the hero is whole again, the controls work again.
    await scrollToProgress(page, 0.5);
    await scrollToProgress(page, 0.05);
    await scrollToProgress(page, 0);
    s = await state();
    expect(s.opacity).toBe(1);
    expect(s.shift).toBe(0);
    expect(s.inert).toEqual([false, false]);
    await links.first().click({ trial: true });
    await links.last().click({ trial: true });
    // Nothing is left behind in the markup.
    const leftovers = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(
        '[data-testid="home-hero"]',
      )!;
      return {
        style: el.getAttribute("style") ?? "",
        inert: el.querySelectorAll("[inert]").length,
      };
    });
    expect(leftovers).toEqual({ style: "", inert: 0 });
  });

  test("the canvas is decorative: aria-hidden, under the hero, and it takes no clicks", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    const canvas = page.locator(CANVAS);
    await expect(canvas).toHaveAttribute("aria-hidden", "true");
    const css = await canvas.evaluate((el) => {
      const style = getComputedStyle(el);
      const panel = el.closest(".story-panel")!.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      return {
        position: style.position,
        zIndex: style.zIndex,
        pointerEvents: style.pointerEvents,
        top: style.top,
        left: style.left,
        right: style.right,
        bottom: style.bottom,
        sameAsPanel:
          Math.abs(rect.x - panel.x) < 1 &&
          Math.abs(rect.y - panel.y) < 1 &&
          Math.abs(rect.width - panel.width) < 1 &&
          Math.abs(rect.height - panel.height) < 1,
        lastInPanel: el.parentElement!.lastElementChild === el,
        heroZ: getComputedStyle(document.querySelector(".story-hero")!).zIndex,
      };
    });
    expect(css).toMatchObject({
      position: "absolute",
      zIndex: "0",
      pointerEvents: "none",
      top: "0px",
      left: "0px",
      right: "0px",
      bottom: "0px",
      sameAsPanel: true,
      lastInPanel: true,
      heroZ: "1",
    });

    // At the top every button in the hero is clickable (Playwright checks that
    // nothing else is on top of it), and at the middle of the story a click
    // at the canvas's own middle lands on something else.
    const hero = page.locator(HERO);
    await hero
      .getByRole("link", { name: "Scan my hand" })
      .click({ trial: true });
    await hero
      .getByRole("link", { name: "How it works" })
      .click({ trial: true });
    await scrollToProgress(page, 0.5);
    const hit = await page.evaluate(() => {
      const c = document
        .querySelector(".story-canvas")!
        .getBoundingClientRect();
      const probe = (x: number, y: number) => {
        const el = document.elementFromPoint(x, y);
        return el ? el.className || el.tagName : null;
      };
      return {
        middle: probe(c.x + c.width / 2, c.y + c.height / 2),
        low: probe(c.x + c.width / 2, c.y + c.height - 4),
      };
    });
    expect(hit.middle).not.toContain("story-canvas");
    expect(hit.low).not.toContain("story-canvas");
    // The three captions (and everything else in the stage) take no clicks either.
    await scrollToProgress(page, 0.95);
    const overCaption = await page.evaluate(() => {
      const caption = document
        .querySelector(".story-mouse figcaption")!
        .getBoundingClientRect();
      const el = document.elementFromPoint(
        caption.x + caption.width / 2,
        caption.y + caption.height / 2,
      );
      return el?.closest(".story-mice") === null;
    });
    expect(overCaption).toBe(true);
  });

  test("the three captions are real text all along, and fade in as the mice settle", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    const captions = page.getByText(CAPTION);
    await expect(captions).toHaveCount(3);
    const opacities = () =>
      captions.evaluateAll((els) =>
        els.map((el) => Number(getComputedStyle(el).opacity)),
      );
    for (const p of [0, 0.3, 0.5, 0.7]) {
      await scrollToProgress(page, p);
      expect(await opacities(), `p=${p}`).toEqual([0, 0, 0]);
      await expect(captions).toHaveCount(3);
    }
    await scrollToProgress(page, 0.95);
    expect(await opacities()).toEqual([1, 1, 1]);
    // And back again.
    await scrollToProgress(page, 0.5);
    expect(await opacities()).toEqual([0, 0, 0]);
  });

  test("the story's pieces appear in order: hero, scatter, hand, measured hand, rearranging, mice", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    const expected: [number, string][] = [
      [0, "1"],
      [0.1, "2"],
      [0.2, "3"],
      [0.45, "4"],
      [0.6, "5"],
      [0.8, "6"],
      [1, "6"],
    ];
    for (const [p, story] of expected) {
      await scrollToProgress(page, p);
      await expect(page.locator(STORY)).toHaveAttribute("data-story", story);
    }
    // The A4 outline is on show with the hand and not before or after.
    const sheet = page.locator(".story-hand-sheet");
    await scrollToProgress(page, 0.1);
    await expect(sheet).toHaveCSS("opacity", "0");
    await scrollToProgress(page, 0.45);
    await expect(sheet).toHaveCSS("opacity", "1");
    await scrollToProgress(page, 0.8);
    await expect(sheet).toHaveCSS("opacity", "0");
  });

  test("at p = 1 the panel lets go: the mice and their captions scroll away with it, and the final section follows", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    await scrollToProgress(page, 1);
    const at = () =>
      page.evaluate(() => {
        const panel = document
          .querySelector(".story-panel")!
          .getBoundingClientRect();
        const caption = document
          .querySelector(".story-mouse figcaption")!
          .getBoundingClientRect();
        const final = document
          .querySelector('[data-testid="home-final"]')!
          .getBoundingClientRect();
        return {
          panelTop: panel.top,
          panelBottom: panel.bottom,
          caption: caption.top,
          final: final.top,
          viewport: window.innerHeight,
        };
      });
    const pinned = await at();
    // Pinned: the panel fills the viewport.
    expect(Math.abs(pinned.panelTop)).toBeLessThanOrEqual(1);
    // The final section starts where the panel ends.
    expect(Math.abs(pinned.final - pinned.panelBottom)).toBeLessThanOrEqual(60);

    // Scroll 120 px further: the panel, the caption and the final section all moved up by 120.
    await page.evaluate(() => window.scrollBy(0, 120));
    await page.waitForTimeout(150);
    const moved = await at();
    expect(moved.panelTop).toBeCloseTo(pinned.panelTop - 120, 0);
    expect(moved.caption).toBeCloseTo(pinned.caption - 120, 0);
    expect(moved.final).toBeCloseTo(pinned.final - 120, 0);
    // The mice are still p = 1's state: nothing was redrawn or changed.
    await expect(page.locator(STORY)).toHaveAttribute("data-progress", "1.000");
    await expect(page.getByText(CAPTION).first()).toHaveCSS("opacity", "1");
  });

  test("the stage draws nothing while it is off screen, and catches up when it is back", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    await scrollToProgress(page, 0.5);
    // Push the story far below the fold with a tall block above it.
    await page.evaluate(() => {
      // Without this the browser would scroll to keep the story in view.
      document.documentElement.style.overflowAnchor = "none";
      const spacer = document.createElement("div");
      spacer.id = "spacer";
      spacer.style.height = "6000px";
      document.querySelector(".story")!.before(spacer);
    });
    await page.waitForTimeout(400); // the IntersectionObserver reports
    expect(
      await page.evaluate(
        () =>
          document.querySelector(".story-canvas")!.getBoundingClientRect().top >
          window.innerHeight,
      ),
    ).toBe(true);
    const draws = () =>
      page.locator(CANVAS).getAttribute("data-draws").then(Number);
    const before = await draws();
    // A scroll that would change p (the story is now below: p = 0) draws nothing.
    await page.evaluate(() => window.scrollBy(0, 10));
    await page.waitForTimeout(300);
    expect(await draws()).toBe(before);
    // Bring it back: it catches up with where the reader is.
    await page.evaluate(() => document.getElementById("spacer")!.remove());
    await scrollToProgress(page, 0.3);
    expect(await draws()).toBeGreaterThan(before);
  });

  test("drawing stops while the tab is hidden, and catches up when it is shown", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    await scrollToProgress(page, 0.2);
    const draws = () =>
      page.locator(CANVAS).getAttribute("data-draws").then(Number);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const before = await draws();
    await page.evaluate(() => {
      const section = document.querySelector(".story") as HTMLElement;
      const panel = document.querySelector(".story-panel") as HTMLElement;
      const top = section.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(
        0,
        top + 0.6 * (section.offsetHeight - panel.offsetHeight),
      );
    });
    await page.waitForTimeout(400);
    expect(await draws()).toBe(before);
    await expect(page.locator(STORY)).toHaveAttribute("data-progress", /^0\.2/);
    // Shown again: it draws the frame for where the reader is now.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator(STORY)).toHaveAttribute("data-progress", /^0\.6/);
  });

  test("the shimmer plays once and is over within 3 s; after it nothing draws and nothing is scheduled until the reader scrolls", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    const activatedAt = await read<number>(page, "__activatedAt");
    // Wait until 3.4 s after the switch.
    await page.waitForFunction(
      (start) => performance.now() - start > 3400,
      activatedAt,
      { timeout: 10_000 },
    );
    const draws = await read<number[]>(page, "__draws");
    // It really played: dozens of frames in its first seconds.
    expect(draws.length).toBeGreaterThan(30);
    // And it ended inside 3 s (WCAG 2.2.2): the last draw is before activation + 3 s.
    const lastOffset = Math.max(...draws) - activatedAt;
    expect(lastOffset).toBeLessThan(3000);
    expect(lastOffset).toBeGreaterThan(1500);

    // Then it is still: no draw and no requestAnimationFrame call for 2 s.
    const settled = {
      draws: (await read<number[]>(page, "__draws")).length,
      raf: await read<number>(page, "__raf"),
      attr: await page.locator(CANVAS).getAttribute("data-draws"),
    };
    await page.waitForTimeout(2000);
    expect((await read<number[]>(page, "__draws")).length).toBe(settled.draws);
    expect(await read<number>(page, "__raf")).toBe(settled.raf);
    await expect(page.locator(CANVAS)).toHaveAttribute(
      "data-draws",
      settled.attr!,
    );

    // A scroll wakes it, once per frame that changes, and it goes still again.
    await scrollToProgress(page, 0.4);
    const woken = (await read<number[]>(page, "__draws")).length;
    expect(woken).toBeGreaterThan(settled.draws);
    await page.waitForTimeout(500);
    expect((await read<number[]>(page, "__draws")).length).toBe(woken);
  });

  test("a resize after the shimmer redraws the stage once and does not play it again", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    const activatedAt = await read<number>(page, "__activatedAt");
    await page.waitForFunction(
      (start) => performance.now() - start > 3400,
      activatedAt,
    );
    const before = (await read<number[]>(page, "__draws")).length;
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.width, height: size.height + 40 });
    await page.waitForTimeout(600);
    const after = (await read<number[]>(page, "__draws")).length;
    expect(after - before).toBeGreaterThanOrEqual(1);
    expect(after - before).toBeLessThanOrEqual(4);
    await page.waitForTimeout(500);
    expect((await read<number[]>(page, "__draws")).length).toBe(after);
  });

  test("printing from the middle of the story gives the static page, not a 400svh section", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    await scrollToProgress(page, 0.5);
    await page.emulateMedia({ media: "print" });
    const facts = await layoutFacts(page);
    expect(facts.panelPosition).toBe("static");
    expect(facts.sectionHeight).toBe(facts.panelHeight);
    expect(facts.canvasDisplay).toBe("none");
    expect(facts.heroOpacity).toBe("1");
    expect(facts.heroTransform).toBe("none");
  });
});

test.describe("the canvas follows the device", () => {
  test.describe("at a device pixel ratio of 3", () => {
    test.use({ deviceScaleFactor: 3 });
    test("the canvas's backing store is at most twice its size in CSS px", async ({
      page,
    }) => {
      await page.goto("/");
      await waitForAnimated(page);
      const size = await page.locator(CANVAS).evaluate((el) => {
        const c = el as HTMLCanvasElement;
        const rect = c.getBoundingClientRect();
        return { w: c.width, h: c.height, cssW: rect.width, cssH: rect.height };
      });
      expect(size.w).toBe(Math.round(size.cssW * 2));
      expect(size.h).toBe(Math.round(size.cssH * 2));
    });
  });

  test("the backing store is the CSS size times the device's ratio, never more than 2", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const size = await page.locator(CANVAS).evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const rect = c.getBoundingClientRect();
      return { w: c.width, cssW: rect.width };
    });
    expect(size.w).toBe(Math.round(size.cssW * Math.min(Math.max(dpr, 1), 2)));
  });

  for (const [cores, label] of [
    [8, "8 cores"],
    [4, "4 cores"],
    [2, "2 cores"],
  ] as const) {
    test(`the particle budget with ${label}: about 900 on a phone and 1,300 on a desktop, halved at 4 or fewer`, async ({
      page,
    }) => {
      await page.addInitScript((n) => {
        Object.defineProperty(navigator, "hardwareConcurrency", {
          get: () => n,
        });
      }, cores);
      await page.goto("/");
      await waitForAnimated(page);
      const wide = await page.evaluate(
        () => matchMedia("(min-width: 48rem)").matches,
      );
      const expected = cores <= 4 ? (wide ? 648 : 450) : wide ? 1299 : 900;
      await expect(page.locator(CANVAS)).toHaveAttribute(
        "data-particles",
        String(expected),
      );
    });
  }
});

test.describe("the layout follows what the page can hold", () => {
  test("a large text size that no longer fits the hero in one screen takes the page back to the static layout, and back again", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await waitForAnimated(page);
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.id = "zoom";
      style.textContent = "html { font-size: 200% }";
      document.head.append(style);
    });
    await expect(page.locator(STORY)).not.toHaveClass(/story--animated/, {
      timeout: 10_000,
    });
    let facts = await layoutFacts(page);
    expect(facts.sectionHeight).toBe(facts.panelHeight);
    expect(facts.logoVisibility).toBe("visible");
    expect(facts.heroOpacity).toBe("1");
    expect(facts.inert).toBe(0);
    expect(facts.canvasDisplay).toBe("none");
    // Text back to normal: it fits again and the stage comes back.
    await page.evaluate(() => document.getElementById("zoom")!.remove());
    await waitForAnimated(page);
    facts = await layoutFacts(page);
    expect(facts.animated).toBe(true);
    expect(facts.logoVisibility).toBe("hidden");
  });

  test("a phone turned to landscape (too short for the hero) is static, and portrait brings the stage back", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await waitForAnimated(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator(STORY)).not.toHaveClass(/story--animated/, {
      timeout: 10_000,
    });
    const facts = await layoutFacts(page);
    expect(facts.sectionHeight).toBe(facts.panelHeight);
    expect(facts.logoVisibility).toBe("visible");
    await page.setViewportSize({ width: 390, height: 844 });
    await waitForAnimated(page);
  });

  test("a viewport under 600 px tall is static", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 599 });
    await page.goto("/");
    await page.waitForTimeout(4000);
    const facts = await layoutFacts(page);
    expect(facts.animated).toBe(false);
    expect(facts.sectionHeight).toBe(facts.panelHeight);
  });
});

test.describe("the static layout is kept, with no extra height", () => {
  /** The page as it is with scripts off, in the same browser setup: the height nothing animated could have changed. */
  async function baseline(
    browser: import("@playwright/test").Browser,
    width: number,
    height: number,
  ) {
    const use = test.info().project.use;
    const context = await browser.newContext({
      baseURL: use.baseURL,
      viewport: { width, height },
      isMobile: use.isMobile,
      hasTouch: use.hasTouch,
      userAgent: use.userAgent,
      deviceScaleFactor: use.deviceScaleFactor,
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    await page.goto("/");
    const facts = await layoutFacts(page);
    await context.close();
    return facts;
  }

  /** No blank stretches: the gap between one block of the story and the next. */
  async function gaps(page: import("@playwright/test").Page) {
    return page.evaluate(() => {
      const blocks = [
        ".story-hero",
        ".story-hand",
        ".story-mice",
        '[data-testid="home-final"]',
        ".landing-footer",
      ].map((selector) =>
        document.querySelector(selector)!.getBoundingClientRect(),
      );
      const rem = parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      return blocks.slice(1).map((r, i) => (r.top - blocks[i]!.bottom) / rem);
    });
  }

  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("the stage never switches on, draws nothing, and the page is as tall as without scripts", async ({
      page,
      browser,
    }) => {
      const size = page.viewportSize()!;
      await page.goto("/");
      // Give a stage that was going to load plenty of time to do it.
      await page.waitForTimeout(4000);
      const facts = await layoutFacts(page);
      expect(facts.animated).toBe(false);
      expect(facts.canvasDisplay).toBe("none");
      expect(facts.logoVisibility).toBe("visible");
      expect(facts.sectionHeight).toBe(facts.panelHeight);
      expect(await page.locator(CANVAS).getAttribute("data-draws")).toBeNull();
      const plain = await baseline(browser, size.width, size.height);
      expect(facts.scrollHeight).toBe(plain.scrollHeight);
      // No big blank stretch anywhere: each gap is a few rem at most.
      for (const gap of await gaps(page)) {
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(6);
      }
      // The three static end states are all there.
      await expect(page.locator(".story-logo img")).toBeVisible();
      await expect(page.locator(".story-hand img")).toBeVisible();
      await expect(page.locator(".story-mouse img")).toHaveCount(3);
      for (let i = 0; i < 3; i += 1) {
        await expect(page.locator(".story-mouse img").nth(i)).toBeVisible();
      }
    });

    test("switching the preference on while the stage runs takes it back to static, and off brings it back", async ({
      page,
    }) => {
      // Starts reduced: static. Turn motion on: the stage may load and switch on.
      await page.goto("/");
      await page.waitForTimeout(1500);
      expect((await layoutFacts(page)).animated).toBe(false);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await waitForAnimated(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator(STORY)).not.toHaveClass(/story--animated/, {
        timeout: 10_000,
      });
      const facts = await layoutFacts(page);
      expect(facts.sectionHeight).toBe(facts.panelHeight);
      expect(facts.logoVisibility).toBe("visible");
    });
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    test("it is PR A's page: the canvas is there but not shown, nothing is hidden, and there is no tall section", async ({
      page,
    }) => {
      await page.goto("/");
      const facts = await layoutFacts(page);
      expect(facts.animated).toBe(false);
      expect(facts.canvasDisplay).toBe("none");
      expect(facts.sectionHeight).toBe(facts.panelHeight);
      expect(facts.logoVisibility).toBe("visible");
      expect(facts.heroOpacity).toBe("1");
      expect(facts.inert).toBe(0);
      await expect(page.locator(CANVAS)).toHaveAttribute("aria-hidden", "true");
      // The page is one stack, shorter than five screens, with no big gaps.
      expect(facts.scrollHeight).toBeLessThan(facts.viewport * 5);
      for (const gap of await gaps(page)) {
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(6);
      }
      await expect(page.getByText(CAPTION)).toHaveCount(3);
      for (let i = 0; i < 3; i += 1) {
        await expect(page.getByText(CAPTION).nth(i)).toBeVisible();
      }
    });
  });

  for (const [width, height, label] of [
    [320, 568, "320x568"],
    [844, 390, "a phone in landscape"],
    [915, 412, "a Pixel 7 in landscape"],
    [390, 599, "390x599, a pixel short of 600"],
  ] as const) {
    test(`${label}: the static layout, with no extra height`, async ({
      page,
      browser,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await page.waitForTimeout(4000);
      const facts = await layoutFacts(page);
      expect(facts.animated).toBe(false);
      expect(facts.canvasDisplay).toBe("none");
      expect(facts.logoVisibility).toBe("visible");
      expect(facts.sectionHeight).toBe(facts.panelHeight);
      const plain = await baseline(browser, width, height);
      expect(facts.scrollHeight).toBe(plain.scrollHeight);
      for (const gap of await gaps(page)) {
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(6);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    });
  }

  test("if the particle module fails to load, nothing changes", async ({
    page,
    browser,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/particle-stage/, (route) => route.abort());
    const size = page.viewportSize()!;
    await page.goto("/");
    await page.waitForTimeout(4000);
    const facts = await layoutFacts(page);
    expect(facts.animated).toBe(false);
    expect(facts.canvasDisplay).toBe("none");
    expect(facts.logoVisibility).toBe("visible");
    expect(facts.sectionHeight).toBe(facts.panelHeight);
    expect(await page.locator(CANVAS).getAttribute("data-draws")).toBeNull();
    const plain = await baseline(browser, size.width, size.height);
    expect(facts.scrollHeight).toBe(plain.scrollHeight);
    // The headline, the buttons and the three mice are all still there and work.
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Find the mouse that fits.",
      }),
    ).toBeVisible();
    await page
      .locator(HERO)
      .getByRole("link", { name: "Scan my hand" })
      .click({ trial: true });
    await expect(page.getByText(CAPTION)).toHaveCount(3);
    // A failed load is not an uncaught error.
    expect(errors).toEqual([]);
  });
});

test("the story section's markup: the hero first, the canvas last, one h1", async ({
  page,
}) => {
  await page.goto("/");
  const order = await page.evaluate(() => {
    const panel = document.querySelector(".story-panel")!;
    return {
      children: [...panel.children].map((el) => el.className),
      h1: document.querySelectorAll("h1").length,
    };
  });
  expect(order.children).toEqual([
    "story-hero",
    "story-hand",
    "story-mice",
    "story-canvas",
  ]);
  expect(order.h1).toBe(1);
});
