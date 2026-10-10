import { expect, test, type Page } from "@playwright/test";
import {
  planLateSwitch,
  storyAnchors,
} from "../../src/lib/particles/late-start";
import { START_RETRY_DELAYS_MS } from "../../src/lib/particles/retry";
import { STORY, layoutFacts, waitForAnimated } from "./helpers/home-stage";

/**
 * Home v3: the particle stage starts wherever the reader is
 * (src/lib/particles/late-start.ts), and a failed start is tried again a
 * bounded number of times (src/lib/particles/retry.ts).
 *
 * The stage used to switch on only while the reader was at the top: a reload
 * that restored a scrolled position, or a scroll while a slow phone was still
 * loading, left the page static until the reader went back up. Now:
 * - at the top it switches at once, as before (home-stage.spec.ts);
 * - elsewhere it waits until the reader holds still, then switches: inside the
 *   story behind a short fade of the panel (the scroll that puts the reader on
 *   the matching step happens while the panel is transparent), and with the
 *   story's end in view the bottom edge, and so the final section, stays put.
 *
 * The dynamic import of the stage module is held back (`page.route`) where a
 * test needs the reader to have scrolled before the stage is ready, so no
 * test depends on how long the dev server takes to compile it.
 */

test.beforeEach(async ({ page }, info) => {
  if (info.project.name === "chromium") {
    await page.setViewportSize({ width: 1280, height: 800 });
  }
});

/** The stage module's request (dev serves it as a chunk named after the file). */
const STAGE_CHUNK = /particle-stage/;

/**
 * How far the final section may move while the stage switches with the story's
 * end in view (CSS px). The scroll that keeps it in place is worked out from
 * rects measured in the same task, so the only error left is the browser
 * rounding the new scroll position (seen: 0.2 px at a pixel ratio of 1, 0.9 px
 * at 2). A failed compensation is off by the section's growth: over 1,000 px.
 */
const FINAL_TOLERANCE_PX = 1;
/** The panel counts as transparent at or under this opacity. */
const TRANSPARENT = 0.02;

/** Hold the stage module's request until `release` is called. */
async function holdStageModule(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(STAGE_CHUNK, async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

/**
 * Records, from before the page's own scripts run: `__switch`, the moment the
 * class went on (the scroll position, the section's top edge and the panel's
 * opacity then); and `__frames`, one entry per frame: the panel's opacity, the
 * final section's top edge, the scroll position, and whether the page was
 * animated.
 */
async function recordSwitch(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__switch = null;
    const frames: [number, number, number, boolean][] = [];
    w.__frames = frames;
    const add = DOMTokenList.prototype.add;
    DOMTokenList.prototype.add = function (...tokens: string[]) {
      if (tokens.includes("story--animated") && !w.__switch) {
        const panel = document.querySelector(".story-panel")!;
        const section = document.querySelector(".story")!;
        w.__switch = {
          scrollY: window.scrollY,
          sectionTop: section.getBoundingClientRect().top,
          panelOpacity: Number(getComputedStyle(panel).opacity),
        };
      }
      return add.apply(this, tokens);
    };
    const raf = window.requestAnimationFrame.bind(window);
    const sample = () => {
      const panel = document.querySelector(".story-panel");
      const final = document.querySelector(".home-final");
      const section = document.querySelector(".story");
      if (panel && final && section) {
        frames.push([
          Number(getComputedStyle(panel).opacity),
          final.getBoundingClientRect().top,
          window.scrollY,
          section.classList.contains("story--animated"),
        ]);
      }
      raf(sample);
    };
    raf(sample);
  });
}

type Switch = { scrollY: number; sectionTop: number; panelOpacity: number };
type FrameRow = [opacity: number, finalTop: number, scrollY: number, animated: boolean];

/** The static story's geometry, as the stage measures it before switching. */
async function staticGeometry(page: Page) {
  return page.evaluate(() => {
    const section = document.querySelector(".story")!.getBoundingClientRect();
    const block = (selector: string) => {
      const r = document.querySelector(selector)!.getBoundingClientRect();
      return { top: r.top - section.top, height: r.height };
    };
    return {
      staticTop: section.top,
      staticHeight: section.height,
      viewportHeight: window.innerHeight,
      hand: block(".story-hand"),
      notes: block(".story-notes"),
      mice: block(".story-mice"),
      finalTop: document.querySelector(".home-final")!.getBoundingClientRect()
        .top,
    };
  });
}

async function animatedGeometry(page: Page) {
  return page.evaluate(() => {
    const section = document.querySelector<HTMLElement>(".story")!;
    const panel = document.querySelector<HTMLElement>(".story-panel")!;
    return {
      animatedHeight: section.getBoundingClientRect().height,
      panelHeight: panel.offsetHeight,
      progress: Number(section.dataset.progress),
      finalTop: document.querySelector(".home-final")!.getBoundingClientRect()
        .top,
    };
  });
}

/** Wait until the late switch's fade in is over (the panel's own style is cleared then). */
async function waitForFadeOver(page: Page) {
  await page.waitForFunction(
    () => !document.querySelector<HTMLElement>(".story-panel")!.style.transition,
  );
  await page.waitForTimeout(100);
}

test.describe("starting away from the top", () => {
  test.beforeEach(async ({ page }) => {
    await recordSwitch(page);
  });

  test("① a reload at a scrolled position starts the stage there, without going back to the top", async ({
    page,
  }) => {
    await page.goto("/");
    // The first visit compiles the module in dev; the reload is the case.
    await waitForAnimated(page);
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(300);
    await page.reload();
    await waitForAnimated(page);
    const sw = await page.evaluate(
      () => (window as unknown as { __switch: Switch }).__switch,
    );
    // It switched with the reader away from the top, and left them there.
    expect(sw.sectionTop).toBeLessThan(0);
    await waitForFadeOver(page);
    const after = await animatedGeometry(page);
    expect(after.progress).toBeGreaterThan(0);
    expect(after.progress).toBeLessThan(1);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test("② a scroll while the page is still loading: the stage starts once the reader holds still", async ({
    page,
  }) => {
    const release = await holdStageModule(page);
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, 300));
    await page.waitForTimeout(300);
    expect((await layoutFacts(page)).animated).toBe(false);
    release();
    await waitForAnimated(page);
    const sw = await page.evaluate(
      () => (window as unknown as { __switch: Switch }).__switch,
    );
    expect(sw.scrollY).toBe(300);
    expect(sw.sectionTop).toBeLessThan(0);
  });

  test("③a inside the story: the reader lands on the step for what they were reading, and the scroll that puts them there happens only while the panel is transparent", async ({
    page,
  }) => {
    const release = await holdStageModule(page);
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(200);
    const before = await staticGeometry(page);
    expect(before.staticTop).toBeLessThan(0);
    expect(before.staticTop + before.staticHeight).toBeGreaterThan(
      before.viewportHeight,
    );
    release();
    await waitForAnimated(page);
    await waitForFadeOver(page);

    const sw = await page.evaluate(
      () => (window as unknown as { __switch: Switch }).__switch,
    );
    // The panel had faded out when the layout switched.
    expect(sw.panelOpacity).toBeLessThanOrEqual(TRANSPARENT);
    // Frame by frame: the scroll position changed (500 to the new one) only in
    // frames where the panel was transparent. Whatever the reader could see
    // never moved under them. (Static frames at 0 are the ones before the
    // test's own scroll.)
    const frames = await page.evaluate(
      () => (window as unknown as { __frames: FrameRow[] }).__frames,
    );
    const visible = frames.filter(([opacity]) => opacity > TRANSPARENT);
    const finalScroll = await page.evaluate(() => window.scrollY);
    expect(finalScroll).not.toBe(500);
    for (const [, , scrollY, animated] of visible) {
      if (animated) expect(scrollY).toBe(finalScroll);
      else expect([0, 500]).toContain(scrollY);
    }
    // And the switch did fade: some frames were transparent.
    expect(frames.length - visible.length).toBeGreaterThan(0);

    // The step is the one late-start.ts plans for what was in view.
    const after = await animatedGeometry(page);
    const plan = planLateSwitch({
      staticTop: before.staticTop,
      staticHeight: before.staticHeight,
      animatedHeight: after.animatedHeight,
      panelHeight: after.panelHeight,
      viewportHeight: before.viewportHeight,
      anchors: storyAnchors({
        staticHeight: before.staticHeight,
        hand: before.hand,
        notes: before.notes,
        mice: before.mice,
      }),
    });
    expect(plan.fade).toBe(true);
    // data-progress has three decimals; the scroll position is a whole px.
    expect(Math.abs(after.progress - plan.progress)).toBeLessThan(0.003);
  });

  test("③b with the story's end in view, the final section does not move: in no frame, before, during or after the switch", async ({
    page,
  }) => {
    const release = await holdStageModule(page);
    await page.goto("/");
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await page.waitForTimeout(200);
    const before = await staticGeometry(page);
    // The story's bottom edge is in view, so is the final section.
    expect(before.staticTop + before.staticHeight).toBeLessThanOrEqual(
      before.viewportHeight,
    );
    release();
    await waitForAnimated(page);
    await waitForFadeOver(page);

    const after = await animatedGeometry(page);
    expect(after.progress).toBe(1);
    const moved = Math.abs(after.finalTop - before.finalTop);
    expect(moved).toBeLessThanOrEqual(FINAL_TOLERANCE_PX);
    // Every frame recorded from the reader's scroll on.
    const frames = await page.evaluate(
      () => (window as unknown as { __frames: FrameRow[] }).__frames,
    );
    const fromScroll = frames.filter(
      ([, , scrollY, animated]) => animated || scrollY > 0,
    );
    expect(fromScroll.length).toBeGreaterThan(5);
    for (const [, finalTop] of fromScroll) {
      expect(Math.abs(finalTop - before.finalTop)).toBeLessThanOrEqual(
        FINAL_TOLERANCE_PX,
      );
    }
  });

  test("a scroll during the wait starts the wait again: nothing switches under a moving page", async ({
    page,
  }) => {
    const release = await holdStageModule(page);
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, 400));
    release();
    // Keep scrolling, a little every 100 ms, for 1.5 s.
    for (let i = 0; i < 15; i += 1) {
      await page.evaluate((y) => window.scrollTo(0, y), 400 + i * 4);
      await page.waitForTimeout(100);
    }
    expect((await layoutFacts(page)).animated).toBe(false);
    await waitForAnimated(page);
  });
});

test.describe("a failed start is tried again", () => {
  test("④ the module's first request fails; the retry loads it and the stage starts", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let requests = 0;
    await page.route(STAGE_CHUNK, async (route) => {
      requests += 1;
      if (requests === 1) await route.abort();
      else await route.continue();
    });
    await page.goto("/");
    await waitForAnimated(page);
    expect(requests).toBeGreaterThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  test("⑤ when every try fails the page stays static, with no error, and the tries stop", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let requests = 0;
    await page.route(STAGE_CHUNK, async (route) => {
      requests += 1;
      await route.abort();
    });
    await page.goto("/");
    const total = START_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    await page.waitForTimeout(total + 3000);
    const tries = requests;
    // One try and one per retry delay.
    expect(tries).toBe(1 + START_RETRY_DELAYS_MS.length);
    // And no more come.
    await page.waitForTimeout(3000);
    expect(requests).toBe(tries);
    const facts = await layoutFacts(page);
    expect(facts.animated).toBe(false);
    expect(facts.sectionHeight).toBe(facts.panelHeight);
    expect(facts.logoVisibility).toBe("visible");
    expect(errors).toEqual([]);
  });

  // The stage's own preparation (the drawing path, the pairing) fails the
  // first time: a MessageChannel, which it yields with between slices, throws
  // once for a caller in the stage module.
  for (const [label, failures] of [
    ["once: the retry starts the stage", 1],
    ["every time: the page stays static after the last retry, with no error", 99],
  ] as const) {
    test(`prepare() fails ${label}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript((allowed: number) => {
        const w = window as unknown as Record<string, unknown>;
        w.__prepareThrows = 0;
        const Native = window.MessageChannel;
        window.MessageChannel = function (this: unknown) {
          const stack = new Error().stack ?? "";
          if (
            stack.includes("particle-stage") &&
            (w.__prepareThrows as number) < allowed
          ) {
            w.__prepareThrows = (w.__prepareThrows as number) + 1;
            throw new Error("injected: prepare fails");
          }
          return new Native();
        } as unknown as typeof MessageChannel;
      }, failures);
      await page.goto("/");
      if (failures === 1) {
        await waitForAnimated(page);
        expect(
          await page.evaluate(
            () => (window as unknown as Record<string, number>).__prepareThrows,
          ),
        ).toBe(1);
      } else {
        // Wait for the module and every retry.
        await expect
          .poll(
            () =>
              page.evaluate(
                () =>
                  (window as unknown as Record<string, number>).__prepareThrows,
              ),
            { timeout: 60_000 },
          )
          .toBeGreaterThan(0);
        const total = START_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
        await page.waitForTimeout(total + 3000);
        expect(
          await page.evaluate(
            () => (window as unknown as Record<string, number>).__prepareThrows,
          ),
        ).toBe(1 + START_RETRY_DELAYS_MS.length);
        const facts = await layoutFacts(page);
        expect(facts.animated).toBe(false);
        expect(await page.locator(STORY).getAttribute("data-renderer")).toBeNull();
      }
      expect(errors).toEqual([]);
    });
  }
});
