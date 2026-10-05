import { expect, test, type Page } from "@playwright/test";
import {
  HOME_STORY_COPY,
  HOME_STORY_NOTE_KEYS,
} from "../../src/lib/copy/home-story";
import { OUTLINE_PALM } from "../../src/lib/particles/hand-outline";
import {
  A4_MM,
  HAND_MARGIN_MM,
  STAGE_SCALE,
} from "../../src/lib/particles/template-hand";
import { contrast } from "./fixtures/contrast";
import {
  CANVAS,
  HERO,
  STORY,
  read,
  recordStage,
  scrollToProgress,
  waitForAnimated,
} from "./helpers/home-stage";

/**
 * Home v3.1: the five annotations on the hand (the Pencil demo of 2026-10-05).
 * Real text in the DOM, faded in one at a time while the hand is measured
 * (p = 0.40 to 0.60), with rings, an emphasised line and a leader drawn on the
 * canvas. The static layout, reduced motion and no JS show the same five blocks
 * as an ordinary list. Wording is candidate (未拍板); these tests read it from
 * src/lib/copy/home-story.ts and never repeat it.
 */

const COPY = HOME_STORY_COPY.en;
const TITLES = HOME_STORY_NOTE_KEYS.map((key) => COPY[key].title);
const WHYS = HOME_STORY_NOTE_KEYS.map((key) => COPY[key].why);

/** The middle of each note's window: it is whole there, and the others are hidden. */
const MIDDLES = [0.42, 0.46, 0.5, 0.54, 0.58] as const;

const NOTES = ".story-note";

// The desktop project's default window is 1280x720: the animated tests run at
// 1280x800 unless a test sets its own size, as home-stage.spec.ts does.
test.beforeEach(async ({ page }, info) => {
  if (info.project.name === "chromium") {
    await page.setViewportSize({ width: 1280, height: 800 });
  }
});

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** The hand's image, its A4 sheet and the five text blocks, in viewport px. */
async function boxes(page: Page) {
  return page.evaluate(
    ({ notes }) => {
      const box = (el: Element): Box => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      };
      return {
        hand: box(document.querySelector(".story-hand img")!),
        sheet: box(document.querySelector(".story-hand-sheet")!),
        notes: [...document.querySelectorAll(notes)].map(box),
        width: window.innerWidth,
        height: window.innerHeight,
      };
    },
    { notes: NOTES },
  );
}

/** Where the outline's wrist base ends, in viewport px: the stage's own transform read off the hidden image. */
function wristBottom(hand: Box): number {
  const viewBoxWidth =
    (A4_MM.width + HAND_MARGIN_MM.left + HAND_MARGIN_MM.right) * STAGE_SCALE;
  const k = hand.width / viewBoxWidth;
  return (
    hand.top +
    (HAND_MARGIN_MM.top + 246 + OUTLINE_PALM.width / 2) * STAGE_SCALE * k
  );
}

const opacities = (page: Page) =>
  page
    .locator(NOTES)
    .evaluateAll((els) =>
      els.map((el) => Number(getComputedStyle(el).opacity)),
    );

test.describe("the annotations on the animated page", () => {
  test("are real text in reading order, between the hand and the mice, and stay in the accessibility tree", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    const notes = page.locator(NOTES);
    await expect(notes).toHaveCount(5);
    // The copy file's words, in its order: a large line and a small one each.
    for (let i = 0; i < 5; i += 1) {
      await expect(notes.nth(i).locator(".story-note-title")).toHaveText(
        TITLES[i]!,
      );
      await expect(notes.nth(i).locator(".story-note-why")).toHaveText(
        WHYS[i]!,
      );
    }
    // No number anywhere in them.
    const text = (await page.locator(".story-notes").textContent()) ?? "";
    expect(text).not.toMatch(/\d/);
    // After the hand, before the mice, canvas last and still decorative.
    const order = await page.evaluate(() =>
      [...document.querySelector(".story-panel")!.children].map(
        (el) => el.className,
      ),
    );
    expect(order).toEqual([
      "story-hero",
      "story-hand",
      "story-notes",
      "story-mice",
      "story-canvas",
    ]);
    await expect(page.locator(CANVAS)).toHaveAttribute("aria-hidden", "true");
    // A hidden note is only transparent: never display:none or visibility:hidden,
    // so it is in the accessibility tree whatever p is.
    for (const p of [0, 0.3, 0.5, 0.8, 1]) {
      await scrollToProgress(page, p);
      const states = await notes.evaluateAll((els) =>
        els.map((el) => {
          const style = getComputedStyle(el);
          return [style.display, style.visibility, el.hasAttribute("inert")];
        }),
      );
      for (const [display, visibility, inert] of states) {
        expect(display, `p=${p}`).not.toBe("none");
        expect(visibility, `p=${p}`).toBe("visible");
        expect(inert, `p=${p}`).toBe(false);
      }
    }
    // A screen reader reads them in order: the list's items are the five.
    const items = page.getByRole("listitem").filter({ hasText: TITLES[0]! });
    await expect(items).toHaveCount(1);
  });

  test("show one at a time, each in its own window, and none before 0.40 or after 0.60", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    // The middle of each window: its note whole, the other four hidden.
    for (const [i, p] of MIDDLES.entries()) {
      await scrollToProgress(page, p);
      const want = [0, 0, 0, 0, 0];
      want[i] = 1;
      expect(await opacities(page), `p=${p}`).toEqual(want);
    }
    // Outside the windows nothing shows.
    for (const p of [0, 0.1, 0.3, 0.38, 0.62, 0.7, 0.9, 1]) {
      await scrollToProgress(page, p);
      expect(await opacities(page), `p=${p}`).toEqual([0, 0, 0, 0, 0]);
    }
    // And across the whole range, never two at once, and in order as p rises.
    let last = -1;
    for (let p = 0.39; p <= 0.61; p += 0.005) {
      await scrollToProgress(page, p);
      const shown = (await opacities(page)).flatMap((o, i) =>
        o > 0 ? [i] : [],
      );
      expect(shown.length, `p=${p.toFixed(3)}`).toBeLessThanOrEqual(1);
      if (shown[0] !== undefined) {
        expect(shown[0]).toBeGreaterThanOrEqual(last);
        last = shown[0];
      }
    }
    expect(last).toBe(4);
    // Scrolling back restores them.
    await scrollToProgress(page, 0.46);
    expect(await opacities(page)).toEqual([0, 1, 0, 0, 0]);
  });

  test("move only by opacity and transform: where a block is and how wide stays put through the whole story", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    const where = () =>
      page.locator(NOTES).evaluateAll((els) =>
        els.map((el) => {
          const style = getComputedStyle(el);
          return {
            left: style.left,
            top: style.top,
            width: style.width,
            position: style.position,
            pointerEvents: style.pointerEvents,
          };
        }),
      );
    await scrollToProgress(page, 0.3);
    const before = await where();
    for (const p of [0.41, 0.46, 0.5, 0.54, 0.58, 0.8]) {
      await scrollToProgress(page, p);
      expect(await where(), `p=${p}`).toEqual(before);
    }
    for (const note of before) {
      expect(note.position).toBe("absolute");
      expect(note.pointerEvents).toBe("none");
    }
    // In a fade, the transform is the only other thing that moves: a small rise.
    await scrollToProgress(page, 0.405);
    const fading = await page
      .locator(NOTES)
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return { opacity: Number(style.opacity), transform: style.transform };
      });
    expect(fading.opacity).toBeGreaterThan(0);
    expect(fading.opacity).toBeLessThan(1);
    expect(fading.transform).not.toBe("none");
  });

  for (const [width, height] of [
    [375, 667],
    [390, 844],
  ] as const) {
    test(`${width}x${height}: the text sits below the hand, as wide as its image, clear of the wrist and inside the viewport`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await waitForAnimated(page);
      for (const [i, p] of MIDDLES.entries()) {
        await scrollToProgress(page, p);
        const { hand, notes, width: w, height: h } = await boxes(page);
        const note = notes[i]!;
        expect(
          Math.abs(note.left - hand.left),
          `note ${i + 1} left`,
        ).toBeLessThan(1);
        expect(Math.abs(note.width - hand.width)).toBeLessThan(1);
        expect(
          note.top,
          `note ${i + 1} below the wrist`,
        ).toBeGreaterThanOrEqual(wristBottom(hand) + 10);
        expect(note.top).toBeGreaterThanOrEqual(hand.bottom - 1);
        expect(note.bottom, `note ${i + 1} in view`).toBeLessThanOrEqual(h - 8);
        expect(note.right).toBeLessThanOrEqual(w);
        // The five blocks share one row, whatever their heights.
        expect(Math.abs(note.top - notes[0]!.top)).toBeLessThan(1);
      }
    });
  }

  for (const [width, height] of [
    [1440, 900],
    [1440, 740],
  ] as const) {
    test(`${width}x${height}: the text sits beside the hand, the thumb's on its left, all inside the viewport and clear of the hand`, async ({
      page,
    }, info) => {
      test.skip(info.project.name !== "chromium", "A desktop window.");
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await waitForAnimated(page);
      for (const [i, p] of MIDDLES.entries()) {
        await scrollToProgress(page, p);
        const { hand, notes, width: w, height: h } = await boxes(page);
        const note = notes[i]!;
        if (i < 4) {
          expect(
            note.left,
            `note ${i + 1} at the right`,
          ).toBeGreaterThanOrEqual(hand.right + 20);
          expect(note.right).toBeLessThanOrEqual(w - 16);
        } else {
          expect(
            note.right,
            "the thumb's note at the left",
          ).toBeLessThanOrEqual(hand.left - 20);
          expect(note.left).toBeGreaterThanOrEqual(16);
          expect(
            await page
              .locator(NOTES)
              .nth(4)
              .evaluate((el) => getComputedStyle(el).textAlign),
          ).toBe("right");
        }
        expect(note.top).toBeGreaterThanOrEqual(0);
        expect(note.bottom).toBeLessThanOrEqual(h);
      }
    });
  }

  test("follow a resize: beside the hand while there is room at both its sides, below it when there is not", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "chromium", "A desktop window.");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await waitForAnimated(page);
    await scrollToProgress(page, 0.5);
    let { hand, notes } = await boxes(page);
    expect(notes[2]!.left).toBeGreaterThanOrEqual(hand.right + 20);

    // Narrower: the hand shrinks with the window, there is no room at its
    // sides, and the text goes below it, as wide as the image.
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect
      .poll(async () => {
        const b = await boxes(page);
        return Math.abs(b.notes[2]!.left - b.hand.left) < 1;
      })
      .toBe(true);
    ({ hand, notes } = await boxes(page));
    expect(Math.abs(notes[2]!.width - hand.width)).toBeLessThan(1);
    expect(notes[2]!.top).toBeGreaterThanOrEqual(wristBottom(hand) + 10);

    // And back to a wide window.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect
      .poll(async () => {
        const b = await boxes(page);
        return b.notes[2]!.left >= b.hand.right + 20;
      })
      .toBe(true);
  });

  test("have text contrast of at least 4.5:1 on the page background, and no glow behind them", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    const bg = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );
    for (const [i, p] of MIDDLES.entries()) {
      await scrollToProgress(page, p);
      const colours = await page
        .locator(NOTES)
        .nth(i)
        .evaluate((el) => ({
          title: getComputedStyle(el.querySelector(".story-note-title")!).color,
          why: getComputedStyle(el.querySelector(".story-note-why")!).color,
          opacity: Number(getComputedStyle(el).opacity),
          background: getComputedStyle(el).backgroundColor,
        }));
      expect(colours.opacity).toBe(1);
      // No fill of their own, and nothing of --glow under them: the text sits on the page.
      expect(colours.background).toBe("rgba(0, 0, 0, 0)");
      expect(
        contrast(colours.title, bg),
        `note ${i + 1} title`,
      ).toBeGreaterThan(4.5);
      expect(
        contrast(colours.why, bg),
        `note ${i + 1} small line`,
      ).toBeGreaterThan(4.5);
    }
    // The key light is behind the logo only, and the hero has faded out by now.
    await scrollToProgress(page, 0.5);
    const hero = page.locator(HERO);
    await expect(hero).toHaveCSS("opacity", "0");
  });
});

test.describe("the hand's outline", () => {
  test("is drawn once for each size of hand, not once per frame, and it is there while the hand is measured", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "chromium", "One project is enough.");
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__offscreen = 0;
      const Original = window.OffscreenCanvas;
      if (!Original) return;
      window.OffscreenCanvas = class extends Original {
        constructor(width: number, height: number) {
          super(width, height);
          (w.__offscreen as number) += 1;
        }
      } as unknown as typeof OffscreenCanvas;
    });
    await recordStage(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await waitForAnimated(page);
    const activatedAt = await read<number>(page, "__activatedAt");
    await page.waitForFunction(
      (start) => performance.now() - start > 3400,
      activatedAt,
    );
    const built = await read<number>(page, "__offscreen");
    // The sprites and the outline's two layers: made, and no more.
    expect(built).toBeGreaterThan(0);
    // Drawing: a few hundred frames across the whole story make no more.
    for (let p = 0.3; p <= 0.7; p += 0.01) await scrollToProgress(page, p);
    expect(await read<number>(page, "__offscreen")).toBe(built);
    // A new size of hand makes it again, once.
    await page.setViewportSize({ width: 1300, height: 760 });
    await expect
      .poll(() => read<number>(page, "__offscreen"))
      .toBeGreaterThan(built);
    const resized = await read<number>(page, "__offscreen");
    for (let p = 0.4; p <= 0.6; p += 0.02) await scrollToProgress(page, p);
    expect(await read<number>(page, "__offscreen")).toBe(resized);
  });

  /** The strongest pixel in a small window of the canvas, in device px. */
  async function strongest(
    page: Page,
    centre: { x: number; y: number },
    half: { x: number; y: number },
  ) {
    return page.evaluate(
      ({ centre, half }) => {
        const canvas =
          document.querySelector<HTMLCanvasElement>(".story-canvas")!;
        const scale = canvas.width / canvas.getBoundingClientRect().width;
        const x0 = Math.round((centre.x - half.x) * scale);
        const y0 = Math.round((centre.y - half.y) * scale);
        const w = Math.round(2 * half.x * scale);
        const h = Math.round(2 * half.y * scale);
        const data = canvas.getContext("2d")!.getImageData(x0, y0, w, h).data;
        let best = [0, 0, 0, 0];
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3]! > best[3]!) {
            best = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
          }
        }
        return best;
      },
      { centre, half },
    );
  }

  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    test(`${width}x${height}: closes the wrist with a flat base in #5F86C9: an edge pixel under the wrist once the skeleton is drawn, and none before`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await waitForAnimated(page);
      const { hand } = await boxes(page);
      const canvas = await page.locator(CANVAS).boundingBox();
      const viewBoxWidth =
        (A4_MM.width + HAND_MARGIN_MM.left + HAND_MARGIN_MM.right) *
        STAGE_SCALE;
      const k = hand.width / viewBoxWidth;
      // The base's lowest edge, at the wrist's centre, in canvas px.
      const centre = {
        x:
          hand.left - canvas!.x + (HAND_MARGIN_MM.left + 115) * STAGE_SCALE * k,
        y: wristBottom(hand) - canvas!.y,
      };
      const half = { x: 6, y: 3 };

      // The hand has formed (p = 0.41) but the skeleton has not started: no outline yet.
      await scrollToProgress(page, 0.41);
      expect((await strongest(page, centre, half))[3]).toBeLessThan(10);

      // With the skeleton (p = 0.5, 0.54): the edge, in #5F86C9 at the
      // skeleton's 0.9 (an edge 1 px thick covers a pixel only in part).
      for (const p of [0.5, 0.54]) {
        await scrollToProgress(page, p);
        const [r, g, b, a] = await strongest(page, centre, half);
        expect(a, `p=${p} alpha`).toBeGreaterThan(60);
        expect(Math.abs(r - 0x5f), `p=${p} red`).toBeLessThan(25);
        expect(Math.abs(g - 0x86), `p=${p} green`).toBeLessThan(25);
        expect(Math.abs(b - 0xc9), `p=${p} blue`).toBeLessThan(25);
      }
      // Quieter than the landmarks: the edge is not white.
      const [r] = await strongest(page, centre, half);
      expect(r).toBeLessThan(160);
    });
  }
});

test.describe("the same five blocks as a list, where the stage is off", () => {
  async function expectList(page: Page) {
    const notes = page.locator(NOTES);
    await expect(notes).toHaveCount(5);
    for (let i = 0; i < 5; i += 1) {
      await expect(notes.nth(i)).toBeVisible();
      await expect(notes.nth(i).locator(".story-note-title")).toHaveText(
        TITLES[i]!,
      );
      await expect(notes.nth(i).locator(".story-note-why")).toHaveText(
        WHYS[i]!,
      );
    }
    // An ordinary list in the flow: not laid over anything, whole, in order,
    // between the hand and the three mice.
    const facts = await page.evaluate(() => {
      const items = [...document.querySelectorAll(".story-note")];
      const rects = items.map((el) => el.getBoundingClientRect());
      const hand = document
        .querySelector(".story-hand")!
        .getBoundingClientRect();
      const mice = document
        .querySelector(".story-mice")!
        .getBoundingClientRect();
      return {
        styles: items.map((el) => {
          const style = getComputedStyle(el);
          return [style.position, style.opacity, style.transform, style.left];
        }),
        inOrder: rects.every(
          (r, i) => i === 0 || r.top >= rects[i - 1]!.bottom,
        ),
        afterHand: rects[0]!.top >= hand.bottom - 1,
        beforeMice: rects[4]!.bottom <= mice.top + 1,
        scrollFits: document.documentElement.scrollWidth <= window.innerWidth,
      };
    });
    for (const [position, opacity, transform, left] of facts.styles) {
      expect(position).toBe("static");
      expect(opacity).toBe("1");
      expect(transform).toBe("none");
      expect(left).toBe("auto");
    }
    expect(facts).toMatchObject({
      inOrder: true,
      afterHand: true,
      beforeMice: true,
      scrollFits: true,
    });
    // No ring and no leader: the canvas is not shown.
    await expect(page.locator(CANVAS)).toHaveCSS("display", "none");
  }

  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("the list is there, whole, and nothing animates", async ({ page }) => {
      await page.goto("/");
      await page.waitForTimeout(2500);
      await expect(page.locator(STORY)).not.toHaveClass(/story--animated/);
      await expectList(page);
    });
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    test("the list is there, whole", async ({ page }) => {
      await page.goto("/");
      await expectList(page);
    });
  });

  test("if the particle module fails to load, the list is there, whole", async ({
    page,
  }) => {
    await page.route(/particle-stage/, (route) => route.abort());
    await page.goto("/");
    await page.waitForTimeout(3000);
    await expect(page.locator(STORY)).not.toHaveClass(/story--animated/);
    await expectList(page);
  });

  for (const [width, height, label] of [
    [390, 599, "390x599, a pixel short of 600"],
    [320, 568, "320x568"],
    [844, 390, "a phone in landscape"],
  ] as const) {
    test(`${label}: the list is there, whole`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await page.waitForTimeout(2500);
      await expect(page.locator(STORY)).not.toHaveClass(/story--animated/);
      await expectList(page);
    });
  }

  test("the list goes back when the stage is switched off mid-story, with nothing of the stage left on it", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForAnimated(page);
    await scrollToProgress(page, 0.46);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(STORY)).not.toHaveClass(/story--animated/, {
      timeout: 10_000,
    });
    // No inline style from the stage remains: it is the static list again.
    const inline = await page
      .locator(NOTES)
      .evaluateAll((els) => els.map((el) => el.getAttribute("style")));
    for (const style of inline) expect(style ?? "").toBe("");
    await expectList(page);
  });
});
