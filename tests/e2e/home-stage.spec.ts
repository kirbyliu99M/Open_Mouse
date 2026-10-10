import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import {
  CANVAS,
  FINALE_TITLE,
  GL_CANVAS,
  HERO,
  STORY,
  heroGeometry,
  layoutFacts,
  read,
  recordStage,
  scrollToProgress,
  waitForAnimated,
} from "./helpers/home-stage";
import { expectPrintsDark } from "./fixtures/print-text";

/**
 * Home v3, PR B: the particle stage (docs/design/home-v3-2026-10-03/README.md).
 * The first group runs the animated layout; the second the static fallbacks
 * (reduced motion, no JS, small screens, a module that fails to load), which
 * must be exactly PR A's page with no extra height. The static layout's own
 * facts (buttons, sizes, colours) are pinned in home.spec.ts.
 *
 * The stage draws the particles with WebGL where it can and on Canvas 2D where
 * it can not (`data-renderer` on the section says which). Playwright's headless
 * Chromium has software WebGL (SwiftShader), so the animated tests below run on
 * the WebGL path; the last group blocks WebGL, and loses the context, to run the
 * fallback. Where a check differs between the two it reads `data-renderer`, so
 * none of them is weaker on either path.
 */

// The desktop project's default window is 1280x720. The animated tests below
// run at 1280x800 instead, as they were written. Since the desktop hero scales
// down with the window's height, the stage is on at 1280x720 too (and down to
// 600 px tall): home-stage-short.spec.ts runs the short windows.
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === "chromium") {
    await page.setViewportSize({ width: 1280, height: 800 });
  }
});

/** The first screen's whole layout shift. Strict (0.001) unless the local wide-font simulation says so. */
const TOTAL_CLS_BOUND = process.env.WIDE_FONT_RUN === "1" ? 0.02 : 0.001;

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

    // Frame by frame: exactly one logo on show, before, during and after. On
    // the WebGL path the logo is on the WebGL canvas, so that one has to be on
    // show and drawn too; the 2D canvas on top of it only carries the overlay.
    const renderer = await page.locator(STORY).getAttribute("data-renderer");
    const frames = await read<
      {
        logo: boolean;
        canvas: boolean;
        drawn: number;
        gl: boolean;
        glDrawn: number;
      }[]
    >(page, "__frames");
    expect(frames.length).toBeGreaterThan(10);
    const shown = frames.map(
      (f) =>
        Number(f.logo) +
        Number(
          f.canvas &&
            f.drawn > 0 &&
            (renderer === "webgl" ? f.gl && f.glDrawn > 0 : true),
        ),
    );
    expect(shown.filter((n) => n !== 1)).toEqual([]);
    // It did switch: the first frames show the image, the last the canvas.
    expect(frames[0]!.logo).toBe(true);
    expect(frames.at(-1)!.logo).toBe(false);
    expect(frames.at(-1)!.canvas).toBe(true);
    if (renderer === "webgl") {
      expect(frames.at(-1)!.gl).toBe(true);
      // The WebGL canvas had drawn the logo before the class was added.
      expect(await read<number>(page, "__glDrawsAtSwitch")).toBeGreaterThan(0);
    }

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
      // Nothing moved from the moment the layout switched.
      expect(await read<number>(page, "__clsAfterSwitch")).toBe(0);
      // And the whole first screen stays put. On CI, and by default, that is
      // strict. The local wide-font simulation serves DejaVu Sans as a web
      // font, which swaps in after load and is worth about 0.005 on the static
      // page too, so a run with WIDE_FONT_RUN=1 allows for it.
      expect(await read<number>(page, "__cls")).toBeLessThanOrEqual(
        TOTAL_CLS_BOUND,
      );
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

  for (const [width, height] of [
    [375, 667],
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`${width}x${height}: no sideways scroll, and nothing sticks out of the viewport, at the top, mid-story and at the last step`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await waitForAnimated(page);
      for (const p of [0, 0.5, 0.95]) {
        await scrollToProgress(page, p);
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
                `${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}`,
            );
          return {
            fits: document.documentElement.scrollWidth <= window.innerWidth,
            outside,
          };
        });
        expect(result, `p=${p}`).toEqual({ fits: true, outside: [] });
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

  test.describe("the keyboard", () => {
    /** What has the focus: where it is, whether it shows a ring, and whether it is on screen. */
    const focused = (page: import("@playwright/test").Page) =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? "").trim().slice(0, 40),
          inHero: el.closest('[data-testid="home-hero"]') !== null,
          inFinal: el.closest('[data-testid="home-final"]') !== null,
          tabindex: el.getAttribute("tabindex"),
          inert: el.closest("[inert]") !== null,
          focusVisible: el.matches(":focus-visible"),
          outline: {
            style: style.outlineStyle,
            width: style.outlineWidth,
            colour: style.outlineColor,
          },
          onScreen:
            box.top >= 0 &&
            box.bottom <= window.innerHeight &&
            box.left >= 0 &&
            box.right <= window.innerWidth,
          hit: (() => {
            const hit = document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
            return hit === el || el.contains(hit);
          })(),
        };
      });
    /** Put the focus on the nav's menu button without scrolling: the last tab stop before the hero. */
    const focusMenuButton = (page: import("@playwright/test").Page) =>
      page.evaluate(() => {
        const menu = document.querySelector<HTMLElement>(
          'button[aria-label="Open menu"], .navMenuTrigger',
        )!;
        menu.focus({ preventScroll: true });
      });

    test("at p = 0, Tab from the top of the page reaches the hero's two links, and each shows the focus ring", async ({
      page,
    }) => {
      await page.goto("/");
      await waitForAnimated(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.locator(STORY)).toHaveAttribute(
        "data-progress",
        "0.000",
      );
      const stops: Awaited<ReturnType<typeof focused>>[] = [];
      for (
        let i = 0;
        i < 6 && stops.filter((s) => s?.inHero).length < 2;
        i += 1
      ) {
        await page.keyboard.press("Tab");
        stops.push(await focused(page));
      }
      const hero = stops.filter((s) => s?.inHero);
      expect(hero.map((s) => s!.text)).toEqual([
        "Scan my hand",
        "How it works",
      ]);
      for (const stop of hero) {
        expect(stop!.inert).toBe(false);
        expect(stop!.focusVisible).toBe(true);
        // The ring is the accent text colour, 2 px, and nothing covers the link.
        expect(stop!.outline).toEqual({
          style: "solid",
          width: "2px",
          colour: "rgb(127, 168, 255)",
        });
        expect(stop!.onScreen).toBe(true);
        expect(stop!.hit).toBe(true);
      }
    });

    test("at p = 0.5, Tab and Shift+Tab skip the hero's links", async ({
      page,
    }) => {
      await page.goto("/");
      await waitForAnimated(page);
      await scrollToProgress(page, 0.5);
      // Forward: from the menu button (above the hero) the next tab stop is
      // the final section's button, not the hero's.
      await focusMenuButton(page);
      await page.keyboard.press("Tab");
      let stop = await focused(page);
      expect(stop).toMatchObject({
        inHero: false,
        inFinal: true,
        text: "Scan my hand",
      });
      // Backward: from the final section the previous stop is the menu button.
      await scrollToProgress(page, 1);
      await page.evaluate(() =>
        document
          .querySelector<HTMLElement>('[data-testid="home-final"] a')!
          .focus({ preventScroll: true }),
      );
      await page.keyboard.press("Shift+Tab");
      stop = await focused(page);
      expect(stop).toMatchObject({ inHero: false, tag: "button" });
    });

    test("scrolling down while a hero link has the focus moves the focus to the h1, not to the body; scrolling back does not take it back, and Tab reaches the links again", async ({
      page,
    }) => {
      await page.goto("/");
      await waitForAnimated(page);
      await scrollToProgress(page, 0);
      await page
        .locator(HERO)
        .getByRole("link", { name: "How it works" })
        .focus();
      expect((await focused(page))?.text).toBe("How it works");
      // Down: the links turn inert, and the focus lands on the h1.
      await scrollToProgress(page, 0.5);
      const heading = await focused(page);
      expect(heading).toMatchObject({
        tag: "h1",
        text: "Find the mouse that fits.",
        tabindex: "-1",
        inert: false,
      });
      // Not a tab stop: Tab from here goes on, and never to a hero link.
      await page.keyboard.press("Tab");
      expect((await focused(page))?.inHero).toBe(false);
      // Back up: the links work again, the focus stays where it is (the h1 or
      // wherever Tab took it), and Tab from the menu button reaches the links.
      await scrollToProgress(page, 0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.locator(STORY)).toHaveAttribute(
        "data-progress",
        "0.000",
      );
      await expect(page.locator(HERO).getByRole("link")).toHaveCount(2);
      expect(await page.locator(HERO).locator("a[inert]").count()).toBe(0);
      await focusMenuButton(page);
      await page.keyboard.press("Tab");
      expect(await focused(page)).toMatchObject({
        inHero: true,
        text: "Scan my hand",
        focusVisible: true,
      });
    });

    test("with nothing focused, scrolling down leaves the focus where it was: on the body", async ({
      page,
    }) => {
      await page.goto("/");
      await waitForAnimated(page);
      await page.evaluate(() =>
        (document.activeElement as HTMLElement)?.blur(),
      );
      await scrollToProgress(page, 0.5);
      expect((await focused(page))?.tag).toBe("body");
      expect(await page.locator("h1").getAttribute("tabindex")).toBeNull();
    });
  });

  test("the canvases are decorative: aria-hidden, under the hero, and they take no clicks", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    const renderer = await page.locator(STORY).getAttribute("data-renderer");
    // The WebGL layer is under the 2D one, the same size, in the same place, and just as inert.
    if (renderer === "webgl") {
      const gl = page.locator(GL_CANVAS);
      await expect(gl).toHaveAttribute("aria-hidden", "true");
      const layer = await gl.evaluate((el) => {
        const style = getComputedStyle(el);
        const panel = el.closest(".story-panel")!.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        return {
          position: style.position,
          zIndex: style.zIndex,
          pointerEvents: style.pointerEvents,
          sameAsPanel:
            Math.abs(rect.x - panel.x) < 1 &&
            Math.abs(rect.y - panel.y) < 1 &&
            Math.abs(rect.width - panel.width) < 1 &&
            Math.abs(rect.height - panel.height) < 1,
          // Under the 2D canvas: the one just before it, with the same z-index.
          isBelowTheOverlay:
            el.nextElementSibling?.classList.contains("story-canvas") ?? false,
          heroZ: getComputedStyle(document.querySelector(".story-hero")!)
            .zIndex,
        };
      });
      expect(layer).toMatchObject({
        position: "absolute",
        zIndex: "0",
        pointerEvents: "none",
        sameAsPanel: true,
        isBelowTheOverlay: true,
        heroZ: "1",
      });
    } else {
      // On the 2D path the lower canvas stays hidden.
      expect((await layoutFacts(page)).glCanvasDisplay).toBe("none");
    }
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
    // "story-canvas" is also in "story-canvas-gl": neither layer is hit.
    expect(hit.middle).not.toContain("story-canvas");
    expect(hit.low).not.toContain("story-canvas");
    // The finale's headline and drawing (and everything else in the stage)
    // take no clicks either.
    await scrollToProgress(page, 0.95);
    const overFinale = await page.evaluate(() => {
      const title = document
        .querySelector(".story-finale-title")!
        .getBoundingClientRect();
      const el = document.elementFromPoint(
        title.x + title.width / 2,
        title.y + title.height / 2,
      );
      return el?.closest(".story-finale") === null;
    });
    expect(overFinale).toBe(true);
  });

  for (const [how, breakIt] of [
    [
      "a canvas that will not hand its pixels back",
      () => {
        const proto = (
          globalThis as unknown as {
            OffscreenCanvasRenderingContext2D?: { prototype: object };
          }
        ).OffscreenCanvasRenderingContext2D?.prototype as
          { getImageData: () => never } | undefined;
        const fail = () => {
          throw new Error("no pixels (test)");
        };
        if (proto) proto.getImageData = fail;
        (
          CanvasRenderingContext2D.prototype as unknown as {
            getImageData: () => never;
          }
        ).getImageData = fail;
      },
    ],
    [
      "a canvas that does not report its font's ascent (Firefox before 116)",
      () => {
        for (const ctor of [
          (
            globalThis as unknown as {
              OffscreenCanvasRenderingContext2D?: {
                prototype: { measureText(t: string): TextMetrics };
              };
            }
          ).OffscreenCanvasRenderingContext2D,
          CanvasRenderingContext2D,
        ]) {
          if (!ctor) continue;
          const measure = ctor.prototype.measureText;
          ctor.prototype.measureText = function (this: unknown, t: string) {
            const m = measure.call(this, t);
            return new Proxy(m, {
              get: (target, key) =>
                key === "fontBoundingBoxAscent" ||
                key === "fontBoundingBoxDescent"
                  ? undefined
                  : Reflect.get(target, key),
            });
          };
        }
      },
    ],
  ] as const) {
    test(`the finale's headline is shown as DOM text when its layer can not be built (${how}): it fades in with its window, and nothing throws`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(breakIt);
      await page.goto("/");
      await waitForAnimated(page);
      await expect(page.locator(STORY)).toHaveAttribute("data-finale", "off");
      const title = page.getByRole("heading", { level: 2, name: FINALE_TITLE });
      const opacity = async () =>
        Number(await title.evaluate((el) => getComputedStyle(el).opacity));
      await scrollToProgress(page, 0.5);
      expect(await opacity()).toBe(0);
      await scrollToProgress(page, 1);
      expect(await opacity()).toBe(1);
      await expect(title).toBeVisible();
      // The rest of the story goes on: the stage is still the animated one.
      expect((await layoutFacts(page)).animated).toBe(true);
      expect(errors).toEqual([]);
    });
  }

  test("with forced colours the finale's headline is DOM text in the system's text colour (the canvas leaves it out)", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/");
    await waitForAnimated(page);
    const title = page.getByRole("heading", { level: 2, name: FINALE_TITLE });
    await scrollToProgress(page, 0.5);
    expect(
      Number(await title.evaluate((el) => getComputedStyle(el).opacity)),
    ).toBe(0);
    await scrollToProgress(page, 1);
    const style = await title.evaluate((el) => {
      const probe = document.createElement("span");
      probe.style.color = "CanvasText";
      document.body.append(probe);
      const canvasText = getComputedStyle(probe).color;
      probe.remove();
      const s = getComputedStyle(el);
      return { opacity: s.opacity, color: s.color, canvasText };
    });
    expect(style.opacity).toBe("1");
    expect(style.color).toBe(style.canvasText);
    await expect(title).toBeVisible();
  });

  for (const [width, height] of [
    [1600, 900],
    [1920, 1080],
  ] as const) {
    test(`${width}x${height}: the finale's sky spans the whole viewport's width (not only the content column), with no sideways scroll`, async ({
      page,
    }, info) => {
      test.skip(info.project.name !== "chromium", "Desktop widths.");
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await waitForAnimated(page);
      await scrollToProgress(page, 1);
      const sky = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>(".story-canvas-sky")!;
        const r = el.getBoundingClientRect();
        const column = document
          .querySelector(".story-panel")!
          .getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          drawnWidth: Number(el.dataset.width),
          viewport: document.documentElement.clientWidth,
          columnWidth: column.width,
          fits: document.documentElement.scrollWidth <= window.innerWidth,
        };
      });
      expect(sky.columnWidth).toBeLessThan(sky.viewport);
      expect(Math.abs(sky.left)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(sky.right - sky.viewport)).toBeLessThanOrEqual(0.5);
      expect(sky.drawnWidth).toBe(sky.viewport);
      expect(sky.fits).toBe(true);
    });
  }

  test("a change of the window's width alone (1900 to 1500 and back, and a zoom to 125 %) moves the viewport-wide sky and light with it: no sideways scroll, no gap on the right", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "chromium", "Desktop widths.");
    const wide = async () =>
      page.evaluate(() => {
        const box = (selector: string) => {
          const r = document.querySelector(selector)!.getBoundingClientRect();
          return { left: r.left, right: r.right };
        };
        return {
          sky: box(".story-canvas-sky"),
          glow: box(".story-finale-glow"),
          viewport: document.documentElement.clientWidth,
          fits: document.documentElement.scrollWidth <= window.innerWidth,
        };
      });
    const expectSpans = async (label: string) => {
      // The reflow is a frame after the resize: wait for the layers to follow.
      await expect
        .poll(
          async () => {
            const w = await wide();
            return (
              Math.abs(w.sky.right - w.viewport) <= 0.5 &&
              Math.abs(w.glow.right - w.viewport) <= 0.5
            );
          },
          { message: label },
        )
        .toBe(true);
      const w = await wide();
      expect(w.fits, label).toBe(true);
      for (const layer of [w.sky, w.glow]) {
        expect(Math.abs(layer.left), label).toBeLessThanOrEqual(0.5);
        expect(Math.abs(layer.right - w.viewport), label).toBeLessThanOrEqual(
          0.5,
        );
      }
    };
    await page.setViewportSize({ width: 1900, height: 900 });
    await page.goto("/");
    await waitForAnimated(page);
    await scrollToProgress(page, 1);
    await expectSpans("at 1900");
    // Above the column's 78rem cap: the section, the hero and the 100svh
    // probe keep their sizes; only the window's width changes.
    await page.setViewportSize({ width: 1500, height: 900 });
    await expectSpans("1900 to 1500");
    await page.setViewportSize({ width: 1900, height: 900 });
    await expectSpans("1500 to 1900");
    // A browser zoom of 125 %: fewer CSS px across at a higher pixel ratio.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1520,
      height: 720,
      deviceScaleFactor: 1.25,
      mobile: false,
    });
    await expectSpans("a zoom to 125 %");
    await cdp.send("Emulation.clearDeviceMetricsOverride");
  });

  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`${width}x${height} at 200 % text: no sideways scroll at the top, mid-story and at the end`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
      });
      await page.waitForTimeout(2500);
      for (const y of [0, 0.5, 1]) {
        await page.evaluate((share) => {
          const max =
            document.documentElement.scrollHeight - window.innerHeight;
          window.scrollTo(0, Math.round(max * share));
        }, y);
        await page.waitForTimeout(150);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          `at ${y} of the page`,
        ).toBe(true);
      }
    });
  }

  test("the seam: the two meteors' heads sit in the footer's top padding, under its horizon, above its text", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    await scrollToProgress(page, 1);
    const seam = await page.evaluate(() => {
      const footer = document.querySelector<HTMLElement>(
        '[data-testid="site-footer"]',
      )!;
      const horizon = footer.querySelector(".siteFooter-horizon")!;
      const before = getComputedStyle(horizon, "::before");
      const after = getComputedStyle(horizon, "::after");
      const footerTop = footer.getBoundingClientRect().top;
      return {
        content: [before.content, after.content],
        transform: before.transform,
        // Where the heads are (the pseudo-elements' top edge, from the
        // horizon at the footer's top), and the footer's top padding.
        head: horizon.getBoundingClientRect().top + parseFloat(before.top),
        footerTop,
        footerPad: parseFloat(getComputedStyle(footer).paddingTop),
      };
    });
    expect(seam.content).toEqual(['""', '""']);
    expect(seam.transform).not.toBe("none");
    expect(seam.head).toBeGreaterThan(seam.footerTop);
    expect(seam.head).toBeLessThan(seam.footerTop + seam.footerPad);
  });

  test("the finale's light is really drawn: its gradient is a valid one (a circle's radius in lengths), and shows at p = 1", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    await scrollToProgress(page, 1);
    const glow = await page.locator(".story-finale-glow").evaluate((el) => {
      const s = getComputedStyle(el);
      return { image: s.backgroundImage, opacity: s.opacity };
    });
    // An invalid gradient (a percentage in a circle's radius) computes to none.
    expect(glow.image).toContain("radial-gradient");
    expect(glow.opacity).toBe("1");
  });

  test("the finale's headline is real text all along (the canvas draws it), and its light fades in with the finale", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    // The headline stays in the DOM and the accessibility tree at every p:
    // transparent, because the canvas draws its letters.
    const title = page.getByRole("heading", { level: 2, name: FINALE_TITLE });
    const glow = page.locator(".story-finale-glow");
    const opacity = async (locator: import("@playwright/test").Locator) =>
      Number(await locator.evaluate((el) => getComputedStyle(el).opacity));
    for (const p of [0, 0.3, 0.5, 0.7]) {
      await scrollToProgress(page, p);
      await expect(title).toHaveCount(1);
      expect(await opacity(title), `p=${p}`).toBe(0);
      expect(await opacity(glow), `p=${p}`).toBe(0);
    }
    await scrollToProgress(page, 0.95);
    await expect(title).toHaveCount(1);
    expect(await opacity(glow)).toBe(1);
    // And back again.
    await scrollToProgress(page, 0.5);
    expect(await opacity(glow)).toBe(0);
  });

  test("the story's pieces appear in order: hero, scatter, hand, measured hand, rearranging, the finale", async ({
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

    // The five annotations come with the measured hand (story 4, a little into
    // 5) and at no other time: none before it, none once the finale comes.
    const notes = page.locator(".story-note");
    await expect(notes).toHaveCount(5);
    const shown = () =>
      notes.evaluateAll((els) =>
        els.map((el) => Number(getComputedStyle(el).opacity)),
      );
    for (const p of [0, 0.1, 0.2, 0.35, 0.8, 1]) {
      await scrollToProgress(page, p);
      expect(await shown(), `p=${p}`).toEqual([0, 0, 0, 0, 0]);
    }
    // The middle of the second window: the palm width is whole, the rest hidden.
    await scrollToProgress(page, 0.46);
    expect(await shown()).toEqual([0, 1, 0, 0, 0]);
  });

  test("at p = 1 the panel lets go: the finale scrolls away with it, and the final section's buttons are already up over its bottom", async ({
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
        const title = document
          .querySelector(".story-finale-title")!
          .getBoundingClientRect();
        const final = document
          .querySelector('[data-testid="home-final"]')!
          .getBoundingClientRect();
        const actions = document
          .querySelector('[data-testid="home-final"] .home-actions')!
          .getBoundingClientRect();
        return {
          panelTop: panel.top,
          panelBottom: panel.bottom,
          title: title.top,
          titleBottom: title.bottom,
          final: final.top,
          actionsTop: actions.top,
          actionsBottom: actions.bottom,
          viewport: window.innerHeight,
        };
      });
    const pinned = await at();
    // Pinned: the panel fills the viewport.
    expect(Math.abs(pinned.panelTop)).toBeLessThanOrEqual(1);
    // The final section comes up over the bottom of the panel (the finale's
    // design: the buttons under the figure, in the same picture), by 20 svh on
    // a desktop and 33 svh on a phone (home.css, candidate): its buttons are
    // whole in view, below the headline.
    const overlap = (pinned.panelBottom - pinned.final) / pinned.viewport;
    expect(overlap).toBeGreaterThan(0.15);
    expect(overlap).toBeLessThan(0.4);
    expect(pinned.actionsTop).toBeGreaterThan(pinned.titleBottom);
    expect(pinned.actionsBottom).toBeLessThanOrEqual(pinned.viewport);

    // Scroll 120 px further: the panel, the headline and the final section all moved up by 120.
    await page.evaluate(() => window.scrollBy(0, 120));
    await page.waitForTimeout(150);
    const moved = await at();
    expect(moved.panelTop).toBeCloseTo(pinned.panelTop - 120, 0);
    expect(moved.title).toBeCloseTo(pinned.title - 120, 0);
    expect(moved.final).toBeCloseTo(pinned.final - 120, 0);
    // The finale is still p = 1's state: nothing was redrawn or changed.
    await expect(page.locator(STORY)).toHaveAttribute("data-progress", "1.000");
    await expect(page.locator(".story-finale-glow")).toHaveCSS("opacity", "1");
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
    // It really played: dozens of frames in its first seconds. On the WebGL
    // path every one of them is a draw call, and the last is inside 3 s too.
    expect(draws.length).toBeGreaterThan(30);
    if ((await page.locator(STORY).getAttribute("data-renderer")) === "webgl") {
      const glDraws = await read<number[]>(page, "__glDraws");
      expect(glDraws.length).toBeGreaterThan(30);
      expect(Math.max(...glDraws) - activatedAt).toBeLessThan(3000);
    }
    // And it ended inside 3 s (WCAG 2.2.2): the last draw is before activation + 3 s.
    const lastOffset = Math.max(...draws) - activatedAt;
    expect(lastOffset).toBeLessThan(3000);
    expect(lastOffset).toBeGreaterThan(1500);

    // Then it is still: no draw and no requestAnimationFrame call for 2 s.
    const settled = {
      draws: (await read<number[]>(page, "__draws")).length,
      glDraws: (await read<number[]>(page, "__glDraws")).length,
      raf: await read<number>(page, "__raf"),
      attr: await page.locator(CANVAS).getAttribute("data-draws"),
    };
    await page.waitForTimeout(2000);
    expect((await read<number[]>(page, "__draws")).length).toBe(settled.draws);
    // The WebGL canvas is still too: no draw call, no frame requested.
    expect((await read<number[]>(page, "__glDraws")).length).toBe(
      settled.glDraws,
    );
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

  test("resizing the window redraws the canvas in the same task that clears it: no frame is shown empty", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    const activatedAt = await read<number>(page, "__activatedAt");
    await page.waitForFunction(
      (start) => performance.now() - start > 3400,
      activatedAt,
    );
    await scrollToProgress(page, 0.5);
    await page.evaluate(() => {
      (window as unknown as { __canvasLog: string[] }).__canvasLog.length = 0;
    });
    const size = page.viewportSize()!;
    for (const [dw, dh] of [
      [-60, 0],
      [-30, -40],
      [20, 30],
      [60, 0],
    ]) {
      await page.setViewportSize({
        width: size.width + dw!,
        height: size.height + dh!,
      });
      await page.waitForTimeout(250);
    }
    const log = await read<string[]>(page, "__canvasLog");
    const resizes = log.filter((entry) => entry === "resize").length;
    expect(resizes).toBeGreaterThanOrEqual(4);
    // After every resize, the next thing that happens to the canvas is a draw
    // (or another resize of the same task), never the start of a new frame.
    const empty: number[] = [];
    log.forEach((entry, i) => {
      if (entry !== "resize") return;
      const next = log.slice(i + 1).find((e) => e !== "resize");
      if (next !== "draw") empty.push(i);
    });
    expect(empty).toEqual([]);
    // The WebGL canvas, too, is redrawn in the task that resizes it.
    if ((await page.locator(STORY).getAttribute("data-renderer")) === "webgl") {
      const glLog = await read<string[]>(page, "__glLog");
      expect(
        glLog.filter((entry) => entry === "resize").length,
      ).toBeGreaterThan(0);
      const glEmpty: number[] = [];
      glLog.forEach((entry, i) => {
        if (entry !== "resize") return;
        const next = glLog.slice(i + 1).find((e) => e !== "resize");
        if (next !== "draw") glEmpty.push(i);
      });
      expect(glEmpty).toEqual([]);
    }
    await expect(page.locator(STORY)).toHaveAttribute("data-progress", /^0\.5/);
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

  test("axe finds no WCAG 2.2 AA violation on the animated page: at the top, mid-story and at the last step", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    const activatedAt = await read<number>(page, "__activatedAt");
    await page.waitForFunction(
      (start) => performance.now() - start > 3400,
      activatedAt,
    );
    // Including a note's whole window: the large and small lines are measured
    // for contrast where they are shown (p = 0.42 is the first note, 0.58 the last).
    for (const p of [0, 0.42, 0.5, 0.58, 0.95]) {
      await scrollToProgress(page, p);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        results.violations.map(
          (v) =>
            `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
        ),
        `p=${p}`,
      ).toEqual([]);
    }
  });

  test("printing from an animated page, as print-pages.spec.ts does (print and reduced motion emulated together), prints dark text on white, wherever the story was", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    for (const p of [0, 0.5, 0.95]) {
      await scrollToProgress(page, p);
      await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
      // The preference also takes the stage back to the static layout, a frame later.
      await expect(page.locator(STORY)).not.toHaveClass(/story--animated/, {
        timeout: 10_000,
      });
      const facts = await layoutFacts(page);
      expect(facts.sectionHeight, `p=${p}`).toBe(facts.panelHeight);
      expect(facts.heroOpacity, `p=${p}`).toBe("1");
      expect(facts.canvasDisplay, `p=${p}`).toBe("none");
      expect(facts.glCanvasDisplay, `p=${p}`).toBe("none");
      await expectPrintsDark(page, `home printed after p=${p}`, {
        root: "body",
        minSamples: 2,
      });
      // Screen again, motion allowed: the stage comes back for the next p.
      await page.emulateMedia({
        media: "screen",
        reducedMotion: "no-preference",
      });
      await waitForAnimated(page);
    }
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
    expect(facts.glCanvasDisplay).toBe("none");
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

    test("the WebGL canvas's is at most twice on a wide screen and 1.5 times on a narrow one", async ({
      page,
    }) => {
      await page.goto("/");
      await waitForAnimated(page);
      test.skip(
        (await page.locator(STORY).getAttribute("data-renderer")) !== "webgl",
        "The 2D path has no WebGL canvas.",
      );
      const size = await page.locator(GL_CANVAS).evaluate((el) => {
        const c = el as HTMLCanvasElement;
        const rect = c.getBoundingClientRect();
        return {
          w: c.width,
          h: c.height,
          cssW: rect.width,
          cssH: rect.height,
          wide: matchMedia("(min-width: 48rem)").matches,
        };
      });
      const scale = size.wide ? 2 : 1.5;
      expect(size.w).toBe(Math.round(size.cssW * scale));
      expect(size.h).toBe(Math.round(size.cssH * scale));
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
    // The WebGL canvas: the ratio capped at 2 (wide) or 1.5 (narrow).
    if ((await page.locator(STORY).getAttribute("data-renderer")) === "webgl") {
      const gl = await page.locator(GL_CANVAS).evaluate((el) => {
        const c = el as HTMLCanvasElement;
        return {
          w: c.width,
          cssW: c.getBoundingClientRect().width,
          wide: matchMedia("(min-width: 48rem)").matches,
        };
      });
      const cap = gl.wide ? 2 : 1.5;
      expect(gl.w).toBe(Math.round(gl.cssW * Math.min(Math.max(dpr, 1), cap)));
    }
  });

  for (const [cores, label] of [
    [8, "8 cores"],
    [4, "4 cores"],
    [2, "2 cores"],
  ] as const) {
    test(`the particle budget with ${label}: 7,500 on a phone and 15,000 on a desktop with WebGL (900 and 1,300 on Canvas 2D), halved at 4 or fewer`, async ({
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
      const webgl =
        (await page.locator(STORY).getAttribute("data-renderer")) === "webgl";
      const expected = webgl
        ? cores <= 4
          ? wide
            ? 7500
            : 3750
          : wide
            ? 15000
            : 7500
        : cores <= 4
          ? wide
            ? 650
            : 450
          : wide
            ? 1300
            : 900;
      // (648 and 1,299 while three mice each took a third: the finale is one
      // drawing, 2026-10-11, so the budgets are whole.)
      await expect(page.locator(CANVAS)).toHaveAttribute(
        "data-particles",
        String(expected),
      );
      // Nothing has been slow yet, so all of them are drawn.
      await expect(page.locator(CANVAS)).toHaveAttribute(
        "data-drawn",
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
    expect(facts.glCanvasDisplay).toBe("none");
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

  test("changing only the window's height switches the stage on and off at the 600 px line", async ({
    page,
  }) => {
    // 700 wide: the hero is short enough to fit whenever the height is 600 or more.
    await page.setViewportSize({ width: 700, height: 560 });
    await page.goto("/");
    // The module has had time to load and has declined: the viewport is too short.
    await page.waitForTimeout(4000);
    expect((await layoutFacts(page)).animated).toBe(false);
    // Taller: on, with nothing but the height changed.
    await page.setViewportSize({ width: 700, height: 800 });
    await waitForAnimated(page);
    expect((await layoutFacts(page)).logoVisibility).toBe("hidden");
    // Shorter again: off, and the static page is whole.
    await page.setViewportSize({ width: 700, height: 560 });
    await expect(page.locator(STORY)).not.toHaveClass(/story--animated/, {
      timeout: 10_000,
    });
    const facts = await layoutFacts(page);
    expect(facts.sectionHeight).toBe(facts.panelHeight);
    expect(facts.logoVisibility).toBe("visible");
    expect(facts.heroOpacity).toBe("1");
    expect(facts.canvasDisplay).toBe("none");
    expect(facts.glCanvasDisplay).toBe("none");
    // And on again.
    await page.setViewportSize({ width: 700, height: 600 });
    await waitForAnimated(page);
  });

  test("changing only the window's height switches the stage on and off where the hero stops fitting in 100svh", async ({
    page,
  }) => {
    // The desktop hero scales down with the height, so at 100 % text it fits
    // every window from 600 px up (home-stage-short.spec.ts). The fit check is
    // still the rule, and it is what this exercises: at 200 % text the
    // headline wraps to two lines (in either font) and everything doubles, so
    // the hero is 966 px in an 800 px window (the logo slot at its 14 rem
    // floor, 448 px) and 1,474 px once the slot reaches its 29 rem cap
    // (928 px), which it does from about 1,480 px of height up. The stage is
    // switched on at 1,600 px: the slot is capped there, so the hero no longer
    // changes with the window and has 126 px to spare, which does not depend
    // on the shrink's 0.5rem of room (between about 800 and 1,480 px the slot
    // fills the window to within 2 px, so those heights say nothing about the
    // fit check). Only the window's height changes below.
    await page.setViewportSize({ width: 1280, height: 1600 });
    await page.goto("/");
    await waitForAnimated(page);
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.id = "zoom";
      style.textContent = "html { font-size: 200% }";
      document.head.append(style);
    });
    const measure = () =>
      page.evaluate(() => ({
        hero: document.querySelector<HTMLElement>('[data-testid="home-hero"]')!
          .offsetHeight,
        slot: document.querySelector(".story-logo")!.getBoundingClientRect()
          .height,
        rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      }));
    const tall = await measure();
    expect(tall.rem).toBe(32);
    // The slot is at its cap, so there is room whatever the shrink's margin.
    expect(tall.slot).toBe(29 * tall.rem);
    expect(tall.hero).toBeLessThanOrEqual(1600 - 100);
    // It fits: the stage stays on.
    await expect(page.locator(STORY)).toHaveClass(/story--animated/);
    // Too tall for 800 (by 160 px or more): off, and the static page is whole.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator(STORY)).not.toHaveClass(/story--animated/, {
      timeout: 10_000,
    });
    expect((await measure()).hero).toBeGreaterThan(800 + 100);
    expect((await layoutFacts(page)).canvasDisplay).toBe("none");
    expect((await layoutFacts(page)).glCanvasDisplay).toBe("none");
    // Tall enough again: on. Too short again: off.
    await page.setViewportSize({ width: 1280, height: 1600 });
    await waitForAnimated(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator(STORY)).not.toHaveClass(/story--animated/, {
      timeout: 10_000,
    });
    const facts = await layoutFacts(page);
    expect(facts.sectionHeight).toBe(facts.panelHeight);
    expect(facts.logoVisibility).toBe("visible");
    expect(facts.inert).toBe(0);
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
        ".story-notes",
        ".story-finale",
        '[data-testid="home-final"]',
        '[data-testid="site-footer"]',
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
      expect(facts.glCanvasDisplay).toBe("none");
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
      // The three static end states are all there: the finale is its
      // drawing under its headline.
      await expect(page.locator(".story-logo img")).toBeVisible();
      await expect(page.locator(".story-hand img")).toBeVisible();
      await expect(page.locator(".story-finale-art img")).toBeVisible();
      await expect(
        page.getByRole("heading", { level: 2, name: FINALE_TITLE }),
      ).toBeVisible();
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
      expect(facts.glCanvasDisplay).toBe("none");
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
      await expect(
        page.getByRole("heading", { level: 2, name: FINALE_TITLE }),
      ).toBeVisible();
      await expect(page.locator(".story-finale-art img")).toBeVisible();
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
      expect(facts.glCanvasDisplay).toBe("none");
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
    expect(facts.glCanvasDisplay).toBe("none");
    expect(facts.logoVisibility).toBe("visible");
    expect(facts.sectionHeight).toBe(facts.panelHeight);
    expect(await page.locator(CANVAS).getAttribute("data-draws")).toBeNull();
    const plain = await baseline(browser, size.width, size.height);
    expect(facts.scrollHeight).toBe(plain.scrollHeight);
    // The headline, the buttons and the finale are all still there and work.
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
    await expect(
      page.getByRole("heading", { level: 2, name: FINALE_TITLE }),
    ).toBeVisible();
    // A failed load is not an uncaught error.
    expect(errors).toEqual([]);
  });
});

test("the story section's markup: the hero first, the two canvases last (WebGL under the 2D one), one h1", async ({
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
  // The five annotations sit right after the hand they are about, as real text
  // in reading order; the canvas stays last.
  expect(order.children).toEqual([
    "story-hero",
    "story-hand",
    "story-notes",
    "story-finale",
    "story-canvas-sky",
    "story-canvas-gl",
    "story-canvas",
  ]);
  expect(order.h1).toBe(1);
});
