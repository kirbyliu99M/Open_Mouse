import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  contrast,
  glyphAndBackOverWhiteLayers,
  type Layer,
  type Rgba,
} from "./fixtures/contrast";

/**
 * The results page on paper. Chrome prints no backgrounds unless the user asks
 * for them, and the page is dark on screen, so every colour that was written
 * for the dark theme (the light grey captions, the near-white button labels,
 * the pale amber note) would print as light text on white. In print the text
 * must be dark on white, and no card may keep its dark fill.
 *
 * Two things are checked, for every piece of visible text: its contrast against
 * white (what a printer without "background graphics" produces), and against
 * the background actually behind it in the print layout (what it produces
 * with them on). Both must reach 4.5:1. No assertion depends on a font.
 */

const WHITE = "rgb(255, 255, 255)";
const MIN_CONTRAST = 4.5;
/** The check must find real text, not pass over an empty page. */
const MIN_SAMPLES = 20;

interface Sample {
  readonly text: string;
  readonly where: string;
  readonly color: Rgba;
  readonly layers: readonly Layer[];
}

/**
 * Every visible text node's colour and the chain of fills and opacities from
 * the page down to it. `skip` is a selector for a subtree left out (the demo's
 * developer controls, which are never printed from production).
 */
async function textSamples(page: Page, skip?: string): Promise<Sample[]> {
  return page.evaluate((skipSelector) => {
    const rgba = (value: string): [number, number, number, number] => {
      const n = (value.match(/[\d.]+/g) ?? []).map(Number);
      return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
    };
    const describe = (el: Element) =>
      el.tagName.toLowerCase() +
      (el.className && typeof el.className === "string"
        ? "." + el.className.trim().split(/\s+/).join(".")
        : "");
    const found: {
      text: string;
      where: string;
      color: [number, number, number, number];
      layers: {
        fill: [number, number, number, number] | null;
        opacity: number;
      }[];
    }[] = [];
    const root = document.querySelector("main") ?? document.body;
    for (const el of [root, ...root.querySelectorAll("*")]) {
      if (skipSelector && el.closest(skipSelector)) continue;
      if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
      const own = [...el.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join(" ")
        .trim();
      if (!own) continue;
      const style = getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        el.getClientRects().length === 0
      )
        continue;
      const layers: {
        fill: [number, number, number, number] | null;
        opacity: number;
      }[] = [];
      const chain: Element[] = [];
      for (let node: Element | null = el; node; node = node.parentElement)
        chain.unshift(node);
      for (const node of chain) {
        const s = getComputedStyle(node);
        const fill = rgba(s.backgroundColor);
        layers.push({
          fill: fill[3] === 0 ? null : fill,
          opacity: Number(s.opacity),
        });
      }
      found.push({
        text: own.slice(0, 48),
        where: describe(el),
        color: rgba(style.color),
        layers,
      });
    }
    return found;
  }, skip ?? null);
}

/** Every text sample that does not reach 4.5:1 on white or on its own backing. */
function weakSamples(samples: readonly Sample[]): string[] {
  const weak: string[] = [];
  for (const { text, where, color, layers } of samples) {
    const { glyph, back } = glyphAndBackOverWhiteLayers(color, layers);
    const onWhite = contrast(glyph, WHITE);
    const onBacking = contrast(glyph, back);
    if (onWhite < MIN_CONTRAST || onBacking < MIN_CONTRAST)
      weak.push(
        `${where} "${text}": ${onWhite.toFixed(2)}:1 on white, ${onBacking.toFixed(2)}:1 on its backing`,
      );
  }
  return weak;
}

async function expectPrintsDark(page: Page, label: string, skip?: string) {
  const samples = await textSamples(page, skip);
  expect(samples.length, `${label}: text found`).toBeGreaterThan(MIN_SAMPLES);
  expect(weakSamples(samples), label).toEqual([]);
}

/** The two cards carry a dark fill on screen; on paper they have none. */
async function expectCardsUnfilled(page: Page, label: string) {
  const fills = await page.evaluate(() =>
    [".results-topPick", ".results-analysis"].flatMap((selector) =>
      [...document.querySelectorAll(selector)].map((el) => [
        selector,
        getComputedStyle(el).backgroundColor,
      ]),
    ),
  );
  expect(fills.length, `${label}: cards found`).toBeGreaterThan(0);
  for (const [selector, fill] of fills)
    expect(fill, `${label}: ${selector} has no fill`).toBe("rgba(0, 0, 0, 0)");
}

const ANALYSIS_BUTTONS = [
  "None",
  "Loading",
  "Rate limited",
  "Error",
  "Ready",
  "Ready (written from scores)",
] as const;
const FIXTURE_BUTTONS = [
  "High confidence",
  "Low confidence (nulls)",
  "With exclusions",
] as const;

test("/results/demo prints dark text on white in every fixture and every analysis state", async ({
  page,
}) => {
  await page.goto("/results/demo");
  await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
  for (const fixture of FIXTURE_BUTTONS) {
    await page.getByRole("button", { name: fixture, exact: true }).click();
    // The two disclosures hold the ranked mice, their confidence notes and the
    // excluded list; open them so their text is on the page too.
    const closed = page.locator(
      ".results-rankedList-toggle[aria-expanded='false']",
    );
    while ((await closed.count()) > 0) await closed.first().click();
    for (const analysis of ANALYSIS_BUTTONS) {
      await page.getByRole("button", { name: analysis, exact: true }).click();
      const label = `${fixture} / ${analysis}`;
      await expectPrintsDark(page, label, ".results-demoControls");
      await expectCardsUnfilled(page, label);
    }
  }
});

// The real route: the notices after the top pick, the delete action (a
// button, in its own colours) and the page-level states.
const SCAN_ID = "a1b2c3d4-1111-4a2b-8c3d-9e0f1a2b3c4d";
const FIT_URL = `**/api/scans/${SCAN_ID}/fit`;
const ANALYSIS_URL = `**/api/scans/${SCAN_ID}/analysis`;
const LENGTH_KEY = `open-mouse:user-length:${SCAN_ID}`;

const highConfidenceFixture: object = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../src/components/results/fixtures/high-confidence.json",
        import.meta.url,
      ),
    ),
    "utf-8",
  ),
);

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test("/results/[scanId] prints dark text on white: notices, analysis, delete action", async ({
  page,
}) => {
  await page.route(FIT_URL, (route) =>
    fulfillJson(route, 200, { ...highConfidenceFixture, hand: "left" }),
  );
  await page.route(ANALYSIS_URL, (route) =>
    fulfillJson(route, 200, {
      output: {
        headline: "A close match for your palm grip",
        whyTopPick:
          "The top pick's length and grip width both land close to your ideal.",
        tradeoffs: ["It runs slightly heavier than you prefer."],
        whatToAvoid: ["Mice with an aggressive back hump."],
        caveats: ["Early preview · measurements still being validated."],
      },
      source: "fallback",
      cached: false,
    }),
  );
  await page.addInitScript(
    ([key]) => localStorage.setItem(key, "190"),
    [LENGTH_KEY],
  );
  await page.goto(`/results/${SCAN_ID}`);
  await expect(page.locator(".results-analysis-ready")).toBeVisible();
  await expect(page.locator(".results-handNotice")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Delete this scan now" }),
  ).toBeVisible();
  await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
  await expectPrintsDark(page, "ready");
  await expectCardsUnfilled(page, "ready");
});

test("/results/[scanId] prints dark text on white while the results load", async ({
  page,
}) => {
  // The fit request never answers.
  await page.route(FIT_URL, () => {});
  await page.goto(`/results/${SCAN_ID}`);
  await expect(page.locator(".results-page-status")).toBeVisible();
  await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
  const samples = await textSamples(page);
  expect(samples.length, "loading: text found").toBeGreaterThan(0);
  expect(weakSamples(samples), "loading").toEqual([]);
});

test("/results/[scanId] prints dark text on white when the scan is gone", async ({
  page,
}) => {
  // The card with the one action that fixes it.
  await page.route(FIT_URL, (route) =>
    fulfillJson(route, 404, { error: "Not found" }),
  );
  await page.goto(`/results/${SCAN_ID}`);
  await expect(page.locator(".results-page-error")).toBeVisible();
  await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
  const samples = await textSamples(page);
  expect(samples.length, "not found: text found").toBeGreaterThan(0);
  expect(weakSamples(samples), "not found").toEqual([]);
  // The action is a dark label with an outline, not a blue fill that would
  // print as white on white.
  const action = await page.evaluate(() => {
    const style = getComputedStyle(
      document.querySelector(".results-page-action")!,
    );
    return { background: style.backgroundColor, border: style.borderTopWidth };
  });
  expect(action).toEqual({ background: "rgba(0, 0, 0, 0)", border: "1px" });
});
