import { expect, type Page } from "@playwright/test";

/**
 * Shared by the home page's particle-stage specs (Home v3, PR B): the story's
 * scroll helpers, and an init script that records what the page does while it
 * switches to the animated layout. The page publishes three diagnostics on
 * purpose: `data-progress` and `data-story` on the section, and `data-draws`
 * and `data-particles` on the canvas.
 */

export const STORY = ".story";
export const CANVAS = ".story-canvas";
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
 */
export async function recordStage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__draws = [] as number[];
    w.__raf = 0;
    w.__events = [] as string[];
    w.__frames = [] as { logo: boolean; canvas: boolean; drawn: number }[];
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
        (w.__frames as unknown[]).push({
          logo: getComputedStyle(logo).visibility !== "hidden",
          canvas: getComputedStyle(canvas).display !== "none",
          drawn: Number(canvas.getAttribute("data-draws") ?? 0),
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
      note: box('[data-testid="home-hero"] .landing-preview-note'),
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
 * How far the canvas's logo is from the static logo's drawing, in CSS px: the
 * bounding box of the opaque pixels of the SVG (drawn at the `<img>`'s own rect)
 * against the bounding box of the canvas's pixels over that same rect. The
 * canvas draws the logo where the image is (it reads the image's rect, never a
 * fixed size), so each of the four edges is within a pixel or two: sampling
 * puts a particle just inside the stroke. A canvas that drew the logo at a
 * stale or hard-coded place or size would be off by tens of px.
 */
export async function logoInk(page: Page) {
  return page.evaluate(() => {
    const img = document.querySelector<HTMLImageElement>(".story-logo img")!;
    const canvas = document.querySelector<HTMLCanvasElement>(".story-canvas")!;
    const rect = img.getBoundingClientRect();
    const box = canvas.getBoundingClientRect();
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
    // An alpha of 120 keeps the glow's faint halo out and the dotted ruler in.
    const got = bounds(drawn.data, w, h, 120);
    const edges = {
      left: got.x0 / scale - want.x0,
      top: got.y0 / scale - want.y0,
      right: got.x1 / scale - want.x1,
      bottom: got.y1 / scale - want.y1,
    };
    return {
      edges,
      worst: Math.max(...Object.values(edges).map((d) => Math.abs(d))),
      empty: got.x1 < 0 || want.x1 < 0,
    };
  });
}
