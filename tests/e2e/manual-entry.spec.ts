import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Typing the hand length and width instead of scanning (candidate,
 * 2026-10-12), on the fixture route that shows the phone's pull-up sheet and
 * the desktop panel without a camera. English strings: the e2e locale is
 * en-US. Run as a single spec: `npx playwright test tests/e2e/manual-entry.spec.ts
 * --project=chromium --workers=1`.
 */
const URL = "/scan/manual-entry-demo";

const panel = (page: Page) => page.getByTestId("manual-entry-panel");
const sheet = (page: Page) => page.getByRole("dialog");
const handle = (page: Page) =>
  page.getByRole("button", { name: /Type your measurements/ });
const result = (page: Page) => page.getByTestId("demo-used");

async function fill(scope: Locator, length: string, width: string) {
  await scope.getByLabel("Hand length").fill(length);
  await scope.getByLabel("Hand width").fill(width);
}

test.describe("typed hand length and width", () => {
  test("the desktop panel is shown directly and stays disabled until the hand and both numbers are right", async ({
    page,
  }) => {
    await page.goto(URL);
    const form = panel(page);
    await expect(
      form.getByRole("heading", { name: "Enter your hand size" }),
    ).toBeVisible();
    const use = form.getByRole("button", { name: "Use these numbers" });
    await expect(use).toBeDisabled();
    // No default hand.
    await expect(
      form.getByRole("radio", { name: "Left hand" }),
    ).not.toBeChecked();
    await expect(
      form.getByRole("radio", { name: "Right hand" }),
    ).not.toBeChecked();
    // No cancel on the desktop panel.
    await expect(form.getByRole("button", { name: "Cancel" })).toHaveCount(0);

    // Numbers right, hand missing: still disabled, and it says why.
    await fill(form, "18.5", "8.2");
    await expect(use).toBeDisabled();
    await expect(
      form.getByText("Choose the hand you use on the mouse first."),
    ).toBeVisible();

    await form.getByLabel("Right hand").check();
    await expect(use).toBeEnabled();
    await expect(
      form.getByText("Choose the hand you use on the mouse first."),
    ).toHaveCount(0);

    await use.click();
    await expect(result(page)).toHaveText(
      "panel: right, length 185 mm, width 82 mm, palm 103.6 mm (estimated), method manual-entry",
    );
  });

  test("each error names the problem and the allowed range, under its own field", async ({
    page,
  }) => {
    await page.goto(URL);
    const form = panel(page);
    const length = form.getByLabel("Hand length");
    const width = form.getByLabel("Hand width");

    // Nothing is flagged while the first digits are being typed.
    await length.fill("2");
    await expect(form.locator(".manualEntry-error")).toHaveCount(0);

    await length.fill("28.0");
    await width.focus();
    await expect(length).toHaveAttribute("aria-invalid", "true");
    await expect(
      form.getByText("Hand length must be between 13.5 and 26.5 cm."),
    ).toBeVisible();

    await length.fill("13.4");
    await expect(form.getByText(/between 13\.5.and.26\.5/)).toBeVisible();

    await length.fill("18.55");
    await expect(
      form.getByText("Use at most one decimal, for example 18.5."),
    ).toBeVisible();

    await length.fill("abc");
    await expect(
      form.getByText("Enter numbers only, for example 18.5."),
    ).toBeVisible();

    await length.fill("18.5");
    await expect(length).not.toHaveAttribute("aria-invalid", "true");

    // A width that does not go with the length.
    await width.fill("7.0");
    await length.focus();
    await expect(width).toHaveAttribute("aria-invalid", "true");
    await expect(
      form.getByText(
        /A hand 18\.5.cm long is usually 7\.1.to.10\.3.cm wide; this number is too small/,
      ),
    ).toBeVisible();
    await width.fill("10.4");
    await expect(form.getByText(/too large/)).toBeVisible();
    await width.fill("8.2");
    await expect(width).not.toHaveAttribute("aria-invalid", "true");

    // The hint on the field is still read with the error (aria-describedby).
    await length.fill("30");
    await expect(length).toHaveAttribute("aria-describedby", /error/);
  });

  test("a comma is a decimal mark", async ({ page }) => {
    await page.goto(URL);
    const form = panel(page);
    await fill(form, "18,5", "8,2");
    await form.getByLabel("Left hand").check();
    await form.getByRole("button", { name: "Use these numbers" }).click();
    await expect(result(page)).toContainText(
      "panel: left, length 185 mm, width 82 mm",
    );
  });

  test("the handle opens the sheet; Esc, Cancel and the close button return focus to it", async ({
    page,
  }) => {
    await page.goto(URL);
    await expect(sheet(page)).toHaveCount(0);

    await handle(page).click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toHaveAccessibleName("Enter your hand size");
    // Focus lands on the title, and the page behind does not scroll.
    await expect(
      sheet(page).getByRole("heading", { name: "Enter your hand size" }),
    ).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.style.overflow),
    ).toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    await expect(handle(page)).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.style.overflow),
    ).not.toBe("hidden");

    await handle(page).click();
    await sheet(page).getByRole("button", { name: "Cancel" }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(handle(page)).toBeFocused();

    await handle(page).click();
    await sheet(page)
      .getByRole("button", { name: "Close typing your measurements" })
      .click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(handle(page)).toBeFocused();
  });

  test("the keyboard opens the handle and reaches every control inside the sheet", async ({
    page,
  }) => {
    await page.goto(URL);
    await handle(page).focus();
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
    // Tab stays inside the modal sheet.
    for (let i = 0; i < 12; i += 1) await page.keyboard.press("Tab");
    expect(
      await page.evaluate(
        () => document.activeElement?.closest("dialog") !== null,
      ),
    ).toBe(true);
  });

  test("dragging the handle up opens the sheet; a short drag does not; dragging down does not", async ({
    page,
  }) => {
    await page.goto(URL);
    const box = (await handle(page).boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    // Too short: it springs back and nothing opens.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 12, { steps: 4 });
    await page.mouse.up();
    await expect(sheet(page)).toHaveCount(0);

    // Down: nothing opens (and the click that follows a drag is ignored).
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 30, { steps: 4 });
    await page.mouse.up();
    await expect(sheet(page)).toHaveCount(0);

    // Up past the threshold: opens.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 80, { steps: 8 });
    await page.mouse.up();
    await expect(sheet(page)).toBeVisible();
  });

  test("using the numbers in the sheet hands them over and closes it", async ({
    page,
  }) => {
    await page.goto(URL);
    await handle(page).click();
    const form = sheet(page);
    await fill(form, "19.0", "8.5");
    await form.getByLabel("Left hand").check();
    await form.getByRole("button", { name: "Use these numbers" }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(result(page)).toContainText(
      "sheet: left, length 190 mm, width 85 mm, palm 106.4 mm (estimated)",
    );
  });

  test("with reduced motion the sheet closes at once, no slide", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(URL);
    await handle(page).click();
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    // No 240 ms slide-down wait: gone on the next frame.
    await expect(sheet(page)).toHaveCount(0, { timeout: 150 });
  });

  test("the touch targets are at least 44 px", async ({ page }) => {
    await page.goto(URL);
    const targets = [
      handle(page),
      panel(page).getByLabel("Hand length"),
      panel(page).getByLabel("Hand width"),
      panel(page).getByRole("radio", { name: "Left hand" }),
      panel(page).getByRole("button", { name: "Use these numbers" }),
    ];
    for (const target of targets) {
      const box = (await target.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
  });
});
