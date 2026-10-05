import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { PARTICLE_SEED } from "../../src/lib/particles/budget";
import { SHUFFLE_SEED, shuffleOrder } from "../../src/lib/particles/gl-buffers";
import { parseTargets } from "../../src/lib/particles/load-targets";
import { buildPairing } from "../../src/lib/particles/pairing";
import {
  type StageLayout,
  buildParticleSet,
  createFrame,
  handBox,
  logoBox,
  mouseBox,
  writeParticles,
} from "../../src/lib/particles/particle-set";
import { phaseAt } from "../../src/lib/particles/timeline";
import {
  CANVAS,
  STORY,
  layoutFacts,
  logoInk,
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
 * The page's frame clock, made slow on purpose, from before its own scripts
 * run: once `slowDown` is called, the timestamps requestAnimationFrame hands to
 * its callbacks run `factor` times faster than the real ones, so the gaps
 * between the stage's frames are `factor` times as long. (The guard only reads
 * those timestamps; what the screen really does is not touched.)
 */
async function installSlowClock(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, number>;
    w.__slowFactor = 0;
    w.__slowFrom = 0;
    w.__slowAt = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      raf((time) =>
        callback(
          w.__slowFactor > 0
            ? w.__slowAt + (time - w.__slowFrom) * w.__slowFactor
            : time,
        ),
      );
  });
}

const slowDown = (page: Page, factor: number) =>
  page.evaluate((f) => {
    const w = window as unknown as Record<string, number>;
    w.__slowFrom = performance.now();
    w.__slowAt = performance.now();
    w.__slowFactor = f;
  }, factor);

const speedUp = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as Record<string, number>).__slowFactor = 0;
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

test.describe("the WebGL path", () => {
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

  test("the first frame is on the WebGL canvas and the layout switches after it", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    test.skip(
      (await rendererOf(page)) !== "webgl",
      "No WebGL here: the fallback group covers this machine.",
    );
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
    test.skip(
      (await rendererOf(page)) !== "webgl",
      "No WebGL here: the fallback group covers this machine.",
    );
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
    test.skip(
      (await rendererOf(page)) !== "webgl",
      "No WebGL here: the fallback group covers this machine.",
    );
    await waitForShimmerOver(page);
    await scrollToProgress(page, 0);

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
    // The first `drawn` of the shuffled order are the particles on screen (all of them, unless the guard has stepped in).
    const onScreen = Array.from(
      shuffleOrder(page_.count, SHUFFLE_SEED).slice(0, page_.drawn),
    );

    /** Where the TypeScript maths puts the particles on screen at p, in CSS px: x, y, x, y, ... */
    const expected = (p: number) => {
      writeParticles(set, phaseAt(p), frame);
      const xy: number[] = [];
      for (const i of onScreen) {
        const x = frame.xy[2 * i]!;
        const y = frame.xy[2 * i + 1]!;
        // The swirl takes some particles past the edge of the canvas (a phone's is
        // narrow): they are not seen, so they are not compared.
        if (x >= 0 && x < page_.width && y >= 0 && y < page_.height) {
          xy.push(x, y);
        }
      }
      return xy;
    };

    /**
     * What the WebGL canvas shows, read from its pixels (the copy `recordStage`
     * keeps), set against `xy`. Brightness is left out on purpose: a bright
     * particle, a dim one and a stack of ten on a stroke all weigh differently
     * in light, so a centre of light is not a centre of particles. What does
     * not depend on it is where the picture is lit at all:
     * - the box round everything lit (alpha 10 % or more: a lone dim particle
     *   at the edge of the cloud is faint, and still has to be where it should);
     * - the lit area in 4 px cells: its centre, and how well it covers the
     *   cells the particles are in, and the other way round.
     */
    const compare = (xy: number[]) =>
      page.evaluate((positions) => {
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
        const made = new Set<number>();
        for (let i = 0; i < positions.length; i += 2) {
          made.add(
            key(
              Math.floor(positions[i]! / CELL),
              Math.floor(positions[i + 1]! / CELL),
            ),
          );
        }
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
        for (const k of lit) if (near(made, k)) litAreMade += 1;
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
      }, xy);

    // A few CSS px: a particle is a soft dot a few px wide, so the lit area
    // reaches a little past the particles' own box. A wrong formula (a missing
    // swirl, the wrong leg, the wrong end) is out by tens of px mid-leg, and
    // fails every line below.
    const BOX = 4;
    const CENTRE = 3;
    const seen: string[] = [];
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      await scrollToProgress(page, p);
      await page.waitForTimeout(150);
      const xy = expected(p);
      const got = await compare(xy);
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
      const off = {
        x0: +(got.box.x0 - x0).toFixed(2),
        y0: +(got.box.y0 - y0).toFixed(2),
        x1: +(got.box.x1 - x1).toFixed(2),
        y1: +(got.box.y1 - y1).toFixed(2),
        cx: +got.centreOff[0].toFixed(2),
        cy: +got.centreOff[1].toFixed(2),
        madeAreLit: +got.madeAreLit.toFixed(3),
        litAreMade: +got.litAreMade.toFixed(3),
      };
      const note = `p=${p} ${JSON.stringify(off)}`;
      seen.push(note);
      expect(got.litCells, `p=${p}: something is drawn`).toBeGreaterThan(100);
      for (const key of ["x0", "y0", "x1", "y1"] as const) {
        expect(Math.abs(off[key]), `${key}: ${note}`).toBeLessThan(BOX);
      }
      for (const key of ["cx", "cy"] as const) {
        expect(Math.abs(off[key]), `${key}: ${note}`).toBeLessThan(CENTRE);
      }
      // Nearly every cell the maths puts a particle in is lit, and nearly
      // everything lit is next to a particle.
      expect(off.madeAreLit, note).toBeGreaterThan(0.97);
      expect(off.litAreMade, note).toBeGreaterThan(0.98);
    }
    test.info().annotations.push({
      type: "differences (CSS px)",
      description: seen.join("; "),
    });
  });

  test("with prefers-contrast: more the halo round a particle is off: much less of the picture is lit, and the drawing is still there", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    test.skip(
      (await rendererOf(page)) !== "webgl",
      "No WebGL here: the fallback group covers this machine.",
    );
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
    // The change redraws the frame in the task that handles it.
    await expect.poll(async () => (await lit()).some).toBeLessThan(glow.some);
    const flat = await lit();
    // The soft halo goes: the lit area shrinks by a good share, and the solid cores stay.
    expect(flat.some).toBeLessThan(glow.some * 0.8);
    expect(flat.solid).toBeGreaterThan(glow.solid * 0.5);
    expect(await rendererOf(page)).toBe("webgl");
  });

  test("when frames come slowly it draws fewer particles, a quarter at a time, never fewer than a quarter of the budget, and never more again", async ({
    page,
  }) => {
    await installSlowClock(page);
    await page.goto("/");
    await waitForAnimated(page);
    test.skip(
      (await rendererOf(page)) !== "webgl",
      "The guard belongs to the WebGL path.",
    );
    await waitForShimmerOver(page);
    const canvas = page.locator(CANVAS);
    const budget = Number(await canvas.getAttribute("data-particles"));
    expect(Number(await canvas.getAttribute("data-drawn"))).toBe(budget);
    // The screen's refresh interval is known from the shimmer's frames.
    await expect(canvas).toHaveAttribute("data-refresh-ms", /^\d/);
    const refresh = Number(await canvas.getAttribute("data-refresh-ms"));
    test.skip(
      refresh * 2.2 > 48,
      `This machine's frames take ${refresh} ms: twice that is a pause to the guard (over 50 ms), not a slow frame.`,
    );
    const drawn = async () => Number(await canvas.getAttribute("data-drawn"));

    // Frames 2.2 times as slow as the screen's: over the 1.7 line. 45 of them
    // fill the window, so a few hundred frames take it down several steps.
    await slowDown(page, 2.2);
    const steps: number[] = [budget];
    for (let i = 0; i < 4; i += 1) {
      await scrollFrames(page, 50);
      steps.push(await drawn());
    }
    // It stepped down (never up), by a quarter of what was drawn, until the floor.
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]!, steps.join(" ")).toBeLessThanOrEqual(steps[i - 1]!);
    }
    expect(steps[1], steps.join(" ")).toBe(Math.round(budget * 0.75));
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(Math.ceil(budget * 0.25));
    expect(steps.at(-1)!, steps.join(" ")).toBeLessThan(budget * 0.6);
    // The budget the page reports is unchanged: it is the ceiling.
    expect(Number(await canvas.getAttribute("data-particles"))).toBe(budget);

    // Quick frames again: nothing comes back.
    await speedUp(page);
    const low = await drawn();
    await scrollFrames(page, 120);
    expect(await drawn()).toBeLessThanOrEqual(low);
  });

  test("a pause is not a slow frame: frames that are far apart (the reader stopping and starting) do not lower the count", async ({
    page,
  }) => {
    await installSlowClock(page);
    await page.goto("/");
    await waitForAnimated(page);
    test.skip(
      (await rendererOf(page)) !== "webgl",
      "The guard belongs to the WebGL path.",
    );
    await waitForShimmerOver(page);
    const canvas = page.locator(CANVAS);
    const budget = Number(await canvas.getAttribute("data-particles"));
    await expect(canvas).toHaveAttribute("data-refresh-ms", /^\d/);
    // Every gap over 50 ms: factor 6 on a 16.7 ms frame is 100 ms.
    await slowDown(page, 6);
    await scrollFrames(page, 200);
    await speedUp(page);
    expect(Number(await canvas.getAttribute("data-drawn"))).toBe(budget);
  });

  test("with the guard stepped down the drawing is still whole: the logo, at p = 0, is on its mark", async ({
    page,
  }) => {
    await installSlowClock(page);
    await page.goto("/");
    await waitForAnimated(page);
    test.skip(
      (await rendererOf(page)) !== "webgl",
      "The guard belongs to the WebGL path.",
    );
    await waitForShimmerOver(page);
    const canvas = page.locator(CANVAS);
    await expect(canvas).toHaveAttribute("data-refresh-ms", /^\d/);
    const refresh = Number(await canvas.getAttribute("data-refresh-ms"));
    test.skip(refresh * 2.2 > 48, "Frames too slow to fake a slow window.");
    await slowDown(page, 2.2);
    await scrollFrames(page, 200);
    await speedUp(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator(STORY)).toHaveAttribute("data-progress", "0.000");
    const budget = Number(await canvas.getAttribute("data-particles"));
    expect(Number(await canvas.getAttribute("data-drawn"))).toBeLessThan(
      budget,
    );
    const ink = await logoInk(page);
    expect(ink.empty).toBe(false);
    // Every edge of the mark is where the image's is: a fraction of the
    // particles is a fair sample, not a piece of the logo.
    expect(ink.worst, JSON.stringify(ink.edges)).toBeLessThanOrEqual(3);
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
    expect(ink.worst, JSON.stringify(ink.edges)).toBeLessThanOrEqual(3);
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
    test.skip(
      (await rendererOf(page)) !== "webgl",
      "No WebGL here: the blocked-context test above covers this machine.",
    );
    await waitForShimmerOver(page);
    await scrollToProgress(page, 0.5);
    const lost = await page.evaluate(() => {
      const canvas =
        document.querySelector<HTMLCanvasElement>(".story-canvas-gl")!;
      let prevented = false;
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
    // The stage took over the event (preventDefault), so the browser does not
    // restore the context on its own.
    expect(lost).toBe(true);
    await expectCanvas2dStage(page, false);
    expect(errors).toEqual([]);
  });
});
