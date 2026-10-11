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

// The signed-in profile page (AccountView.tsx) cannot be reached either. Its
// markup is put on a page that loads the same stylesheets, so the real cascade
// decides its print colours. Keep the classes in step with AccountView.
const FAKE_ACCOUNT = `<section id="fake-account" class="profile">
  <div class="profile-person">
    <p class="profile-name">Ada</p>
    <p class="profile-email">ada@example.test</p>
  </div>
  <section class="profile-section">
    <div class="profile-section-head">
      <h2>My hand</h2><span class="profile-section-aside">Latest, Oct 4</span>
    </div>
    <dl class="profile-rows profile-facts">
      <div class="profile-row"><dt class="profile-row-label">Hand length</dt><dd class="profile-fact">19.0 cm</dd></div>
    </dl>
  </section>
  <section class="profile-section">
    <div class="profile-section-head"><h2>My mice</h2></div>
    <ul class="profile-rows"><li>
      <div class="profile-row profile-mouse"><span class="profile-mouse-text">
        <span class="profile-mouse-name">Razer DeathAdder V3</span>
        <span class="profile-mouse-meta"><span class="profile-current">In use now</span> · Satisfaction 4/5</span>
      </span></div>
    </li></ul>
    <p class="profile-fine">Your comment is read by the maintainers only.</p>
  </section>
  <section class="profile-section">
    <div class="profile-section-head"><h2>Data</h2></div>
    <ul class="profile-rows">
      <li><button type="button" class="profile-row profile-text-button">Export my data</button></li>
      <li><button type="button" class="profile-row profile-text-button profile-danger">Delete everything</button></li>
    </ul>
    <p class="status-error" role="status">Couldn't export: check your connection and try again.</p>
  </section>
</section>`;

test("a signed-in profile page's rows, buttons and error line print dark on white", async ({
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
