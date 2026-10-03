import { expect, test } from "@playwright/test";
import { contrast } from "./fixtures/contrast";
import {
  expectPrintsDark,
  textSamples,
  weakSamples,
} from "./fixtures/print-text";

/**
 * The other pages on paper, with the check the results page gets
 * (results-print.spec.ts, fixtures/print-text.ts): every visible piece of text
 * reaches 4.5:1 on white and on the background behind it. Shared classes such
 * as `.eyebrow` and `.note` (globals.css) carry the dark theme's light grey on
 * screen, and used to print that way.
 */
const PAGES: readonly (readonly [name: string, path: string, ready: RegExp])[] =
  [
    ["home", "/", /Find the mouse that fits/],
    ["how it works", "/how-it-works", /How it works/],
    ["account", "/account", /.+/],
    ["not found", "/no-such-page-xyz", /.+/],
    // The error boundary, reached through a dev-only route that throws.
    ["error screen", "/scan/error-demo", /.+/],
  ];

for (const [name, path, ready] of PAGES) {
  test(`${name} (${path}) prints dark text on white`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(ready);
    await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
    const samples = await textSamples(page, { root: "body" });
    expect(samples.length, `${name}: text found`).toBeGreaterThanOrEqual(3);
    await expectPrintsDark(page, name, { root: "body", minSamples: 2 });
  });
}

// The shared classes in globals.css (#b5b5bd on screen). On /account they appear
// only for a signed-in visitor, which a test cannot be, so they are read where
// they do render: the demo route's controls (.eyebrow, .note).
for (const selector of [".eyebrow", ".note"]) {
  test(`${selector} on /results/demo prints dark on white`, async ({
    page,
  }) => {
    await page.goto("/results/demo");
    await expect(page.locator(selector).first()).toBeVisible();
    await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
    const colours = await page
      .locator(selector)
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).color));
    expect(colours.length, `${selector} found`).toBeGreaterThan(0);
    for (const colour of colours)
      expect(
        contrast(colour, "rgb(255, 255, 255)"),
        `${selector}: ${colour}`,
      ).toBeGreaterThanOrEqual(4.5);
  });
}

// The signed-in account list (AccountView.tsx) cannot be reached either. Its
// markup is put on a page that loads the same stylesheet, so the real cascade
// decides its print colours. Keep the classes in step with AccountView.
test("a signed-in account's scan card prints dark on white", async ({
  page,
}) => {
  await page.goto("/no-such-page-xyz");
  await page.evaluate(() => {
    document.querySelector("main")!.insertAdjacentHTML(
      "beforeend",
      `<ul class="scan-list" id="fake-scans"><li class="scan-card">
        <div class="scan-card-header"><span>4 Oct 2026</span><span>Right hand</span></div>
        <dl class="measurements">
          <div><dt>Hand length</dt><dd>190 mm</dd></div>
        </dl>
      </li></ul>`,
    );
  });
  await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
  const samples = await textSamples(page, { root: "#fake-scans" });
  expect(samples.length).toBeGreaterThanOrEqual(4);
  expect(weakSamples(samples)).toEqual([]);
});
