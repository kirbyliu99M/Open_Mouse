import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { PARTICLE_SEED } from "../../src/lib/particles/budget";
import { DEGRADE } from "../../src/lib/particles/degrade";
import { parseTargets } from "../../src/lib/particles/load-targets";
import {
  LIT_FRACTION,
  legFractions,
  litCount,
  litness,
  rankOf,
} from "../../src/lib/particles/look";
import { buildPairing } from "../../src/lib/particles/pairing";
import {
  type StageLayout,
  buildParticleSet,
  createFrame,
  handBox,
  legOf,
  logoBox,
  mouseBox,
  writeParticles,
} from "../../src/lib/particles/particle-set";
import { STAR_ORDER_SEED, starOrder } from "../../src/lib/particles/star-order";
import { phaseAt } from "../../src/lib/particles/timeline";
import {
  CANVAS,
  STORY,
  layoutFacts,
  logoInk,
  logoOffMark,
  read,
  recordStage,
  scrollToProgress,
  waitForAnimated,
} from "./helpers/home-stage";

/**
 * Home v3, the WebGL stage (docs/design/home-v3-2026-10-03/README.md,
 * "Rendering and performance"). The particles are drawn on a WebGL canvas, the
 * overlay on the 2D canvas above it; without WebGL the 2D canvas draws both.
 * Playwright's headless Chromium has software WebGL (SwiftShader), so the
 * first group runs the WebGL path, and says so when it does not (a machine with
 * no WebGL at all lands in the second group's world; those tests then check
 * the fallback instead of skipping). The second group runs the fallback on
 * purpose.
 */

const targets = parseTargets(
  JSON.parse(readFileSync("src/lib/particles/targets.generated.json", "utf8")),
);

test.beforeEach(async ({ page }, info) => {
  if (info.project.name === "chromium") {
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  await recordStage(page);
});

/** The shimmer is the one thing that moves on its own: after it, a frame is the stage at rest. */
async function waitForShimmerOver(page: Page) {
  const activatedAt = await read<number>(page, "__activatedAt");
  await page.waitForFunction(
    (start) => performance.now() - start > 3400,
    activatedAt,
  );
}

const rendererOf = (page: Page) =>
  page.locator(STORY).getAttribute("data-renderer");

/**
 * E2E_NO_WEBGL=1 says this machine really has no WebGL: the tests that need it
 * are skipped, and the fallback group (which blocks WebGL itself) is what
 * covers the page. Without it, a page that is not on WebGL is a failure, and
 * the canary test below says so.
 */
const NO_WEBGL = process.env.E2E_NO_WEBGL === "1";

/** Skip a WebGL-only test when the page is not on WebGL. The reason points at the canary, which fails in that case. */
async function requireWebGL(page: Page) {
  test.skip(
    (await rendererOf(page)) !== "webgl",
    NO_WEBGL
      ? "E2E_NO_WEBGL=1: this machine has no WebGL, so the WebGL tests are skipped and the fallback group covers it."
      : 'data-renderer is not "webgl" in this environment: the canary test "WebGL is on in this environment" fails for the same reason. Fix WebGL here (or set E2E_NO_WEBGL=1 on a machine that really has none).',
  );
}

/**
 * The page's frame clock, made to miss frames on purpose, from before its own
 * scripts run. While a plan is set, the timestamp every requestAnimationFrame
 * callback is handed is made up: the made-up clock moves once for each real
 * frame (a loop of the test's own steps it, so frames in which the page has no
 * callback count too), by `normal` ms when the frame is on time and by `slow`
 * ms when the plan says it is missed. The guard only reads those timestamps;
 * what the screen really does is not touched. `__frame` counts the frames since
 * the plan was set. (The test's own loop is a frame callback of its own, so
 * `__raf` is not meaningful in a page that uses this clock.)
 */
async function installFrameClock(page: Page, fromStart?: { gap: number }) {
  await page.addInitScript((start) => {
    const w = window as unknown as Record<string, unknown>;
    w.__plan = start ? () => start.gap : null;
    w.__fake = 0;
    w.__lastReal = -1;
    w.__frame = 0;
    const raf = window.requestAnimationFrame.bind(window);
    const step = (time: number) => {
      const plan = w.__plan as ((frame: number) => number) | null;
      if (plan && time !== w.__lastReal) {
        w.__lastReal = time;
        w.__fake = (w.__fake as number) + plan(w.__frame as number);
        w.__frame = (w.__frame as number) + 1;
      }
      raf(step);
    };
    raf(step);
    window.requestAnimationFrame = (callback) =>
      raf((time) => {
        const plan = w.__plan as ((frame: number) => number) | null;
        if (!plan) return callback(time);
        // The loop above has stepped the clock for this frame (it was asked
        // for first, so it runs first).
        return callback(w.__fake as number);
      });
  }, fromStart ?? null);
}

/** Which frames of the plan are missed. */
type Misses = "all" | "none" | { every: number } | { twoInFive: true };

const missFrames = (
  page: Page,
  { normal, slow, misses }: { normal: number; slow: number; misses: Misses },
) =>
  page.evaluate(
    ([n, sl, m]) => {
      const w = window as unknown as Record<string, unknown>;
      const missed = (i: number) =>
        m === "all"
          ? true
          : m === "none"
            ? false
            : typeof m === "object" && "every" in m
              ? i % m.every === 0
              : i % 5 < 2;
      w.__fake = performance.now();
      w.__lastReal = -1;
      w.__frame = 0;
      w.__plan = (i: number) => (missed(i) ? (sl as number) : (n as number));
    },
    [normal, slow, misses] as const,
  );

const restoreClock = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__plan = null;
  });

/** Scroll by 4 px on each of `frames` frames: the stage draws on every one. */
const scrollFrames = (page: Page, frames: number, dy = 4) =>
  page.evaluate(
    ([n, step]) =>
      new Promise<void>((resolve) => {
        let count = 0;
        const tick = () => {
          window.scrollBy(0, step!);
          count += 1;
          if (count < n!) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      }),
    [frames, dy],
  );

/**
 * What a lit star adds to the WebGL canvas, measured on this machine's
 * software WebGL at 1280x800 and on a Pixel 7 (see the test that uses them).
 * At the mice every star is a blob of its own except for a few that touch:
 * 0.88 blobs per lit particle on a desktop and 1.00 on a phone. At the logo
 * the stars sit closer, on a shorter line, and blur into one outline: there
 * the canvas's total alpha (in px squared of the canvas, divided by the
 * pixel ratio squared) per lit particle is 7.31 on a desktop (1,200 lit
 * particles) and 7.42 on a phone (600), measured on the Palmate mark's cloud
 * on 2026-10-10 with a lit share of 0.10 and logo stars 1.7 times the look
 * (the first Palmate cut, 0.06 and 1.35, measured 5.64 and 5.62; the
 * placeholder mouse outline had 5.6 and 5.8; the figure rises with the share
 * and the star size because the stars overlap more). A bound is
 * about 10 % either side of what was measured: a share of stars a quarter or
 * more off (0.08 or 0.25 for the mice) is outside it, which the mutation
 * checks of this suite showed. For the logo the bound catches the shader
 * lighting another number of particles than the TypeScript maths says (the
 * mass is the shader's, the count is the maths'): a shader that lights half
 * of what the maths says gives about half the figure.
 */
const STAR_BLOBS = { low: 0.8, high: 1.05 };
/**
 * The solid area (alpha 80 % or more) of the three mice at p = 0.95 as a
 * multiple of the Canvas 2D version's. Measured: 1.8 on a desktop (1,800
 * stars against 1,300 particles) and 0.8 on a phone (900 against 900, drawn
 * at a pixel ratio of 1.5); the continuous line the stage drew before the
 * stars was over 20. The bounds are the 0.5 to 3 the brief asked for.
 */
const MICE_SOLID = { low: 0.5, high: 3 };
const LOGO_MASS = { low: 6.7, high: 8.1 };

/**
 * What the TypeScript maths says the WebGL stage draws, built for the layout
 * the page has now: the particle set, the order and ranks (so which particles
 * are lit in each state), and `expected(p)`, the positions at progress p.
 */
async function stageModel(page: Page) {
  // Where the page put the logo, the hand and the three mice (at p = 0, where
  // the hero has not moved): the layout the stage built its particles for.
  const page_ = await page.evaluate(() => {
    const panel = document.querySelector(".story-panel") as HTMLElement;
    const origin = panel.getBoundingClientRect();
    const rel = (el: Element) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left - origin.left,
        y: r.top - origin.top,
        width: r.width,
        height: r.height,
      };
    };
    const canvas = document.querySelector(".story-canvas") as HTMLElement;
    return {
      width: panel.clientWidth,
      height: panel.offsetHeight,
      wide: matchMedia("(min-width: 48rem)").matches,
      logo: rel(document.querySelector(".story-logo img")!),
      hand: rel(document.querySelector(".story-hand img")!),
      mice: [...document.querySelectorAll(".story-mouse")].map((figure) => ({
        rect: rel(figure.querySelector("img")!),
        sketch: (figure as HTMLElement).dataset.sketch ?? "",
      })),
      count: Number(canvas.dataset.particles),
      drawn: Number(canvas.dataset.drawn),
    };
  });
  const fallback = Object.keys(targets.mice)[0]!;
  const sketches = page_.mice.map((m) =>
    m.sketch in targets.mice ? m.sketch : fallback,
  );
  const pairing = buildPairing(targets, {
    count: page_.count,
    layout: page_.wide ? "row" : "stacked",
    seed: PARTICLE_SEED,
    mice: sketches,
    density: "dense",
  });
  const layout: StageLayout = {
    width: page_.width,
    height: page_.height,
    logo: logoBox(page_.logo),
    hand: handBox(page_.hand, targets.hand.viewBox),
    mice: page_.mice.map((m, slot) =>
      mouseBox(m.rect, targets.mice[sketches[slot]!]!.width),
    ),
  };
  const set = buildParticleSet(pairing, layout, PARTICLE_SEED);
  const frame = createFrame(page_.count);
  // The first `drawn` of the order are the particles on screen (all of them, unless the guard has stepped in).
  const order = starOrder(pairing, STAR_ORDER_SEED);
  const onScreen = Array.from(order.slice(0, page_.drawn));
  const rankOfParticle = new Float64Array(page_.count);
  order.forEach((particle, place) => {
    rankOfParticle[particle] = rankOf(place, page_.count);
  });

  /**
   * Where the TypeScript maths puts the particles at p, in CSS px (x, y, x,
   * y, ...), in two lists: the ones that are all the way lit (`solid`: a
   * star, or dust that has not begun to fade) and the ones that show at all
   * (`possible`: lit at the start or at the end of the leg, so at least a
   * little). At the start and at the end of a leg the two are the same list:
   * the particles whose rank is under the state's lit share.
   */
  const expected = (p: number) => {
    const phase = phaseAt(p);
    writeParticles(set, phase, frame);
    const leg = legOf(phase);
    const [from, to] = legFractions(leg.split);
    const solid: number[] = [];
    const possible: number[] = [];
    for (const i of onScreen) {
      const shown = litness(rankOfParticle[i]!, from, to, leg.weights.e);
      if (shown <= 0) continue;
      const x = frame.xy[2 * i]!;
      const y = frame.xy[2 * i + 1]!;
      // The swirl takes some particles past the edge of the canvas (a phone's is
      // narrow): they are not seen, so they are not compared.
      if (x >= 0 && x < page_.width && y >= 0 && y < page_.height) {
        possible.push(x, y);
        if (shown >= 0.9) solid.push(x, y);
      }
    }
    return { solid, possible };
  };
  return { page_, set, frame, order, onScreen, rankOfParticle, expected };
}

/** A second page of the same browser window on the Canvas 2D fallback (no WebGL context to be had), at the same size, past its shimmer. */
async function twoDPage(page: Page, context: BrowserContext, contrast = false) {
  const old = await context.newPage();
  await recordStage(old);
  await old.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      if (/webgl/i.test(type)) return null;
      return (getContext as (...args: unknown[]) => unknown).call(
        this,
        type,
        ...rest,
      );
    } as typeof getContext;
  });
  if (contrast) await old.emulateMedia({ contrast: "more" });
  await old.setViewportSize(page.viewportSize()!);
  await old.goto("/");
  await waitForAnimated(old);
  await expect(old.locator(STORY)).toHaveAttribute("data-renderer", "2d");
  await waitForShimmerOver(old);
  return old;
}

/** Solid pixels (alpha 80 % or more) per CSS px squared of the canvas that draws the particles, and the brightest alpha. */
const solidArea = (target: Page, webgl: boolean) =>
  target.evaluate((useSnapshot) => {
    const canvas = useSnapshot
      ? ((window as unknown as Record<string, unknown>)
          .__glSnapshot as HTMLCanvasElement)
      : document.querySelector<HTMLCanvasElement>(".story-canvas")!;
    const css = document
      .querySelector(".story-canvas")!
      .getBoundingClientRect();
    const scale = canvas.width / css.width;
    const { data } = canvas
      .getContext("2d")!
      .getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    let brightest = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i]! >= 204) count += 1;
      brightest = Math.max(brightest, data[i]!);
    }
    return { area: count / (scale * scale), brightest };
  }, webgl);

test.describe("the WebGL path", () => {
  test("WebGL is on in this environment: data-renderer is webgl (the WebGL tests below skip when it is not; this one does not, so a WebGL that is quietly broken turns the run red)", async ({
    page,
  }) => {
    test.skip(
      NO_WEBGL,
      "E2E_NO_WEBGL=1: this machine has no WebGL, declared on purpose. The fallback group covers it.",
    );
    await page.goto("/");
    await waitForAnimated(page);
    expect(
      await rendererOf(page),
      "The stage is not on WebGL. Either WebGL is broken in this environment (the stage fell back to Canvas 2D: no context, a shader that does not compile, a point-size limit, a lost context), or this machine really has no WebGL, and E2E_NO_WEBGL=1 says so.",
    ).toBe("webgl");
    // It is drawing on the WebGL canvas, and that canvas is shown.
    const facts = await layoutFacts(page);
    expect(facts.glCanvasDisplay).toBe("block");
    expect(
      (await read<number[]>(page, "__glDraws")).length,
      "no draw call on the WebGL canvas",
    ).toBeGreaterThan(0);
  });

  test("makes its context as asked (no antialiasing, no depth buffer, premultiplied alpha, the high-performance GPU), and gives the 2D canvas only a 2D context", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      const calls: { cls: string; type: string; options: unknown }[] = [];
      w.__contextCalls = calls;
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        options?: unknown,
      ) {
        if (this.className.startsWith("story-canvas")) {
          calls.push({ cls: this.className, type, options });
        }
        return (getContext as (...args: unknown[]) => unknown).call(
          this,
          type,
          options,
        );
      } as typeof getContext;
    });
    await page.goto("/");
    await waitForAnimated(page);
    const calls = await read<
      { cls: string; type: string; options: Record<string, unknown> }[]
    >(page, "__contextCalls");
    // One canvas can not have both: the 2D layer only ever asks for "2d", the WebGL layer only for "webgl".
    expect(
      calls.filter((c) => c.cls === "story-canvas").map((c) => c.type),
    ).toEqual(expect.arrayContaining(["2d"]));
    expect(
      calls
        .filter((c) => c.cls === "story-canvas")
        .every((c) => c.type === "2d"),
    ).toBe(true);
    const gl = calls.filter((c) => c.cls === "story-canvas-gl");
    expect(gl.every((c) => c.type === "webgl")).toBe(true);
    if ((await rendererOf(page)) === "webgl") {
      expect(gl[0]!.options).toMatchObject({
        antialias: false,
        depth: false,
        premultipliedAlpha: true,
        powerPreference: "high-performance",
      });
    }
  });

  test("destroying the stage while it is still preparing leaves no WebGL context and no listener behind (the page navigates away in the middle of the first slices)", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      const contexts: WebGLRenderingContext[] = [];
      w.__contexts = contexts;
      w.__slices = 0;
      let added = 0;
      let removed = 0;
      w.__listeners = () => ({ added, removed });
      // Make the stage's own slices slow (800 ms each), and only those: its
      // `pause()` is a MessageChannel made from the stage's code. (React's
      // scheduler uses MessageChannel too, and must not be slowed.)
      const Native = window.MessageChannel;
      window.MessageChannel = class extends Native {
        constructor() {
          super();
          if (new Error().stack?.includes("particle-stage")) {
            w.__slices = (w.__slices as number) + 1;
            const port = this.port2;
            const post = port.postMessage.bind(port) as (
              ...args: unknown[]
            ) => void;
            port.postMessage = (...args: unknown[]) => {
              setTimeout(() => post(...args), 800);
            };
          }
        }
      };
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        const made = (getContext as (...args: unknown[]) => unknown).call(
          this,
          type,
          ...rest,
        );
        if (/webgl/i.test(type) && this.className === "story-canvas-gl") {
          contexts.push(made as WebGLRenderingContext);
        }
        return made;
      } as typeof getContext;
      const add = EventTarget.prototype.addEventListener;
      const remove = EventTarget.prototype.removeEventListener;
      const ours = (target: EventTarget, type: string) =>
        type === "webglcontextlost" &&
        (target as HTMLElement).className === "story-canvas-gl";
      EventTarget.prototype.addEventListener = function (
        this: EventTarget,
        type: string,
        ...rest: unknown[]
      ) {
        if (ours(this, type)) added += 1;
        return (add as (...args: unknown[]) => void).call(this, type, ...rest);
      } as typeof add;
      EventTarget.prototype.removeEventListener = function (
        this: EventTarget,
        type: string,
        ...rest: unknown[]
      ) {
        if (ours(this, type)) removed += 1;
        return (remove as (...args: unknown[]) => void).call(
          this,
          type,
          ...rest,
        );
      } as typeof remove;
    });
    // The page it navigates to is compiled already, so the navigation is quick
    // (the dev server compiles a route on its first request).
    await page.request.get("/sheet");
    await page.goto("/");
    // The stage has made its WebGL context and is waiting for the next slice of
    // the renderer's setup (the shaders): the context exists, and what is
    // suspended is `createGlRendererSteps`, which the stage closes when it is
    // destroyed. (Navigating away at the first slice would not reach it.)
    await page.waitForFunction(
      () =>
        ((window as unknown as Record<string, unknown>).__contexts as unknown[])
          .length > 0,
    );
    // Navigate away from the page, client side: the component unmounts and destroys the stage.
    await page.evaluate(() =>
      (
        window as unknown as { next: { router: { push(url: string): void } } }
      ).next.router.push("/sheet"),
    );
    await expect(page).toHaveURL(/\/sheet/);
    // Long enough for every slice it was waiting for to have come.
    await page.waitForTimeout(2500);
    const left = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const contexts = w.__contexts as WebGLRenderingContext[];
      return {
        made: contexts.length,
        alive: contexts.filter((gl) => !gl.isContextLost()).length,
        listeners: (
          w.__listeners as () => { added: number; removed: number }
        )(),
      };
    });
    // The context was made, so the path that closes the setup half way was
    // taken; nothing is left: it is lost, and every listener the stage added is
    // removed.
    expect(left.made, JSON.stringify(left)).toBeGreaterThan(0);
    expect(left.alive, JSON.stringify(left)).toBe(0);
    expect(left.listeners.added, JSON.stringify(left)).toBe(
      left.listeners.removed,
    );
  });

  test("the first frame is on the WebGL canvas and the layout switches after it", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    await requireWebGL(page);
    // The first draw call came before `story--animated` was added.
    expect(await read<number>(page, "__glDrawsAtSwitch")).toBeGreaterThan(0);
    // One draw call a frame, and it is a POINTS draw of the whole budget at rest.
    await waitForShimmerOver(page);
    const logo = await logoInk(page);
    expect(logo.empty).toBe(false);
  });

  test("scrolling uploads nothing: the particles go to the GPU once per layout, and a resize sends them again", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    await requireWebGL(page);
    await waitForShimmerOver(page);
    const uploads = () => read<number>(page, "__bufferUploads");
    const before = await uploads();
    // At least the layout's own upload (the first frame's and the measured one).
    expect(before).toBeGreaterThanOrEqual(1);
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9, 1, 0.6, 0.2, 0]) {
      await scrollToProgress(page, p);
    }
    expect(await uploads()).toBe(before);
    // A new layout is a new upload, so the count above is not a counter that never moves.
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.width, height: size.height + 60 });
    await page.waitForTimeout(500);
    expect(await uploads()).toBeGreaterThan(before);
  });

  test("the shader draws what the TypeScript formula says: the outline and the centre of the particles agree at p = 0, 0.25, 0.5, 0.75 and 1", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    await requireWebGL(page);
    await waitForShimmerOver(page);
    await scrollToProgress(page, 0);

    const { page_, expected } = await stageModel(page);

    /**
     * What the WebGL canvas shows, read from its pixels (the copy `recordStage`
     * keeps), set against `solid` (the particles that are all the way lit) and
     * `possible` (the ones that show at all). Brightness is left out on
     * purpose: a bright particle, a dim one and a stack of ten on a stroke all
     * weigh differently in light, so a centre of light is not a centre of
     * particles. What does not depend on it is where the picture is lit at all:
     * - the box round everything lit (alpha 10 % or more: a lone dim particle
     *   at the edge of the cloud is faint, and still has to be where it should)
     *   holds the box round the solid particles and lies inside the possible
     *   ones';
     * - the lit area in 4 px cells: how well it covers the cells the solid
     *   particles are in, the other way round for the possible ones, and (when
     *   nearly every particle is lit, as in the hand: stars are a few dots of
     *   different weights, whose centre of light is not the centre of the dots)
     *   its centre.
     */
    const compare = (lists: { solid: number[]; possible: number[] }) =>
      page.evaluate(({ solid, possible }) => {
        const CELL = 4;
        const snapshot = (window as unknown as Record<string, unknown>)
          .__glSnapshot as HTMLCanvasElement;
        const css = document
          .querySelector(".story-canvas-gl")!
          .getBoundingClientRect();
        const scale = snapshot.width / css.width;
        const { data, width, height } = snapshot
          .getContext("2d")!
          .getImageData(0, 0, snapshot.width, snapshot.height);
        const key = (cx: number, cy: number) => cy * 100000 + cx;
        const lit = new Set<number>();
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const alpha = data[(y * width + x) * 4 + 3]!;
            if (alpha >= 26) {
              lit.add(
                key(Math.floor(x / scale / CELL), Math.floor(y / scale / CELL)),
              );
            }
            if (alpha >= 26) {
              x0 = Math.min(x0, x);
              x1 = Math.max(x1, x);
              y0 = Math.min(y0, y);
              y1 = Math.max(y1, y);
            }
          }
        }
        const cellsOf = (positions: number[]) => {
          const cells = new Set<number>();
          for (let i = 0; i < positions.length; i += 2) {
            cells.add(
              key(
                Math.floor(positions[i]! / CELL),
                Math.floor(positions[i + 1]! / CELL),
              ),
            );
          }
          return cells;
        };
        const made = cellsOf(solid);
        const could = cellsOf(possible);
        const cellOf = (k: number) =>
          [k % 100000, Math.floor(k / 100000)] as const;
        const centre = (cells: Set<number>) => {
          let sx = 0;
          let sy = 0;
          for (const k of cells) {
            const [cx, cy] = cellOf(k);
            sx += (cx + 0.5) * CELL;
            sy += (cy + 0.5) * CELL;
          }
          return [sx / cells.size, sy / cells.size] as const;
        };
        const near = (cells: Set<number>, k: number) => {
          const [cx, cy] = cellOf(k);
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (cells.has(key(cx + dx, cy + dy))) return true;
            }
          }
          return false;
        };
        let madeAreLit = 0;
        for (const k of made) if (lit.has(k)) madeAreLit += 1;
        let litAreMade = 0;
        for (const k of lit) if (near(could, k)) litAreMade += 1;
        const [litX, litY] = centre(lit);
        const [madeX, madeY] = centre(made);
        return {
          litCells: lit.size,
          madeCells: made.size,
          box: {
            x0: x0 / scale,
            y0: y0 / scale,
            x1: (x1 + 1) / scale,
            y1: (y1 + 1) / scale,
          },
          madeAreLit: madeAreLit / made.size,
          litAreMade: litAreMade / lit.size,
          centreOff: [litX - madeX, litY - madeY] as const,
        };
      }, lists);

    // A few CSS px: a particle is a soft dot a few px wide, so the lit area
    // reaches a little past the particles' own box. A wrong formula (a missing
    // swirl, the wrong leg, the wrong end) is out by tens of px mid-leg, and
    // fails every line below.
    const BOX = 4;
    const CENTRE = 3;
    const boxOf = (xy: number[]) => {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < xy.length; i += 2) {
        x0 = Math.min(x0, xy[i]!);
        x1 = Math.max(x1, xy[i]!);
        y0 = Math.min(y0, xy[i + 1]!);
        y1 = Math.max(y1, xy[i + 1]!);
      }
      return { x0, y0, x1, y1 };
    };
    const seen: string[] = [];
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      await scrollToProgress(page, p);
      await page.waitForTimeout(150);
      const lists = expected(p);
      const got = await compare(lists);
      const inner = boxOf(lists.solid);
      const outer = boxOf(lists.possible);
      // Mid-leg, the lit box holds the box of the particles that are all the
      // way lit and lies inside the box of those that show at all (a particle
      // that has almost faded is too faint to count); at the start and at the
      // end of a leg the two boxes are one, and so it is the same box.
      const off = {
        in0: +(got.box.x0 - inner.x0).toFixed(2),
        in1: +(got.box.y0 - inner.y0).toFixed(2),
        in2: +(got.box.x1 - inner.x1).toFixed(2),
        in3: +(got.box.y1 - inner.y1).toFixed(2),
        out0: +(got.box.x0 - outer.x0).toFixed(2),
        out1: +(got.box.y0 - outer.y0).toFixed(2),
        out2: +(got.box.x1 - outer.x1).toFixed(2),
        out3: +(got.box.y1 - outer.y1).toFixed(2),
        cx: +got.centreOff[0].toFixed(2),
        cy: +got.centreOff[1].toFixed(2),
        madeAreLit: +got.madeAreLit.toFixed(3),
        litAreMade: +got.litAreMade.toFixed(3),
      };
      // Nearly every particle is lit and fully so: the hand's dust.
      const dust =
        lists.solid.length === lists.possible.length &&
        lists.solid.length / 2 >= page_.drawn * 0.95;
      const note = `p=${p} solid ${lists.solid.length / 2} of ${lists.possible.length / 2} ${JSON.stringify(off)}`;
      seen.push(note);
      expect(got.litCells, `p=${p}: something is drawn`).toBeGreaterThan(100);
      expect(lists.solid.length, `p=${p}: ${note}`).toBeGreaterThan(200);
      // The lit box starts no later than the solid box (plus a little) and
      // ends no earlier...
      expect(off.in0, note).toBeLessThan(BOX);
      expect(off.in1, note).toBeLessThan(BOX);
      expect(off.in2, note).toBeGreaterThan(-BOX);
      expect(off.in3, note).toBeGreaterThan(-BOX);
      // ...and starts no earlier than the outer box (less a little), and ends no later.
      expect(off.out0, note).toBeGreaterThan(-BOX);
      expect(off.out1, note).toBeGreaterThan(-BOX);
      expect(off.out2, note).toBeLessThan(BOX);
      expect(off.out3, note).toBeLessThan(BOX);
      if (dust) {
        for (const key of ["cx", "cy"] as const) {
          expect(Math.abs(off[key]), `${key}: ${note}`).toBeLessThan(CENTRE);
        }
      }
      // Nearly every cell the maths puts a solid particle in is lit, and
      // nearly everything lit is next to a particle that shows.
      expect(off.madeAreLit, note).toBeGreaterThan(0.97);
      expect(off.litAreMade, note).toBeGreaterThan(0.98);
    }
    test.info().annotations.push({
      type: "differences (CSS px)",
      description: seen.join("; "),
    });
  });

  /** In the page: how many separate bright blobs the WebGL canvas holds (pixels of alpha 50 % or more that touch, 8 ways), and the sum of all its alpha (in whole pixels). */
  const blobs = (page: Page) =>
    page.evaluate(() => {
      const snapshot = (window as unknown as Record<string, unknown>)
        .__glSnapshot as HTMLCanvasElement;
      const { data, width, height } = snapshot
        .getContext("2d")!
        .getImageData(0, 0, snapshot.width, snapshot.height);
      const seen = new Uint8Array(width * height);
      let count = 0;
      let mass = 0;
      for (let i = 0; i < width * height; i += 1) {
        mass += data[i * 4 + 3]! / 255;
      }
      for (let start = 0; start < width * height; start += 1) {
        if (seen[start] || data[start * 4 + 3]! < 128) continue;
        count += 1;
        const stack = [start];
        seen[start] = 1;
        while (stack.length) {
          const at = stack.pop()!;
          const x = at % width;
          const y = (at - x) / width;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
              const next = ny * width + nx;
              if (seen[next] || data[next * 4 + 3]! < 128) continue;
              seen[next] = 1;
              stack.push(next);
            }
          }
        }
      }
      return {
        count,
        mass,
        scale:
          width /
          document.querySelector(".story-canvas-gl")!.getBoundingClientRect()
            .width,
      };
    });

  test("the stars are the particles the formula lights: at the logo and at the mice the number of bright blobs on the canvas follows the number of particles whose rank is under the state's share, so a wrong share (a different count of stars) fails", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    await requireWebGL(page);
    await waitForShimmerOver(page);
    const model = await stageModel(page);
    const seen: string[] = [];
    // The mice at rest: each star is a blob of its own (their spacing is wider than a star's core). The logo's stars sit closer on a shorter line, so only the mice are counted blob by blob.
    for (const p of [0, 0.95, 1]) {
      await scrollToProgress(page, p);
      await page.waitForTimeout(150);
      const lit = model.expected(p).solid.length / 2;
      const got = await blobs(page);
      const ratio = got.count / lit;
      seen.push(
        `p=${p}: ${got.count} blobs, mass ${got.mass.toFixed(0)}, for ${lit} lit particles, ratio ${ratio.toFixed(3)}, mass per particle ${(got.mass / lit).toFixed(3)}`,
      );
      if (p === 0) {
        const perParticle = got.mass / (got.scale * got.scale) / lit;
        expect(perParticle, seen.at(-1)).toBeGreaterThan(LOGO_MASS.low);
        expect(perParticle, seen.at(-1)).toBeLessThan(LOGO_MASS.high);
        continue;
      }
      expect(lit, seen.at(-1)).toBeGreaterThan(400);
      expect(ratio, seen.at(-1)).toBeGreaterThan(STAR_BLOBS.low);
      expect(ratio, seen.at(-1)).toBeLessThan(STAR_BLOBS.high);
    }
    test.info().annotations.push({
      type: "star blobs per lit particle",
      description: seen.join("; "),
    });
  });

  test("the mice are stars, not a line: at p = 0.95 the solid area (alpha 80 % or more) is within the bounds measured against the Canvas 2D version's, never the 20 times and more of a continuous line", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    await requireWebGL(page);
    await waitForShimmerOver(page);
    const old = await twoDPage(page, context);
    const seen: string[] = [];
    for (const p of [0.95]) {
      await scrollToProgress(page, p);
      await scrollToProgress(old, p);
      await page.waitForTimeout(150);
      const gl = await solidArea(page, true);
      const flat = await solidArea(old, false);
      const ratio = gl.area / flat.area;
      seen.push(
        `p=${p} webgl ${JSON.stringify(gl)} 2d ${JSON.stringify(flat)} ratio ${ratio.toFixed(2)}`,
      );
      expect(flat.area, seen.at(-1)).toBeGreaterThan(20);
      expect(ratio, seen.at(-1)).toBeGreaterThan(MICE_SOLID.low);
      expect(ratio, seen.at(-1)).toBeLessThan(MICE_SOLID.high);
    }
    test.info().annotations.push({
      type: "solid area of the mice, webgl over 2d",
      description: seen.join("; "),
    });
  });

  test("with prefers-contrast: more the halo round a particle is off: what is lit is solid (a smaller share of it is faint), and there is at least as much of it solid as with the halo", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    await requireWebGL(page);
    await waitForShimmerOver(page);
    await scrollToProgress(page, 0.5);
    /** How many pixels of the WebGL canvas are lit at all (alpha 5 % or more), and how many are solid (alpha 40 % or more). */
    const lit = () =>
      page.evaluate(() => {
        const snapshot = (window as unknown as Record<string, unknown>)
          .__glSnapshot as HTMLCanvasElement;
        const { data } = snapshot
          .getContext("2d")!
          .getImageData(0, 0, snapshot.width, snapshot.height);
        let some = 0;
        let solid = 0;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i]! >= 13) some += 1;
          if (data[i]! >= 102) solid += 1;
        }
        return { some, solid };
      });
    const glow = await lit();
    await page.emulateMedia({ contrast: "more" });
    // The change redraws the frame in the task that handles it: the share of
    // what is lit that is only faint (the halo) falls.
    const faint = (v: { some: number; solid: number }) =>
      (v.some - v.solid) / v.some;
    await expect
      .poll(async () => faint(await lit()))
      .toBeLessThan(faint(glow) * 0.8);
    const flat = await lit();
    // Never less solid than with the halo: this mode is for seeing better.
    expect(flat.solid).toBeGreaterThanOrEqual(glow.solid);
    expect(await rendererOf(page)).toBe("webgl");
  });

  test("with prefers-contrast: more the particles are no fainter and no thinner than the Canvas 2D look's: at the logo and at the mice, the solid area is at least the 2D path's (the mode is for seeing better)", async ({
    page,
    context,
  }) => {
    await page.emulateMedia({ contrast: "more" });
    await page.goto("/");
    await waitForAnimated(page);
    await requireWebGL(page);
    await waitForShimmerOver(page);

    // The same page on the Canvas 2D fallback, in the same window.
    const flat = await context.newPage();
    await recordStage(flat);
    await flat.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (/webgl/i.test(type)) return null;
        return (getContext as (...args: unknown[]) => unknown).call(
          this,
          type,
          ...rest,
        );
      } as typeof getContext;
    });
    await flat.emulateMedia({ contrast: "more" });
    await flat.setViewportSize(page.viewportSize()!);
    await flat.goto("/");
    await waitForAnimated(flat);
    await expect(flat.locator(STORY)).toHaveAttribute("data-renderer", "2d");
    await expect(page.locator(STORY)).toHaveAttribute("data-renderer", "webgl");
    await waitForShimmerOver(flat);

    /** Solid pixels (alpha 80 % or more) per CSS px squared of the canvas that draws the particles, and the brightest alpha. */
    const solid = (target: Page, webgl: boolean) =>
      target.evaluate((useSnapshot) => {
        const canvas = useSnapshot
          ? ((window as unknown as Record<string, unknown>)
              .__glSnapshot as HTMLCanvasElement)
          : document.querySelector<HTMLCanvasElement>(".story-canvas")!;
        const css = document
          .querySelector(".story-canvas")!
          .getBoundingClientRect();
        const scale = canvas.width / css.width;
        const { data } = canvas
          .getContext("2d")!
          .getImageData(0, 0, canvas.width, canvas.height);
        let count = 0;
        let brightest = 0;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i]! >= 204) count += 1;
          brightest = Math.max(brightest, data[i]!);
        }
        return { area: count / (scale * scale), brightest };
      }, webgl);

    const seen: string[] = [];
    // The logo at the top, and the three mice at the end: no overlay is on the 2D canvas at either.
    for (const p of [0, 0.95]) {
      await scrollToProgress(page, p);
      await scrollToProgress(flat, p);
      await page.waitForTimeout(150);
      const gl = await solid(page, true);
      const old = await solid(flat, false);
      seen.push(`p=${p} webgl ${JSON.stringify(gl)} 2d ${JSON.stringify(old)}`);
      expect(old.area, seen.at(-1)).toBeGreaterThan(50);
      expect(gl.area, seen.at(-1)).toBeGreaterThanOrEqual(old.area);
      expect(gl.brightest, seen.at(-1)).toBeGreaterThanOrEqual(
        old.brightest * 0.95,
      );
    }
    test.info().annotations.push({
      type: "solid area (css px squared)",
      description: seen.join("; "),
    });
  });

  /** A page on the WebGL path with the made-up frame clock, past its shimmer, whose refresh interval is known. */
  async function guardPage(page: Page, fromStart?: { gap: number }) {
    await installFrameClock(page, fromStart);
    await page.goto("/");
    await waitForAnimated(page);
    await requireWebGL(page);
    await waitForShimmerOver(page);
    const canvas = page.locator(CANVAS);
    // A device slower than about 15 frames a second has fewer than 40 frames in
    // its 2.6 s shimmer: its interval is then learnt from the scroll's frames.
    if (!fromStart) {
      await expect(canvas).toHaveAttribute("data-refresh-ms", /^\d/);
    }
    const refresh = fromStart
      ? 16.7
      : Number(await canvas.getAttribute("data-refresh-ms"));
    // A missed frame: 2.2 times the interval, over the 1.7 line.
    const slow = Math.round(refresh * 2.2 * 10) / 10;
    return {
      canvas,
      refresh,
      slow,
      budget: Number(await canvas.getAttribute("data-particles")),
      drawn: async () => Number(await canvas.getAttribute("data-drawn")),
    };
  }

  /** In the page: every change of `data-drawn`, with the frame it came at (the plan's frame counter). */
  const watchSteps = (page: Page) =>
    page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const steps: { count: number; at: number }[] = [];
      w.__steps = steps;
      const element = document.querySelector<HTMLElement>(".story-canvas")!;
      new MutationObserver(() => {
        steps.push({
          count: Number(element.dataset.drawn),
          at: w.__frame as number,
        });
      }).observe(element, {
        attributes: true,
        attributeFilter: ["data-drawn"],
      });
    });

  test("when every frame is missed it draws fewer particles, a quarter at a time, then waits for 60 fresh frames before the next step, never goes under a quarter of the budget, and never comes back", async ({
    page,
  }) => {
    const { canvas, refresh, slow, budget, drawn } = await guardPage(page);
    expect(await drawn()).toBe(budget);
    await watchSteps(page);
    await missFrames(page, { normal: refresh, slow, misses: "all" });
    const floor = Math.ceil(budget * 0.25);
    for (let chunk = 0; chunk < 80 && (await drawn()) > floor; chunk += 1) {
      await scrollFrames(page, 10, 2);
    }
    const changes = await read<{ count: number; at: number }[]>(
      page,
      "__steps",
    );
    const counts = changes.map((c) => c.count);
    // A quarter of what was drawn each time, down to the floor.
    let want = budget;
    const ladder: number[] = [];
    while (want > floor) {
      want = Math.max(floor, Math.round(want * 0.75));
      ladder.push(want);
    }
    expect(counts, JSON.stringify(changes)).toEqual(ladder);
    // The cooldown: after a step the window starts empty and has to fill all
    // 60 gaps before the next one, so steps are 60 frames apart (the first
    // comes later still: nothing is counted before the first scroll, the first
    // DEGRADE.RESTART_GRACE gaps after it are forgiven, and the window has to
    // fill). Without the cooldown they would come every 8.
    for (let i = 1; i < changes.length; i += 1) {
      expect(changes[i]!.at - changes[i - 1]!.at, JSON.stringify(changes)).toBe(
        DEGRADE.WINDOW,
      );
    }
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(floor);
    // The budget the page reports is unchanged: it is the ceiling.
    expect(Number(await canvas.getAttribute("data-particles"))).toBe(budget);

    // Quick frames again: nothing comes back.
    await restoreClock(page);
    const low = await drawn();
    await scrollFrames(page, 150, 1);
    expect(await drawn()).toBeLessThanOrEqual(low);
  });

  test("when 40 % of the frames are missed it draws fewer particles", async ({
    page,
  }) => {
    const { refresh, slow, budget, drawn } = await guardPage(page);
    await missFrames(page, {
      normal: refresh,
      slow,
      misses: { twoInFive: true },
    });
    await scrollFrames(page, 150, 2);
    const after = await drawn();
    expect(after).toBeLessThan(budget);
    expect(after).toBeGreaterThanOrEqual(Math.ceil(budget * 0.25));
  });

  test("a frame missed now and then is not a slow device: 1 in 15, and 1 in 9, over 400 frames each, change nothing", async ({
    page,
  }) => {
    const { refresh, slow, budget, drawn } = await guardPage(page);
    // 4, and 6 or 7, missed frames in any 60: under the 8 it takes.
    for (const every of [15, 9]) {
      await missFrames(page, { normal: refresh, slow, misses: { every } });
      await scrollFrames(page, 400, 1);
      expect(await drawn(), `1 in ${every}`).toBe(budget);
    }
  });

  for (const gap of [33.3, 70]) {
    test(`a device that is slow from its very first frame is stepped down too: ${gap} ms frames from the page load (the screen's interval is taken to be 16.7 ms at the most, and a gap over 50 ms is a slow frame, not a pause)`, async ({
      page,
    }) => {
      const { canvas, budget, drawn } = await guardPage(page, { gap });
      // The page's frames before the first scroll are all slow, and none of
      // them is counted: the whole budget is still drawn.
      expect(await drawn()).toBe(budget);
      for (
        let chunk = 0;
        chunk < 60 && (await drawn()) === budget;
        chunk += 1
      ) {
        await scrollFrames(page, 10, 2);
      }
      // The estimate was capped at 16.7 ms, and the window filled with slow frames.
      await expect(canvas).toHaveAttribute("data-refresh-ms", "16.7");
      const after = await drawn();
      expect(after, `${gap} ms frames`).toBeLessThan(budget);
      expect(after).toBeGreaterThanOrEqual(Math.ceil(budget * 0.25));
    });
  }

  test("the page's own frames before the first scroll are not counted: with a slow frame in every 6 from the page load (a machine busy with something else while the page starts: over the 8 in 60) everything is still drawn, and a steady scroll afterwards takes nothing", async ({
    page,
  }) => {
    await installFrameClock(page);
    // The made-up clock, from the first frame: 33.4 ms in every 6th frame, the
    // rest 16.7 ms (the shimmer's frames: 95 of them are past the first 40).
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__plan = (
        frame: number,
      ) => (frame % 6 === 0 ? 33.4 : 16.7);
    });
    await page.goto("/");
    await waitForAnimated(page);
    await requireWebGL(page);
    await waitForShimmerOver(page);
    const canvas = page.locator(CANVAS);
    const budget = Number(await canvas.getAttribute("data-particles"));
    // Nothing scrolled, and the frames were slow often enough to step down if
    // they were counted.
    expect(Number(await canvas.getAttribute("data-drawn"))).toBe(budget);
    // The reader scrolls, with steady frames (the made-up clock, 16.7 ms a
    // frame: software WebGL's own frames at the dust are slow): the budget
    // stays whole.
    await missFrames(page, { normal: 16.7, slow: 16.7, misses: "none" });
    for (let chunk = 0; chunk < 12; chunk += 1) {
      await scrollFrames(page, 10, 2);
    }
    expect(Number(await canvas.getAttribute("data-drawn"))).toBe(budget);
  });

  test("sparse input is not a slow device: a scroll step every 30 ms, or every 100 ms, over 150 frames each, changes nothing (the guard times the animation frames, which the loop keeps coming for the whole scroll, not the draws)", async ({
    page,
  }) => {
    const { refresh, budget, drawn } = await guardPage(page);
    for (const every of [30, 100]) {
      await missFrames(page, {
        normal: refresh,
        slow: refresh,
        misses: "none",
      });
      await page.evaluate(
        ([ms]) =>
          new Promise<void>((resolve) => {
            const w = window as unknown as Record<string, number>;
            const from = w.__frame!;
            const timer = setInterval(() => {
              window.scrollBy(0, 2);
              if (w.__frame! - from >= 150) {
                clearInterval(timer);
                resolve();
              }
            }, ms);
          }),
        [every],
      );
      expect(await drawn(), `a step every ${every} ms`).toBe(budget);
    }
  });

  test("a reader who scrolls, stops and scrolls again is not a slow device: 30 bursts of 5 frames with 300 ms between them change nothing (the time they stood still is not a frame)", async ({
    page,
  }) => {
    // The real clock: the time between two runs of frames is real here.
    await installFrameClock(page);
    await page.goto("/");
    await waitForAnimated(page);
    await requireWebGL(page);
    await waitForShimmerOver(page);
    const canvas = page.locator(CANVAS);
    await expect(canvas).toHaveAttribute("data-refresh-ms", /^\d/);
    const refresh = Number(await canvas.getAttribute("data-refresh-ms"));
    test.skip(
      refresh > 20,
      `This machine's frames take ${refresh} ms: its real frames are not steady enough for this test.`,
    );
    const budget = Number(await canvas.getAttribute("data-particles"));
    // Nothing has been scrolled yet: the page's own frames (the shimmer, with
    // the dev server perhaps still compiling beside it) are not counted by the
    // guard, so the whole budget is drawn whatever those frames were like.
    expect(Number(await canvas.getAttribute("data-drawn"))).toBe(budget);
    for (let burst = 0; burst < 30; burst += 1) {
      await scrollFrames(page, 5, 4);
      await page.waitForTimeout(320);
    }
    expect(Number(await canvas.getAttribute("data-drawn"))).toBe(budget);
  });

  test("the frame loop runs for 200 ms after the last scroll event so every frame of a scroll is timed, and then stops: nothing is scheduled while the page is still (no idle loop)", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    await requireWebGL(page);
    await waitForShimmerOver(page);
    const raf = () => read<number>(page, "__raf");
    const draws = () => read<number[]>(page, "__draws").then((d) => d.length);
    await page.evaluate(() => window.scrollBy(0, 40));
    // The scroll draws once (the picture changed); the loop then goes on for
    // the tail: frames, but no draws.
    await expect.poll(draws).toBeGreaterThan(0);
    const during = await raf();
    await page.waitForTimeout(150);
    const tail = await raf();
    expect(
      tail,
      "the loop is still running 150 ms after the scroll",
    ).toBeGreaterThan(during);
    // After the tail it is over, and stays over.
    await page.waitForTimeout(500);
    const stopped = await raf();
    const drawsAtRest = await draws();
    await page.waitForTimeout(1500);
    expect(await raf()).toBe(stopped);
    expect(await draws()).toBe(drawsAtRest);
    // The tail is about 200 ms of frames: a dozen or so at 60 Hz, far from a loop.
    expect(stopped - during).toBeLessThan(60);
  });

  test("with the guard stepped down the drawing is still whole: the logo, at p = 0, is on its mark", async ({
    page,
  }) => {
    const { canvas, refresh, slow, budget, drawn } = await guardPage(page);
    await missFrames(page, { normal: refresh, slow, misses: "all" });
    await scrollFrames(page, 200, 2);
    await restoreClock(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator(STORY)).toHaveAttribute("data-progress", "0.000");
    expect(await drawn()).toBeLessThan(budget);
    expect(Number(await canvas.getAttribute("data-particles"))).toBe(budget);
    const ink = await logoInk(page);
    expect(ink.empty).toBe(false);
    // Every edge of the mark is where the target puts it: a fraction of the
    // particles is a fair sample, not a piece of the logo.
    expect(logoOffMark(ink), JSON.stringify(ink)).toEqual([]);
  });

  test("with the guard stepped down to its floor the stars are all still there: only the dust is thinner, because the lit particles come first in the order", async ({
    page,
  }) => {
    const { refresh, slow, budget, drawn } = await guardPage(page);
    const floor = Math.ceil(budget * 0.25);
    await missFrames(page, { normal: refresh, slow, misses: "all" });
    for (let chunk = 0; chunk < 80 && (await drawn()) > floor; chunk += 1) {
      await scrollFrames(page, 10, 2);
    }
    await restoreClock(page);
    expect(await drawn()).toBe(floor);
    const model = await stageModel(page);
    await scrollToProgress(page, 0.95);
    await page.waitForTimeout(150);
    const lit = model.expected(0.95).solid.length / 2;
    // A quarter of the particles are drawn, and every star of the mice is among them.
    expect(lit).toBe(litCount(LIT_FRACTION.mouse, budget, budget));
    const got = await blobs(page);
    const ratio = got.count / lit;
    expect(ratio, `${got.count} blobs for ${lit} stars`).toBeGreaterThan(
      STAR_BLOBS.low,
    );
    expect(ratio, `${got.count} blobs for ${lit} stars`).toBeLessThan(
      STAR_BLOBS.high,
    );
  });
});

test.describe("the fallback to Canvas 2D", () => {
  /** What the stage should draw on the 2D path: 900 on a phone and 1,300 on a desktop, halved at 4 cores or fewer, a multiple of three. */
  async function expected2dBudget(page: Page) {
    const { wide, cores } = await page.evaluate(() => ({
      wide: matchMedia("(min-width: 48rem)").matches,
      cores: navigator.hardwareConcurrency,
    }));
    const base = wide ? 1300 : 900;
    const wanted = cores <= 4 ? Math.floor(base / 2) : base;
    return wanted - (wanted % 3);
  }

  /**
   * The 2D path is on, with its own budget, draws on scroll, and hands the
   * logo over where the image was. `neverUsedWebGL` is for a page that never
   * had a WebGL context: nothing was ever uploaded to a GPU.
   */
  async function expectCanvas2dStage(page: Page, neverUsedWebGL = true) {
    await expect(page.locator(STORY)).toHaveAttribute("data-renderer", "2d");
    const facts = await layoutFacts(page);
    expect(facts.animated).toBe(true);
    expect(facts.canvasDisplay).toBe("block");
    // The WebGL canvas is not shown: the 2D one draws the particles.
    expect(facts.glCanvasDisplay).toBe("none");
    expect(facts.logoVisibility).toBe("hidden");
    await expect(page.locator(CANVAS)).toHaveAttribute(
      "data-particles",
      String(await expected2dBudget(page)),
    );
    // It draws: scrolling asks for frames, and each one is a draw.
    const draws = () =>
      page.locator(CANVAS).getAttribute("data-draws").then(Number);
    const before = await draws();
    for (const p of [0.2, 0.5, 0.8]) await scrollToProgress(page, p);
    expect(await draws()).toBeGreaterThan(before + 2);
    // The logo, at the top, is drawn on the 2D canvas where the (hidden) image is.
    await scrollToProgress(page, 0);
    await expect.poll(async () => (await logoInk(page)).empty).toBe(false);
    const ink = await logoInk(page);
    expect(logoOffMark(ink), JSON.stringify(ink)).toEqual([]);
    if (neverUsedWebGL) {
      expect(await read<number>(page, "__bufferUploads")).toBe(0);
    }
  }

  test("with no WebGL context to be had, the stage draws on Canvas 2D with the old budget, and says so in data-renderer", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (/webgl/i.test(type)) return null;
        return (getContext as (...args: unknown[]) => unknown).call(
          this,
          type,
          ...rest,
        );
      } as typeof getContext;
    });
    await page.goto("/");
    await waitForAnimated(page);
    await expectCanvas2dStage(page);
    // Every check above ran on the 2D path, and nothing threw.
    expect(errors).toEqual([]);
  });

  test("a shader that does not compile is the same fallback", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const proto = WebGLRenderingContext.prototype;
      proto.getShaderParameter = function (
        this: WebGLRenderingContext,
        _shader: WebGLShader,
        pname: number,
      ) {
        // COMPILE_STATUS is false: every shader "fails".
        return pname === this.COMPILE_STATUS ? false : null;
      } as typeof proto.getShaderParameter;
    });
    await page.goto("/");
    await waitForAnimated(page);
    await expectCanvas2dStage(page);
  });

  test("a GPU whose largest point is too small is the same fallback", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const proto = WebGLRenderingContext.prototype;
      const getParameter = proto.getParameter;
      proto.getParameter = function (
        this: WebGLRenderingContext,
        pname: number,
      ) {
        // ALIASED_POINT_SIZE_RANGE is [1, 16]: under what the stage asks for, with its 24 px of room.
        if (pname === this.ALIASED_POINT_SIZE_RANGE) {
          return new Float32Array([1, 16]);
        }
        return getParameter.call(this, pname);
      } as typeof proto.getParameter;
    });
    await page.goto("/");
    await waitForAnimated(page);
    await expectCanvas2dStage(page);
  });

  test("when the browser takes the WebGL context away, the stage moves to Canvas 2D in that moment and the animation goes on", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await waitForAnimated(page);
    await requireWebGL(page);
    await waitForShimmerOver(page);
    await scrollToProgress(page, 0.5);
    const lost = await page.evaluate(() => {
      const canvas =
        document.querySelector<HTMLCanvasElement>(".story-canvas-gl")!;
      let prevented = true;
      canvas.addEventListener("webglcontextlost", (event) => {
        // Listeners run in order: the stage's came first, so this sees its decision.
        prevented = event.defaultPrevented;
      });
      const gl = canvas.getContext("webgl")!;
      gl.getExtension("WEBGL_lose_context")!.loseContext();
      return new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(prevented), 100),
      );
    });
    // The stage did not call preventDefault(): that would ask the browser to
    // restore the context, and the stage has decided it never uses WebGL again
    // this visit. Left alone, the browser does not restore it.
    expect(lost).toBe(false);
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(() =>
        document
          .querySelector<HTMLCanvasElement>(".story-canvas-gl")!
          .getContext("webgl")!
          .isContextLost(),
      ),
      "the lost context stayed lost",
    ).toBe(true);
    await expectCanvas2dStage(page, false);
    expect(errors).toEqual([]);
  });
});
