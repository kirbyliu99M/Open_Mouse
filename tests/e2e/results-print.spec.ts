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

/**
 * The photo box and the written-analysis card carry a fill on screen; on paper
 * they have none. The glow behind the page is not printed either.
 */
async function expectCardsUnfilled(page: Page, label: string) {
  const glow = await page.evaluate(
    () => getComputedStyle(document.querySelector(".results-glow")!).display,
  );
  expect(glow, `${label}: the glow is not printed`).toBe("none");
  const fills = await page.evaluate(() =>
    [".results-photo", ".results-analysis"].flatMap((selector) =>
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
  "Many mice + hand type",
] as const;

test("/results/demo prints dark text on white in every fixture and every analysis state", async ({
  page,
}) => {
  await page.goto("/results/demo");
  await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
  for (const fixture of FIXTURE_BUTTONS) {
    await page.getByRole("button", { name: fixture, exact: true }).click();
    // The two disclosures hold the scores, the analysis, the other mice and the
    // excluded list; open them so their text is on the page too.
    const closed = page.locator(".results-disclosure:not([open]) > summary");
    while ((await closed.count()) > 0) await closed.first().click();
    for (const analysis of ANALYSIS_BUTTONS) {
      await page.getByRole("button", { name: analysis, exact: true }).click();
      const label = `${fixture} / ${analysis}`;
      await expectPrintsDark(page, label, { skip: ".results-demoControls" });
      await expectCardsUnfilled(page, label);
    }
  }
});

test("/results/demo prints the contents of Details and Other mice even though they are closed", async ({
  page,
}) => {
  await page.goto("/results/demo");
  await page.getByRole("button", { name: "Many mice + hand type" }).click();
  await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
  // Nothing is opened by hand: both disclosures are closed on screen.
  await expect(page.locator(".results-disclosure[open]")).toHaveCount(0);
  const scores = page.locator(".results-details .results-subscoreBar");
  await expect(scores).toHaveCount(6);
  for (let i = 0; i < 6; i++) await expect(scores.nth(i)).toBeVisible();
  await expect(
    page.locator(".results-details .results-targetDeltas"),
  ).toBeVisible();
  const rows = page.locator(".results-otherMice-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toBeVisible();
  await expect(page.locator(".results-excluded-list")).toBeVisible();
  // And still dark on white.
  await expectPrintsDark(page, "closed disclosures, printed", {
    skip: ".results-demoControls",
  });
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
  await page.locator(".results-details > summary").click();
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

test("/results/[scanId] leaves the open delete confirmation off the printed page", async ({
  page,
}) => {
  await page.route(FIT_URL, (route) =>
    fulfillJson(route, 200, highConfidenceFixture),
  );
  await page.route(ANALYSIS_URL, (route) =>
    fulfillJson(route, 500, { error: "Unavailable" }),
  );
  await page.goto(`/results/${SCAN_ID}`);
  await page.getByRole("button", { name: "Delete this scan now" }).click();
  const dialog = page.getByRole("alertdialog", {
    name: "Delete this scan now?",
  });
  await expect(dialog).toBeVisible();
  // On screen it is a light-on-dark modal (#f5f5f7 on #1d1d1f); printed as it
  // stands, its text would be 1.09:1 on white. A confirmation is a question to
  // answer on screen, not something to keep on paper, so it is not printed.
  await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
  const display = await page.evaluate(() => ({
    backdrop: getComputedStyle(document.querySelector(".dialog-backdrop")!)
      .display,
    dialog: getComputedStyle(document.querySelector(".dialog")!).display,
  }));
  expect(display).toEqual({ backdrop: "none", dialog: "none" });
  // The page behind it still prints, dark on white.
  await expectPrintsDark(page, "ready, with the confirmation open");
});
