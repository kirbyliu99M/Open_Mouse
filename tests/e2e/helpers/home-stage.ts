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

    const proto = CanvasRenderingContext2D.prototype;
    const clear = proto.clearRect;
    proto.clearRect = function (...args: Parameters<typeof clear>) {
      if (this.canvas.classList.contains("story-canvas")) {
        (w.__draws as number[]).push(performance.now());
      }
      return clear.apply(this, args);
    };

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
