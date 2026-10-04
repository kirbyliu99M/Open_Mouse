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

// The signed-in account page (AccountView.tsx) cannot be reached either. Its
// markup is put on a page that loads the same stylesheets, so the real cascade
// decides its print colours. Keep the classes in step with AccountView.
const FAKE_ACCOUNT = `<section id="fake-account">
  <div class="account-actions">
    <button type="button" class="button-secondary">Export as JSON</button>
    <button type="button" class="button-danger">Delete everything</button>
  </div>
  <p class="status-error" role="status">Couldn't export: check your connection and try again.</p>
  <ul class="scan-list"><li class="scan-card">
    <div class="scan-card-header"><span>4 Oct 2026</span><span>Right hand</span></div>
    <dl class="measurements">
      <div><dt>Hand length</dt><dd>190 mm</dd></div>
    </dl>
  </li></ul>
</section>`;

test("a signed-in account's actions, error line and scan card print dark on white", async ({
  page,
}) => {
  await page.goto("/no-such-page-xyz");
  await page.evaluate((html) => {
    document.querySelector("main")!.insertAdjacentHTML("beforeend", html);
  }, FAKE_ACCOUNT);
  await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
  const samples = await textSamples(page, { root: "#fake-account" });
  expect(samples.length).toBeGreaterThanOrEqual(7);
  expect(weakSamples(samples)).toEqual([]);
});

test("a signed-in account's open 'Delete everything?' dialog is left off the printed page", async ({
  page,
}) => {
  await page.goto("/no-such-page-xyz");
  await page.evaluate((html) => {
    document.querySelector("main")!.insertAdjacentHTML(
      "beforeend",
      `${html}<dialog class="dialog" id="fake-dialog" open>
        <h2>Delete everything?</h2>
        <p>This permanently deletes all 1 of your scans. This can't be undone.</p>
        <p class="status-error" role="status">Couldn't delete: try again.</p>
        <div class="dialog-actions">
          <button type="button" class="button-secondary">Cancel</button>
          <button type="button" class="button-danger">Delete everything</button>
        </div>
      </dialog>`,
    );
  }, FAKE_ACCOUNT);
  await expect(page.locator("#fake-dialog")).toBeVisible();
  await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
  // Light-on-dark on screen (1.09:1 on white as it stands): a question to
  // answer on screen, not something to keep on paper.
  expect(
    await page
      .locator("#fake-dialog")
      .evaluate((el) => getComputedStyle(el).display),
  ).toBe("none");
  const samples = await textSamples(page, { root: "body" });
  expect(weakSamples(samples)).toEqual([]);
});
