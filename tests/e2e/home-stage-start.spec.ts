import { expect, test, type Page } from "@playwright/test";
import {
  LATE_FADE_ATTEMPTS,
  planLateSwitch,
  storyAnchors,
} from "../../src/lib/particles/late-start";
import { START_RETRY_DELAYS_MS } from "../../src/lib/particles/retry";
import {
  STORY,
  layoutFacts,
  read,
  recordStage,
  waitForAnimated,
} from "./helpers/home-stage";

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
/**
 * The layout shift from the switch on: the same strict bound home-stage.spec.ts
 * holds the switch at the top to. Measured 0. Note that Chromium's layout-shift
 * entries do not see this switch at all: with the fade taken out, and with the
 * scroll compensation taken out as well, ① still measured under this bound
 * (checked by hand, 2026-10-10). What guards the reader's view is the
 * frame-by-frame checks in ③a and ③b, not this number.
 */
const CLS_AFTER_SWITCH_BOUND = 0.001;
/**
 * After the last expected try, how long to watch for one more (ms): twice the
 * longest wait between tries. A retry that the schedule did not stop would
 * come within one longest wait; twice that leaves room for a busy machine.
 */
const NO_MORE_TRIES_MS = 2 * Math.max(...START_RETRY_DELAYS_MS);
/** Every try is expected within this long of the page's load (ms): the sum of the waits, plus a wide margin for the dev server and a busy machine. */
const ALL_TRIES_WITHIN_MS =
  START_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) + 30_000;

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
 * opacity then); `__panelFrames`, one entry per frame: the panel's computed
 * opacity, the final section's top edge, the scroll position, whether the page
 * was animated, and the panel's own (inline) opacity and transition; and
 * `__fadeOuts`, how many times the panel's inline opacity went to 0 (a fade
 * out began).
 */
async function recordSwitch(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__switch = null;
    w.__fadeOuts = 0;
    const frames: [number, number, number, boolean, string, string][] = [];
    w.__panelFrames = frames;
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
    let lastInline = "";
    new MutationObserver(() => {
      const panel = document.querySelector<HTMLElement>(".story-panel");
      const inline = panel?.style.opacity ?? "";
      if (inline === "0" && lastInline !== "0") {
        w.__fadeOuts = (w.__fadeOuts as number) + 1;
      }
      lastInline = inline;
    }).observe(document, {
      attributes: true,
      subtree: true,
      attributeFilter: ["style"],
    });
    const raf = window.requestAnimationFrame.bind(window);
    const sample = () => {
      const panel = document.querySelector<HTMLElement>(".story-panel");
      const final = document.querySelector(".home-final");
      const section = document.querySelector(".story");
      if (panel && final && section) {
        frames.push([
          Number(getComputedStyle(panel).opacity),
          final.getBoundingClientRect().top,
          window.scrollY,
          section.classList.contains("story--animated"),
          panel.style.opacity,
          panel.style.transition,
        ]);
      }
      raf(sample);
    };
    raf(sample);
  });
}

/**
 * Do `action` in the page, once, in the same task as the first fade out's
 * start: "hide" makes the page believe its tab is hidden (as SET_HIDDEN does),
 * "scroll" scrolls 8 px. Written out here, not passed as code to run: the
 * production build's CSP has no 'unsafe-eval', so `new Function` would throw
 * there and the action would never happen.
 */
async function onFirstFadeOut(page: Page, action: "hide" | "scroll") {
  await page.addInitScript((kind: "hide" | "scroll") => {
    let done = false;
    new MutationObserver(() => {
      const panel = document.querySelector<HTMLElement>(".story-panel");
      if (done || panel?.style.opacity !== "0") return;
      done = true;
      if (kind === "hide") {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          get: () => true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      } else {
        window.scrollBy(0, 8);
      }
    }).observe(document, {
      attributes: true,
      subtree: true,
      attributeFilter: ["style"],
    });
  }, action);
}

/** Make the page believe its tab is hidden (or shown again), as home-stage.spec.ts does. */
const SET_HIDDEN = (hidden: boolean) => `
  Object.defineProperty(document, "hidden", { configurable: true, get: () => ${hidden} });
  document.dispatchEvent(new Event("visibilitychange"));
`;

type Switch = { scrollY: number; sectionTop: number; panelOpacity: number };
type FrameRow = [
  opacity: number,
  finalTop: number,
  scrollY: number,
  animated: boolean,
  inlineOpacity: string,
  inlineTransition: string,
];

const frames = (page: Page) => read<FrameRow[]>(page, "__panelFrames");
const theSwitch = (page: Page) => read<Switch | null>(page, "__switch");

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
      mice: block(".story-finale"),
      finalTop: document.querySelector(".home-final")!.getBoundingClientRect()
        .top,
      // The final section's gap under the static story (3rem).
      finalGap:
        document.querySelector(".home-final")!.getBoundingClientRect().top -
        section.bottom,
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
      // The final section's gap under the animated story: negative, it comes
      // up over the finale (since 2026-10-11).
      finalGap:
        document.querySelector(".home-final")!.getBoundingClientRect().top -
        section.getBoundingClientRect().bottom,
    };
  });
}

/** The panel's own style and its computed opacity. */
async function panelState(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".story-panel")!;
    return {
      inlineOpacity: panel.style.opacity,
      transition: panel.style.transition,
      opacity: getComputedStyle(panel).opacity,
    };
  });
}

/** Wait until the late switch's fade in is over (the panel's own style is cleared then). */
async function waitForFadeOver(page: Page) {
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLElement>(".story-panel")!.style.transition,
  );
  await page.waitForTimeout(100);
}

/** After the fade in: the panel is back to full opacity, and none of the switch's styles is left on it. */
async function expectPanelRestored(page: Page) {
  const state = await panelState(page);
  expect(state.inlineOpacity).toBe("");
  expect(state.transition).toBe("");
  expect(state.opacity).toBe("1");
}

test.describe("starting away from the top", () => {
  test.beforeEach(async ({ page }) => {
    await recordSwitch(page);
  });

  test("① a reload at a scrolled position starts the stage there, without going back to the top, and shifts no layout", async ({
    page,
  }) => {
    await recordStage(page);
    await page.goto("/");
    // The first visit compiles the module in dev; the reload is the case.
    await waitForAnimated(page);
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(300);
    await page.reload();
    await waitForAnimated(page);
    const sw = (await theSwitch(page))!;
    // It switched with the reader away from the top, and left them there.
    expect(sw.sectionTop).toBeLessThan(0);
    await waitForFadeOver(page);
    const after = await animatedGeometry(page);
    expect(after.progress).toBeGreaterThan(0);
    expect(after.progress).toBeLessThan(1);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(await read<number>(page, "__clsAfterSwitch")).toBeLessThanOrEqual(
      CLS_AFTER_SWITCH_BOUND,
    );
    await expectPanelRestored(page);
  });

  test("a window taller than the static story stays static away from the top (the buttons would be carried off), and switches once the reader is back at the top", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "chromium", "A desktop window size.");
    const release = await holdStageModule(page);
    await page.goto("/");
    // A window a little taller than the static story (its height depends on
    // the fonts), so the story's end and the buttons under it are in view from
    // the first px of scroll.
    // (The static hero's logo grows with the window's height, so measure
    // again after each resize until the story fits.)
    for (let i = 0; i < 4; i += 1) {
      const fit = await page.evaluate(() => ({
        story: document.querySelector(".story")!.getBoundingClientRect().height,
        viewport: window.innerHeight,
      }));
      if (fit.story <= fit.viewport && fit.story + 40 > fit.viewport) break;
      await page.setViewportSize({
        width: 1280,
        height: Math.ceil(fit.story) + 10,
      });
    }
    expect(
      await page.evaluate(
        () =>
          document.querySelector(".story")!.getBoundingClientRect().height <=
          window.innerHeight,
      ),
      "the static story fits in the window",
    ).toBe(true);
    const top = await page.evaluate(() => {
      const story = document.querySelector<HTMLElement>(".story")!;
      window.scrollTo(
        0,
        story.getBoundingClientRect().top + window.scrollY + 20,
      );
      return story.getBoundingClientRect().top;
    });
    expect(top, "the story's top is above the viewport").toBeLessThan(0);
    const finalBefore = await page.evaluate(
      () => document.querySelector(".home-final")!.getBoundingClientRect().top,
    );
    release();
    // Well past the idle wait and a fade: still the static page, nothing moved.
    await page.waitForTimeout(2500);
    expect((await layoutFacts(page)).animated).toBe(false);
    expect(
      await page.evaluate(
        () =>
          document.querySelector(".home-final")!.getBoundingClientRect().top,
      ),
    ).toBeCloseTo(finalBefore, 0);
    // Back at the top the switch moves nothing: now.
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForAnimated(page);
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
    const sw = (await theSwitch(page))!;
    expect(sw.scrollY).toBe(300);
    expect(sw.sectionTop).toBeLessThan(0);
  });

  test("③a inside the story: the reader lands on the step for what they were reading, the scroll that puts them there happens only while the panel is transparent, and the panel is whole again after", async ({
    page,
  }) => {
    await recordStage(page);
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

    const sw = (await theSwitch(page))!;
    // The panel had faded out when the layout switched.
    expect(sw.panelOpacity).toBeLessThanOrEqual(TRANSPARENT);
    // Frame by frame: the scroll position changed (500 to the new one) only in
    // frames where the panel was transparent. Whatever the reader could see
    // never moved under them. (Static frames at 0 are the ones before the
    // test's own scroll.)
    const rows = await frames(page);
    const visible = rows.filter(([opacity]) => opacity > TRANSPARENT);
    const finalScroll = await page.evaluate(() => window.scrollY);
    expect(finalScroll).not.toBe(500);
    for (const [, , scrollY, animated] of visible) {
      if (animated) expect(scrollY).toBe(finalScroll);
      else expect([0, 500]).toContain(scrollY);
    }
    // And the switch did fade: some frames were transparent.
    expect(rows.length - visible.length).toBeGreaterThan(0);

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
      // As the stage plans it (particle-stage.ts, switchLate): the final
      // section's gap differs between the layouts since the finale.
      finalShift: before.finalGap - after.finalGap,
    });
    expect(plan.fade).toBe(true);
    // data-progress has three decimals; the scroll position is a whole px.
    expect(Math.abs(after.progress - plan.progress)).toBeLessThan(0.003);
    expect(await read<number>(page, "__clsAfterSwitch")).toBeLessThanOrEqual(
      CLS_AFTER_SWITCH_BOUND,
    );
    // The fade in is over: the panel is fully opaque, with nothing of the
    // switch's own left on it.
    await expectPanelRestored(page);
  });

  test("③b with the story's end in view, the final section does not move: in no frame, before, during or after the switch", async ({
    page,
  }) => {
    await recordStage(page);
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
    const fromScroll = (await frames(page)).filter(
      ([, , scrollY, animated]) => animated || scrollY > 0,
    );
    expect(fromScroll.length).toBeGreaterThan(5);
    for (const [, finalTop] of fromScroll) {
      expect(Math.abs(finalTop - before.finalTop)).toBeLessThanOrEqual(
        FINAL_TOLERANCE_PX,
      );
    }
    expect(await read<number>(page, "__clsAfterSwitch")).toBeLessThanOrEqual(
      CLS_AFTER_SWITCH_BOUND,
    );
    await expectPanelRestored(page);
  });

  test("a scroll during the wait starts the wait again: once the stage is ready, nothing switches under a page that keeps moving", async ({
    page,
  }) => {
    const release = await holdStageModule(page);
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, 400));
    release();
    // Ready: the stage has built its first set of particles (data-particles
    // on the canvas), which is the last thing it does before it would switch.
    await expect(page.locator(".story-canvas")).toHaveAttribute(
      "data-particles",
      /^\d+$/,
      { timeout: 60_000 },
    );
    expect(await theSwitch(page)).toBeNull();
    // Keep scrolling, a little every 100 ms (under the 300 ms the switch
    // waits for), for 1.5 s: five times the wait.
    for (let i = 1; i <= 15; i += 1) {
      await page.evaluate((y) => window.scrollTo(0, y), 400 + i * 4);
      await page.waitForTimeout(100);
    }
    expect(await theSwitch(page)).toBeNull();
    expect((await layoutFacts(page)).animated).toBe(false);
    // Not even a fade out began: the panel never dimmed under the moving page.
    expect(await read<number>(page, "__fadeOuts")).toBe(0);
    // Held still, it switches.
    await waitForAnimated(page);
  });

  test("a tab hidden while the panel fades out: nothing switches or scrolls while hidden, the panel comes back, and showing the tab switches", async ({
    page,
  }) => {
    await onFirstFadeOut(page, "hide");
    const release = await holdStageModule(page);
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(200);
    release();
    await expect.poll(() => read<number>(page, "__fadeOuts")).toBe(1);
    // Longer than the fade out, the frames the switch may wait and the fade in.
    await page.waitForTimeout(1500);
    expect(await theSwitch(page)).toBeNull();
    expect((await layoutFacts(page)).animated).toBe(false);
    expect(await page.evaluate(() => window.scrollY)).toBe(500);
    await expectPanelRestored(page);

    await page.evaluate(SET_HIDDEN(false));
    await waitForAnimated(page);
    expect((await theSwitch(page))!.panelOpacity).toBeLessThanOrEqual(
      TRANSPARENT,
    );
  });

  test("a fade out cut short by a scroll, then the reader holds still: the next fade out is a fade, not a cut", async ({
    page,
  }) => {
    // The reader scrolls a little just as the first fade out begins.
    await onFirstFadeOut(page, "scroll");
    const release = await holdStageModule(page);
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(200);
    release();
    await waitForAnimated(page);
    await waitForFadeOver(page);
    expect(await read<number>(page, "__fadeOuts")).toBe(2);

    // The frames of the second fade out: the run of frames with the panel's
    // inline opacity at 0 that ends at the switch. (The first one was cut
    // within a frame, before any frame of it was sampled.)
    const rows = await frames(page);
    const switchAt = rows.findIndex(([, , , animated]) => animated);
    expect(switchAt).toBeGreaterThan(0);
    let secondFrom = switchAt;
    while (secondFrom > 0 && rows[secondFrom - 1]![4] === "0") secondFrom -= 1;
    const second = rows.slice(secondFrom, switchAt);
    expect(second.length).toBeGreaterThan(3);
    for (const [, , , , inline, transition] of second) {
      // The fade out's transition is on the panel for the whole fade: nothing
      // cut it short.
      expect(inline).toBe("0");
      expect(transition).toMatch(/opacity/);
    }
    // The opacity comes down step by step, never in one jump.
    const opacities = second.map(([opacity]) => opacity);
    for (let i = 1; i < opacities.length; i += 1) {
      expect(opacities[i - 1]! - opacities[i]!).toBeLessThan(0.5);
    }
    expect(opacities.at(-1)!).toBeLessThanOrEqual(TRANSPARENT);
  });

  test("when the panel does not become transparent (a long task held the fade back), it never switches in view: the fade is given up a bounded number of times, and the next scroll and stillness switch", async ({
    page,
  }) => {
    const release = await holdStageModule(page);
    await page.goto("/");
    // The panel's opacity can not change: as if every frame of the fade were late.
    await page.addStyleTag({
      content: ".story-panel { opacity: 1 !important; }",
    });
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(200);
    release();
    await expect
      .poll(() => read<number>(page, "__fadeOuts"), { timeout: 60_000 })
      .toBe(LATE_FADE_ATTEMPTS);
    // No more attempts come, and it never switched.
    await page.waitForTimeout(2500);
    expect(await read<number>(page, "__fadeOuts")).toBe(LATE_FADE_ATTEMPTS);
    expect(await theSwitch(page)).toBeNull();
    expect(await page.evaluate(() => window.scrollY)).toBe(500);
    await expectPanelRestored(page);

    // The attempts stay used up until the reader scrolls: a resize, the tab
    // hidden and shown again, and reduced motion turned on and off each ask
    // the stage to look again, and none of them starts a fourth fade out.
    // (Longer than the idle wait plus a fade out and its frames: 1.5 s.)
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.width, height: size.height - 20 });
    await page.waitForTimeout(1500);
    expect(await read<number>(page, "__fadeOuts")).toBe(LATE_FADE_ATTEMPTS);
    await page.evaluate(SET_HIDDEN(true));
    await page.waitForTimeout(100);
    await page.evaluate(SET_HIDDEN(false));
    await page.waitForTimeout(1500);
    expect(await read<number>(page, "__fadeOuts")).toBe(LATE_FADE_ATTEMPTS);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(200);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(1500);
    expect(await read<number>(page, "__fadeOuts")).toBe(LATE_FADE_ATTEMPTS);
    expect(await theSwitch(page)).toBeNull();

    // The fade can run again: a scroll, then stillness, switches.
    await page.evaluate(() =>
      document.querySelectorAll("style").forEach((style) => {
        if (style.textContent?.includes("opacity: 1 !important")) {
          style.remove();
        }
      }),
    );
    // A scroll the page makes on its own (no input from the reader) does not
    // count as the reader's: still no fourth fade out.
    await page.evaluate(() => window.scrollBy(0, 4));
    await page.waitForTimeout(1500);
    expect(await read<number>(page, "__fadeOuts")).toBe(LATE_FADE_ATTEMPTS);
    // The reader scrolls (a key), then holds still: it switches.
    await page.keyboard.press("ArrowDown");
    await waitForAnimated(page);
    expect((await theSwitch(page))!.panelOpacity).toBeLessThanOrEqual(
      TRANSPARENT,
    );
  });

  test("printing while the panel fades: the panel prints at full opacity", async ({
    page,
  }) => {
    const release = await holdStageModule(page);
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(200);
    release();
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLElement>(".story-panel")!.style.opacity ===
        "0",
      null,
      { timeout: 60_000, polling: "raf" },
    );
    await page.emulateMedia({ media: "print" });
    const state = await panelState(page);
    // Still in the switch's fade (out, or back in) when it was read.
    expect(state.inlineOpacity === "0" || state.transition !== "").toBe(true);
    expect(state.opacity).toBe("1");
    expect(
      await page.evaluate(
        () =>
          getComputedStyle(document.querySelector(".story-panel")!)
            .transitionDuration,
      ),
    ).toBe("0s");
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

  test("⑤ when every try fails the page stays static, with no error, and the tries stop; turning motion off and on again does not start new ones", async ({
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
    // One try and one per retry delay.
    const tries = 1 + START_RETRY_DELAYS_MS.length;
    await expect
      .poll(() => requests, { timeout: ALL_TRIES_WITHIN_MS })
      .toBe(tries);
    // And no more come.
    await page.waitForTimeout(NO_MORE_TRIES_MS);
    expect(requests).toBe(tries);
    const facts = await layoutFacts(page);
    expect(facts.animated).toBe(false);
    expect(facts.sectionHeight).toBe(facts.panelHeight);
    expect(facts.logoVisibility).toBe("visible");

    // Turning reduced motion on and off again asks the page to load the stage
    // once more: the tries are used up, so it does not.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(200);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.waitForTimeout(NO_MORE_TRIES_MS);
    expect(requests).toBe(tries);
    expect(errors).toEqual([]);
  });

  // The stage's own preparation (the drawing path, the pairing) fails: a
  // MessageChannel, which it yields with between slices, throws for a caller
  // in the stage module.
  for (const [label, failures] of [
    ["once: the retry starts the stage", 1],
    [
      "every time: the page stays static after the last retry, with no error",
      99,
    ],
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
      const thrown = () => read<number>(page, "__prepareThrows");
      if (failures === 1) {
        await waitForAnimated(page);
        expect(await thrown()).toBe(1);
      } else {
        const tries = 1 + START_RETRY_DELAYS_MS.length;
        await expect
          .poll(thrown, { timeout: 60_000 + ALL_TRIES_WITHIN_MS })
          .toBe(tries);
        await page.waitForTimeout(NO_MORE_TRIES_MS);
        expect(await thrown()).toBe(tries);
        const facts = await layoutFacts(page);
        expect(facts.animated).toBe(false);
        expect(
          await page.locator(STORY).getAttribute("data-renderer"),
        ).toBeNull();
      }
      expect(errors).toEqual([]);
    });
  }
});
