import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { parseTargets } from "../../../src/lib/particles/load-targets";
import { LOGO_BOX, LOGO_SAMPLING } from "../../../src/lib/particles/logo";

export {
  LOGO_EDGE,
  LOGO_TOP_LEFT_SHARE,
  logoOffMark,
  type LogoFit,
} from "./logo-fit";

/**
 * Shared by the home page's particle-stage specs (Home v3, PR B): the story's
 * scroll helpers, and an init script that records what the page does while it
 * switches to the animated layout. The page publishes its diagnostics on
 * purpose: `data-progress`, `data-story` and `data-renderer` ("webgl" or "2d")
 * on the section, and `data-draws`, `data-particles` (the budget) and
 * `data-drawn` (how many the WebGL path draws now: the guard only lowers it)
 * on the 2D canvas.
 */

export const STORY = ".story";
/** The 2D layer (the top canvas): the overlay, and the particles too when the stage has fallen back to Canvas 2D. */
export const CANVAS = ".story-canvas";
/** The WebGL layer under it, which draws the particles when WebGL is on. */
export const GL_CANVAS = ".story-canvas-gl";
export const HERO = '[data-testid="home-hero"]';
export const CAPTION = "G Pro X Superlight 2 · sketch";

/** Wait until the page has switched to the animated layout (the module is dynamic, and dev compiles it on demand). */
export async function waitForAnimated(page: Page): Promise<void> {
  await expect(page.locator(STORY)).toHaveClass(/story--animated/, {
    timeout: 60_000,
  });
  await expect(page.locator(CANVAS)).toHaveAttribute("data-draws", /^\d+$/);
}

/** Scroll so the story's progress is `p`, and wait until a frame for it has been drawn. */
export async function scrollToProgress(page: Page, p: number): Promise<void> {
  await page.evaluate((want) => {
    const section = document.querySelector(".story") as HTMLElement;
    const panel = document.querySelector(".story-panel") as HTMLElement;
    const top = section.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(
      0,
      top + want * (section.offsetHeight - panel.offsetHeight),
    );
  }, p);
  await page.waitForFunction((want) => {
    const section = document.querySelector(".story") as HTMLElement | null;
    const got = Number(section?.dataset.progress);
    return Number.isFinite(got) && Math.abs(got - want) < 0.002;
  }, p);
}

/**
 * Records, from before the page's own scripts run:
 * - `__draws`: when each canvas draw started (the stage clears the canvas once per frame);
 * - `__raf`: how many requestAnimationFrame calls the page made;
 * - `__activatedAt`: when `story--animated` was added;
 * - `__events`: the order of the two switch steps (the class added, the static logo hidden), with the canvas's draw count at that moment;
 * - `__frames`: one entry per frame (from a sampler of our own): is the static logo visible, is the canvas shown;
 * - `__cls`: the cumulative layout shift, and `__clsAfterSwitch` the part of it from the moment the layout switched.
 *
 * And for the WebGL layer (the canvas `.story-canvas-gl`), which has no pixels
 * to read once the browser has shown a frame:
 * - `__glDraws`: when each `drawArrays` on it ran;
 * - `__glLog`: the order of what happens to it, "resize" and "draw", like `__canvasLog` for the 2D canvas;
 * - `__glSnapshot`: a 2D canvas that is a copy of the WebGL canvas, taken in the same task right after every draw (when its drawing buffer is still valid). Reading it is reading the WebGL pixels;
 * - `__bufferUploads`: how many `bufferData` calls it made (the particles are uploaded once per layout, never while scrolling).
 */
export async function recordStage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__draws = [] as number[];
    w.__glDraws = [] as number[];
    w.__glLog = [] as string[];
    w.__bufferUploads = 0;
    w.__raf = 0;
    w.__events = [] as string[];
    w.__frames = [] as {
      logo: boolean;
      canvas: boolean;
      drawn: number;
      gl: boolean;
      glDrawn: number;
    }[];
    w.__cls = 0;

    // The order of what happens to the canvas: "resize" (its backing store was
    // resized, which clears it), "draw", and "frame" (a new frame began).
    const canvasLog: string[] = [];
    w.__canvasLog = canvasLog;
    const proto = CanvasRenderingContext2D.prototype;
    const clear = proto.clearRect;
    proto.clearRect = function (...args: Parameters<typeof clear>) {
      if (this.canvas.classList.contains("story-canvas")) {
        (w.__draws as number[]).push(performance.now());
        canvasLog.push("draw");
      }
      return clear.apply(this, args);
    };
    for (const side of ["width", "height"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLCanvasElement.prototype,
        side,
      );
      if (!descriptor?.set) continue;
      Object.defineProperty(HTMLCanvasElement.prototype, side, {
        ...descriptor,
        set(value: number) {
          if (this.classList.contains("story-canvas")) canvasLog.push("resize");
          descriptor.set!.call(this, value);
        },
      });
    }

    // The WebGL layer. `drawArrays` is the one draw call a frame makes: record
    // it, and copy the canvas into a 2D canvas while its drawing buffer is valid.
    const isGlLayer = (canvas: HTMLCanvasElement) =>
      canvas.classList.contains("story-canvas-gl");
    const glLog = w.__glLog as string[];
    const snapshot = document.createElement("canvas");
    w.__glSnapshot = snapshot;
    const glProto = WebGLRenderingContext.prototype;
    const drawArrays = glProto.drawArrays;
    glProto.drawArrays = function (
      this: WebGLRenderingContext,
      ...args: Parameters<typeof drawArrays>
    ) {
      const result = drawArrays.apply(this, args);
      const canvas = this.canvas as HTMLCanvasElement;
      if (isGlLayer(canvas)) {
        (w.__glDraws as number[]).push(performance.now());
        glLog.push("draw");
        if (snapshot.width !== canvas.width) snapshot.width = canvas.width;
        if (snapshot.height !== canvas.height) snapshot.height = canvas.height;
        const copy = snapshot.getContext("2d")!;
        copy.clearRect(0, 0, snapshot.width, snapshot.height);
        copy.drawImage(canvas, 0, 0);
      }
      return result;
    };
    const bufferData = glProto.bufferData as (...args: unknown[]) => void;
    glProto.bufferData = function (
      this: WebGLRenderingContext,
      ...args: unknown[]
    ) {
      if (isGlLayer(this.canvas as HTMLCanvasElement)) {
        w.__bufferUploads = (w.__bufferUploads as number) + 1;
      }
      return bufferData.apply(this, args);
    } as typeof glProto.bufferData;
    for (const side of ["width", "height"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLCanvasElement.prototype,
        side,
      );
      if (!descriptor?.set) continue;
      Object.defineProperty(HTMLCanvasElement.prototype, side, {
        ...descriptor,
        set(this: HTMLCanvasElement, value: number) {
          if (isGlLayer(this)) glLog.push("resize");
          descriptor.set!.call(this, value);
        },
      });
    }

    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => {
      w.__raf = (w.__raf as number) + 1;
      return raf(callback);
    };

    const draws = () =>
      Number(
        document.querySelector(".story-canvas")?.getAttribute("data-draws") ??
          0,
      );
    const events = w.__events as string[];

    // A synchronous hook on the class add, so the order of the switch is
    // recorded as it happens (an observer only reports a task's final state).
    const add = DOMTokenList.prototype.add;
    // `element.style.visibility = ...` can not be hooked (it is a named
    // property of the style object), so the logo's hide is seen by an observer
    // and the class add, which comes first, records whether it was still shown.
    DOMTokenList.prototype.add = function (...tokens: string[]) {
      if (tokens.includes("story--animated") && !w.__activatedAt) {
        w.__activatedAt = performance.now();
        w.__glDrawsAtSwitch = (w.__glDraws as number[]).length;
        const logo = document.querySelector<HTMLElement>(".story-logo img");
        events.push(
          `class added, draws=${draws()}, clears=${(w.__draws as number[]).length}, logoHidden=${logo?.style.visibility === "hidden"}`,
        );
      }
      return add.apply(this, tokens);
    };
    new MutationObserver(() => {
      const logo = document.querySelector<HTMLElement>(".story-logo img");
      if (
        logo?.style.visibility === "hidden" &&
        !events.some((e) => e.startsWith("logo hidden"))
      ) {
        events.push(`logo hidden, draws=${draws()}`);
      }
    }).observe(document, {
      attributes: true,
      subtree: true,
      attributeFilter: ["style"],
    });

    const sample = () => {
      const logo = document.querySelector<HTMLElement>(".story-logo img");
      const canvas = document.querySelector<HTMLElement>(".story-canvas");
      canvasLog.push("frame");
      if (logo && canvas) {
        const gl = document.querySelector<HTMLElement>(".story-canvas-gl");
        (w.__frames as unknown[]).push({
          logo: getComputedStyle(logo).visibility !== "hidden",
          canvas: getComputedStyle(canvas).display !== "none",
          drawn: Number(canvas.getAttribute("data-draws") ?? 0),
          gl: gl !== null && getComputedStyle(gl).display !== "none",
          glDrawn: (w.__glDraws as number[]).length,
        });
      }
      raf(sample);
    };
    raf(sample);

    w.__clsAfterSwitch = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        startTime: number;
        hadRecentInput: boolean;
      }[]) {
        if (entry.hadRecentInput) continue;
        w.__cls = (w.__cls as number) + entry.value;
        if (w.__activatedAt && entry.startTime >= (w.__activatedAt as number)) {
          w.__clsAfterSwitch = (w.__clsAfterSwitch as number) + entry.value;
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

export async function read<T>(page: Page, name: string): Promise<T> {
  return page.evaluate(
    (key) => (window as unknown as Record<string, unknown>)[key],
    name,
  ) as Promise<T>;
}

/** Where the hero's parts are on the page (document coordinates), to compare the two layouts. */
export async function heroGeometry(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const r = document.querySelector(selector)!.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y + window.scrollY,
        width: r.width,
        height: r.height,
      };
    };
    return {
      hero: box('[data-testid="home-hero"]'),
      slot: box(".story-logo"),
      logo: box(".story-logo img"),
      h1: box("h1"),
      subhead: box(".home-subhead"),
      actions: box('[data-testid="home-hero"] .home-actions'),
    };
  });
}

/** Facts about the layout that tell the static page from the animated one. */
export async function layoutFacts(page: Page) {
  // Measure with the fonts in place (a web font would swap in after first layout).
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => {
    const section = document.querySelector<HTMLElement>(".story")!;
    const panel = document.querySelector<HTMLElement>(".story-panel")!;
    const canvas = document.querySelector<HTMLElement>(".story-canvas")!;
    const glCanvas = document.querySelector<HTMLElement>(".story-canvas-gl")!;
    const logo = document.querySelector<HTMLElement>(".story-logo img")!;
    const hero = document.querySelector<HTMLElement>(".story-hero")!;
    return {
      animated: section.classList.contains("story--animated"),
      sectionHeight: section.offsetHeight,
      panelHeight: panel.offsetHeight,
      panelPosition: getComputedStyle(panel).position,
      scrollHeight: document.documentElement.scrollHeight,
      viewport: window.innerHeight,
      canvasDisplay: getComputedStyle(canvas).display,
      glCanvasDisplay: getComputedStyle(glCanvas).display,
      renderer: section.dataset.renderer ?? null,
      logoVisibility: getComputedStyle(logo).visibility,
      heroOpacity: getComputedStyle(hero).opacity,
      heroTransform: getComputedStyle(hero).transform,
      inert: [...hero.querySelectorAll("a, button")].filter((el) =>
        el.hasAttribute("inert"),
      ).length,
    };
  });
}

/**
 * Where the logo's particles should be, from the committed target: the mark's
 * points (the four lines' cloud and the dot, every run but the strays), in
 * the logo box's own px. Their outer box is where the particle centres reach
 * (the cloud's width either side of the line included). `LOGO_TOP_LEFT_SHARE`
 * (logo-fit.ts) reads how much more of the mark's top half is left of its
 * middle than right of it (the thumb's side and the fingers: 282 points
 * against 221 on the B3 cloud), which is what tells the hand from its mirror image (the outer
 * box can not: the path is 0.24 units off centre sideways).
 */
const LOGO_TARGET = (() => {
  const targets = parseTargets(
    JSON.parse(
      readFileSync("src/lib/particles/targets.generated.json", "utf8"),
    ),
  );
  const runs = targets.logo.runs.slice(0, -LOGO_SAMPLING.ambient);
  const mark = runs.flatMap((run) =>
    targets.logo.points.slice(run.start, run.start + run.count),
  );
  const xs = mark.map((p) => p.x);
  const ys = mark.map((p) => p.y);
  return {
    box: { width: LOGO_BOX.width, height: LOGO_BOX.height },
    reach: {
      x0: Math.min(...xs),
      y0: Math.min(...ys),
      x1: Math.max(...xs),
      y1: Math.max(...ys),
    },
  };
})();

/**
 * Where the canvas's logo is, against where it should be, in CSS px.
 *
 * - `fit`: per edge, how far the canvas's ink (alpha 120 or more, over the
 *   image's rect) reaches past the target's particle centres, placed as the
 *   stage places them (the image's rect, the box fitted inside it and
 *   centred). Signed, + outwards: a logo drawn smaller, larger or moved shows
 *   as edges that leave `LOGO_EDGE` (logo-fit.ts), each on its own side.
 * - `topLeftShare`: the top half's ink left of the middle over right of it:
 *   a mirror image is under 1.
 * - `edges` (diagnostic only): the ink's box against the static image's ink.
 */
export async function logoInk(page: Page) {
  return page.evaluate((target) => {
    const img = document.querySelector<HTMLImageElement>(".story-logo img")!;
    const layer = document.querySelector<HTMLCanvasElement>(".story-canvas")!;
    // The logo is on whichever canvas draws the particles: the WebGL one (read
    // through the copy `recordStage` keeps of it) or, on the 2D path, the 2D one.
    const webgl =
      document.querySelector<HTMLElement>(".story")!.dataset.renderer ===
      "webgl";
    const canvas = webgl
      ? ((window as unknown as Record<string, unknown>)
          .__glSnapshot as HTMLCanvasElement)
      : layer;
    const rect = img.getBoundingClientRect();
    const box = layer.getBoundingClientRect();
    const scale = canvas.width / box.width;
    type Bounds = { x0: number; y0: number; x1: number; y1: number };
    const bounds = (
      data: Uint8ClampedArray,
      width: number,
      height: number,
      minAlpha: number,
    ): Bounds => {
      const out = { x0: width, y0: height, x1: -1, y1: -1 };
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if ((data[(y * width + x) * 4 + 3] ?? 0) < minAlpha) continue;
          out.x0 = Math.min(out.x0, x);
          out.x1 = Math.max(out.x1, x);
          out.y0 = Math.min(out.y0, y);
          out.y1 = Math.max(out.y1, y);
        }
      }
      return out;
    };

    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    const reference = document.createElement("canvas");
    reference.width = width;
    reference.height = height;
    const referenceContext = reference.getContext("2d")!;
    referenceContext.drawImage(img, 0, 0, width, height);
    const want = bounds(
      referenceContext.getImageData(0, 0, width, height).data,
      width,
      height,
      100,
    );

    const left = Math.round((rect.left - box.left) * scale);
    const top = Math.round((rect.top - box.top) * scale);
    const w = Math.round(rect.width * scale);
    const h = Math.round(rect.height * scale);
    const drawn = canvas.getContext("2d")!.getImageData(left, top, w, h);
    // An alpha of 120 keeps the glow's faint halo out.
    const got = bounds(drawn.data, w, h, 120);
    const edges = {
      left: got.x0 / scale - want.x0,
      top: got.y0 / scale - want.y0,
      right: got.x1 / scale - want.x1,
      bottom: got.y1 / scale - want.y1,
    };

    // The stage's placing of the logo box in the image's rect (logoBox in
    // particle-set.ts: contain, centred), relative to the rect's corner.
    const fitScale = Math.min(
      rect.width / target.box.width,
      rect.height / target.box.height,
    );
    const offsetX = (rect.width - target.box.width * fitScale) / 2;
    const offsetY = (rect.height - target.box.height * fitScale) / 2;
    const at = (x: number, y: number) => ({
      x: offsetX + x * fitScale,
      y: offsetY + y * fitScale,
    });
    const r0 = at(target.reach.x0, target.reach.y0);
    const r1 = at(target.reach.x1, target.reach.y1);
    // The ink's own box in the rect's CSS px: a pixel spans [x, x + 1).
    const ink = {
      x0: got.x0 / scale,
      y0: got.y0 / scale,
      x1: (got.x1 + 1) / scale,
      y1: (got.y1 + 1) / scale,
    };
    const fit = {
      left: r0.x - ink.x0,
      top: r0.y - ink.y0,
      right: ink.x1 - r1.x,
      bottom: ink.y1 - r1.y,
    };

    // The top half's weight, left and right of the middle of the reach.
    const middleX = ((r0.x + r1.x) / 2) * scale;
    const middleY = ((r0.y + r1.y) / 2) * scale;
    let leftWeight = 0;
    let rightWeight = 0;
    for (let y = 0; y < Math.min(h, middleY); y += 1) {
      for (let x = 0; x < w; x += 1) {
        const alpha = drawn.data[(y * w + x) * 4 + 3] ?? 0;
        if (x < middleX) leftWeight += alpha;
        else rightWeight += alpha;
      }
    }
    return {
      fit,
      topLeftShare: rightWeight > 0 ? leftWeight / rightWeight : Infinity,
      edges,
      worst: Math.max(...Object.values(edges).map((d) => Math.abs(d))),
      empty: got.x1 < 0 || want.x1 < 0,
    };
  }, LOGO_TARGET);
}
