import { expect, test, type Page } from "@playwright/test";
import {
  CANVAS,
  STORY,
  heroGeometry,
  layoutFacts,
  logoInk,
  read,
  recordStage,
  scrollToProgress,
  waitForAnimated,
} from "./helpers/home-stage";

/**
 * Home v3: the particle stage on short laptop windows
 * (docs/design/home-v3-2026-10-03/README.md, "Short desktop windows").
 *
 * The stage still switches on only when the hero's measured height fits in
 * 100svh and the viewport is at least 600 px tall. What changed is the hero: at
 * 48rem and up its headline, two gaps and logo slot scale down continuously
 * with 100svh (home.css), so it fits every window from 600 px up, and the whole
 * hero (buttons and note too) is above the fold at the top of the page. The
 * same CSS runs with and without the stage, so switching shifts nothing.
 */

test.beforeEach(async ({}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Desktop and tablet windows: one project is enough.",
  );
});

/** The first screen's whole layout shift. Strict (0.001) unless the local wide-font simulation says so. */
const TOTAL_CLS_BOUND = process.env.WIDE_FONT_RUN === "1" ? 0.02 : 0.001;

/** How far the canvas's logo may be from the image's drawing (px). */
const LOGO_TOLERANCE = 3;

/** The shimmer is the one thing that moves on its own: after it, a frame is the stage at rest. */
async function waitForShimmerOver(page: Page) {
  const activatedAt = await read<number>(page, "__activatedAt");
  await page.waitForFunction(
    (start) => performance.now() - start > 3400,
    activatedAt,
  );
}

/** The module has been fetched and has had time to decline: the page stays static. */
async function waitForStageToDecline(page: Page) {
  await page.waitForFunction(() =>
    performance
      .getEntriesByType("resource")
      .some((entry) => entry.name.includes("particle-stage")),
  );
  await page.waitForTimeout(1500);
}

/** Where the hero's parts are on screen at the top of the page (viewport coordinates). */
async function firstScreen(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect();
    const hero = document.querySelector<HTMLElement>(
      '[data-testid="home-hero"]',
    )!;
    const panel = document.querySelector<HTMLElement>(".story-panel")!;
    const h1 = document.querySelector("h1")!;
    return {
      scrollY: window.scrollY,
      viewport: window.innerHeight,
      heroBottom: box('[data-testid="home-hero"]').bottom,
      heroHeight: hero.offsetHeight,
      panelHeight: panel.offsetHeight,
      actionsBottom: box('[data-testid="home-hero"] .home-actions').bottom,
      noteBottom: box('[data-testid="home-hero"] .landing-preview-note').bottom,
      links: [...hero.querySelectorAll("a")].map((a) => {
        const r = a.getBoundingClientRect();
        return { width: r.width, height: r.height };
      }),
      h1Size: parseFloat(getComputedStyle(h1).fontSize),
      h1Height: h1.getBoundingClientRect().height,
      scrollFits: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
}

/**
 * The stage is on at this size, the whole hero is above the fold, nothing
 * shifted when it switched on (and the hero is exactly where the page puts it
 * without the stage), and the canvas drew the logo where the image is.
 */
async function expectStageOn(
  page: Page,
  width: number,
  height: number,
  { oneLineHeadline = true } = {},
) {
  await recordStage(page);
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await waitForAnimated(page);
  await waitForShimmerOver(page);
  await page.evaluate(() => window.scrollTo(0, 0));

  const facts = await layoutFacts(page);
  expect(facts.animated).toBe(true);
  expect(facts.canvasDisplay).toBe("block");
  expect(facts.logoVisibility).toBe("hidden");

  // The whole hero is on the first screen, with the nav above it.
  const screen = await firstScreen(page);
  expect(screen.scrollY).toBe(0);
  expect(screen.heroBottom, "hero bottom").toBeLessThanOrEqual(height);
  expect(screen.actionsBottom, "buttons bottom").toBeLessThanOrEqual(height);
  expect(screen.noteBottom, "note bottom").toBeLessThanOrEqual(height);
  // And it fits the pinned panel, which is the stage's own rule.
  expect(screen.heroHeight).toBeLessThanOrEqual(screen.panelHeight);
  expect(screen.scrollFits).toBe(true);

  // What did not change: the headline is real (44 px or more) and one line,
  // and the two buttons keep a 44 x 44 px hit area.
  expect(screen.h1Size).toBeGreaterThanOrEqual(44);
  if (oneLineHeadline) {
    expect(screen.h1Height).toBeLessThan(screen.h1Size * 1.05 * 1.5);
  }
  expect(screen.links).toHaveLength(2);
  for (const link of screen.links) {
    expect(link.height).toBeGreaterThanOrEqual(44);
    expect(link.width).toBeGreaterThanOrEqual(44);
  }

  // Switching shifted nothing.
  expect(await read<number>(page, "__clsAfterSwitch")).toBe(0);
  // (The local wide-font simulation serves DejaVu Sans as a web font, which
  // swaps in after load. Where it wraps the headline, at 768 wide, the swap
  // moves the page by one line: that is the simulation, not the layout
  // switching, which is the 0 above. CI and the default run have no swap.)
  const clsBound =
    process.env.WIDE_FONT_RUN === "1" && !oneLineHeadline
      ? 0.05
      : TOTAL_CLS_BOUND;
  expect(await read<number>(page, "__cls")).toBeLessThanOrEqual(clsBound);
  const animated = await heroGeometry(page);
  const staticPage = await page.context().newPage();
  await staticPage.emulateMedia({ reducedMotion: "reduce" });
  await staticPage.setViewportSize({ width, height });
  await staticPage.goto("/");
  await staticPage.evaluate(() => document.fonts.ready);
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

  // The logo handoff: the canvas draws the mark where the (hidden) image is.
  const ink = await logoInk(page);
  expect(ink.empty).toBe(false);
  expect(ink.worst, JSON.stringify(ink.edges)).toBeLessThanOrEqual(
    LOGO_TOLERANCE,
  );
}

test.describe("short laptop windows animate", () => {
  for (const [width, height] of [
    [1280, 600],
    [1280, 640],
    [1366, 657],
    [1440, 700],
    [1536, 730],
  ] as const) {
    test(`${width}x${height}: the stage is on, the whole hero is above the fold, and the logo is handed over where the image was`, async ({
      page,
    }) => {
      await expectStageOn(page, width, height);
    });
  }

  test("768x1024 (a tablet held upright) is still animated, with the hero in full size", async ({
    page,
  }) => {
    // DejaVu Sans (CI) wraps the 60 px headline at 768 wide; Windows does not.
    await expectStageOn(page, 768, 1024, { oneLineHeadline: false });
    // Tall enough for the full-size hero: nothing is scaled down.
    const screen = await firstScreen(page);
    expect(screen.h1Size).toBe(60);
    const slot = await page
      .locator(".story-logo")
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(slot).toBe(29 * 16);
  });
});

test.describe("the five annotations animate on short laptop windows too", () => {
  // The middle of each note's window (see home-notes.spec.ts for the rest).
  const MIDDLES = [0.42, 0.46, 0.5, 0.54, 0.58] as const;

  for (const [width, height] of [
    [1280, 600],
    [1366, 657],
    [1440, 740],
  ] as const) {
    test(`${width}x${height}: each is whole in its window, beside the hand, inside the window and clear of the hand`, async ({
      page,
    }) => {
      await recordStage(page);
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await waitForAnimated(page);
      for (const [i, p] of MIDDLES.entries()) {
        await scrollToProgress(page, p);
        const facts = await page.evaluate((index) => {
          const note = document
            .querySelectorAll(".story-note")
            [index]!.getBoundingClientRect();
          const hand = document
            .querySelector(".story-hand img")!
            .getBoundingClientRect();
          const opacities = [...document.querySelectorAll(".story-note")].map(
            (el) => Number(getComputedStyle(el).opacity),
          );
          return {
            note: {
              left: note.left,
              right: note.right,
              top: note.top,
              bottom: note.bottom,
            },
            hand: { left: hand.left, right: hand.right },
            opacities,
            width: window.innerWidth,
            height: window.innerHeight,
          };
        }, i);
        const want = [0, 0, 0, 0, 0];
        want[i] = 1;
        expect(facts.opacities, `p=${p}`).toEqual(want);
        expect(facts.note.top).toBeGreaterThanOrEqual(0);
        expect(facts.note.bottom).toBeLessThanOrEqual(facts.height);
        expect(facts.note.left).toBeGreaterThanOrEqual(0);
        expect(facts.note.right).toBeLessThanOrEqual(facts.width);
        // Beside the hand: clear of its image, on its right (the thumb's, on its left).
        if (i < 4) {
          expect(facts.note.left).toBeGreaterThanOrEqual(facts.hand.right + 20);
        } else {
          expect(facts.note.right).toBeLessThanOrEqual(facts.hand.left - 20);
        }
      }
    });
  }
});

test.describe("below 600 px tall the page stays static", () => {
  for (const [width, height] of [
    [1280, 599],
    [1280, 575],
    [1366, 575],
  ] as const) {
    test(`${width}x${height}: static, with the same shrunken hero`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await waitForStageToDecline(page);
      const facts = await layoutFacts(page);
      expect(facts.animated).toBe(false);
      expect(facts.canvasDisplay).toBe("none");
      expect(facts.logoVisibility).toBe("visible");
      expect(facts.sectionHeight).toBe(facts.panelHeight);
      expect(await page.locator(CANVAS).getAttribute("data-draws")).toBeNull();
      // The hero is the scaled one here too (the same CSS, with and without
      // the stage), and the page does not scroll sideways.
      const screen = await firstScreen(page);
      expect(screen.h1Size).toBe(44);
      expect(screen.heroBottom).toBeLessThanOrEqual(height);
      expect(screen.scrollFits).toBe(true);
    });
  }
});

test.describe("the hero shrinks continuously with the window's height", () => {
  // The static page, which is the same hero without the stage.
  test.use({ reducedMotion: "reduce" });

  for (const width of [1280, 1440]) {
    test(`${width} wide: from 560 to 900 px tall the hero never jumps, never outgrows the first screen, and is full size from 740 px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      const step = 10;
      const series: {
        h: number;
        hero: number;
        bottom: number;
        slot: number;
        h1: number;
      }[] = [];
      for (let h = 560; h <= 900; h += step) {
        await page.setViewportSize({ width, height: h });
        series.push({
          h,
          ...(await page.evaluate(async () => {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const hero = document
              .querySelector('[data-testid="home-hero"]')!
              .getBoundingClientRect();
            return {
              hero: hero.height,
              bottom: hero.bottom,
              slot: document
                .querySelector(".story-logo")!
                .getBoundingClientRect().height,
              h1: parseFloat(
                getComputedStyle(document.querySelector("h1")!).fontSize,
              ),
            };
          })),
        });
      }

      for (const [i, now] of series.entries()) {
        // Always on the first screen: the buttons and the note are above the fold.
        expect(now.bottom, `bottom at ${now.h}`).toBeLessThanOrEqual(now.h);
        const before = series[i - 1];
        if (!before) continue;
        // Never shorter as the window gets taller, and never more than the
        // window gained (plus a pixel): a jump would be a step in the hero.
        for (const key of ["hero", "slot", "h1"] as const) {
          expect(now[key], `${key} at ${now.h}`).toBeGreaterThanOrEqual(
            before[key] - 0.01,
          );
        }
        expect(now.hero - before.hero, `hero at ${now.h}`).toBeLessThanOrEqual(
          step + 1,
        );
        expect(now.slot - before.slot, `slot at ${now.h}`).toBeLessThanOrEqual(
          step + 1,
        );
      }

      // The floor (44 px type) at the bottom, and the full size from 740 px up:
      // 29rem of slot, 60 px of type, the hero as it was before.
      const floor = series[0]!;
      expect(floor.h1).toBe(44);
      const full = series.filter((s) => s.h >= 740);
      expect(full.length).toBeGreaterThan(10);
      for (const s of full) {
        expect(s.slot, `slot at ${s.h}`).toBe(29 * 16);
        expect(s.h1, `h1 at ${s.h}`).toBe(60);
        expect(s.hero, `hero at ${s.h}`).toBe(full[0]!.hero);
      }
      // It really does shrink in between (this is not a test of a constant).
      const at = (h: number) => series.find((s) => s.h === h)!;
      expect(at(600).hero).toBeLessThan(at(740).hero - 100);
      expect(at(600).slot).toBeGreaterThan(14 * 16);
    });
  }
});

test.describe("dragging the window's height", () => {
  test("1280 wide, from 800 down to 600 and below, and back: the stage stays on down to 600, the hero follows the height, the logo stays on its mark, and 599 is static", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await recordStage(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await waitForAnimated(page);
    await waitForShimmerOver(page);

    const settle = async (height: number) => {
      await page.setViewportSize({ width: 1280, height });
      await expect(page.locator(STORY)).toHaveClass(/story--animated/);
      // The canvas is redrawn in the task that resizes it, and the logo is
      // read again from the page: it sits on the image wherever the image is.
      await expect
        .poll(async () => (await logoInk(page)).worst, {
          message: `the logo's edges at ${height}`,
        })
        .toBeLessThanOrEqual(LOGO_TOLERANCE);
      const screen = await firstScreen(page);
      expect(screen.heroBottom, `hero bottom at ${height}`).toBeLessThanOrEqual(
        height,
      );
      expect(screen.heroHeight).toBeLessThanOrEqual(screen.panelHeight);
    };
    for (const height of [760, 700, 640, 600]) await settle(height);

    // One pixel short of the stage's floor: static, and the page is whole.
    await page.setViewportSize({ width: 1280, height: 599 });
    await expect(page.locator(STORY)).not.toHaveClass(/story--animated/, {
      timeout: 10_000,
    });
    const facts = await layoutFacts(page);
    expect(facts.sectionHeight).toBe(facts.panelHeight);
    expect(facts.logoVisibility).toBe("visible");
    expect(facts.canvasDisplay).toBe("none");

    // And back up: on again, and the logo on its mark.
    await page.setViewportSize({ width: 1280, height: 640 });
    await waitForAnimated(page);
    await expect
      .poll(async () => (await logoInk(page)).worst)
      .toBeLessThanOrEqual(LOGO_TOLERANCE);
    await settle(900);
  });
});
