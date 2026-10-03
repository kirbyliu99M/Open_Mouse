import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  expectPrintsDark,
  textSamples,
  weakSamples,
} from "./fixtures/print-text";

/**
 * The results page on paper. Chrome prints no backgrounds unless the user asks
 * for them, and the page is dark on screen, so every colour that was written
 * for the dark theme (the light grey captions, the near-white button labels,
 * the pale amber note) would print as light text on white. In print the text
 * must be dark on white, and no card may keep its dark fill. The text check
 * itself is in fixtures/print-text.ts.
 */

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
      await expectPrintsDark(page, label, { skip: ".results-demoControls" });
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
