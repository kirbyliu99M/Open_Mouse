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
  page.getByRole("button", { name: /Enter your measurements/ });
const result = (page: Page) => page.getByTestId("demo-used");

async function fill(scope: Locator, length: string, width: string) {
  await scope.getByLabel("Hand length").fill(length);
  await scope.getByLabel("Hand width").fill(width);
}

test.describe("typed hand length and width", () => {
  test("the desktop panel is shown directly and is aria-disabled until the hand and both numbers are right", async ({
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
        /Hand width must be between 7\.1.and.10\.3.cm for a hand length of 18\.5.cm; this number is too small/,
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
    await sheet(page).getByRole("button", { name: "Close" }).click();
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

  test("with reduced motion the sheet fades out instead of sliding", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(URL);
    await handle(page).click();
    await expect(sheet(page)).toBeVisible();
    // In one synchronous step: press Cancel, then read the sheet while it leaves.
    const leaving = await page.evaluate(() => {
      const dialog = document.querySelector("dialog")!;
      const cancel = [...dialog.querySelectorAll("button")].find(
        (b) => b.textContent === "Cancel",
      )!;
      cancel.click();
      const style = getComputedStyle(dialog);
      return {
        leaving: dialog.getAttribute("data-leaving"),
        transform: style.transform,
        transition: style.transitionProperty,
        duration: style.transitionDuration,
      };
    });
    expect(leaving.leaving).toBe("true");
    expect(leaving.transform).toBe("none");
    expect(leaving.transition).toContain("opacity");
    expect(parseFloat(leaving.duration)).toBeLessThanOrEqual(0.15);
    await expect(sheet(page)).toHaveCount(0, { timeout: 1000 });
    await expect(handle(page)).toBeFocused();
  });

  test("a drag that ends with no click does not swallow the next tap or Enter", async ({
    page,
  }) => {
    await page.goto(URL);
    const target = handle(page);
    const box = (await target.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    // A touch drag down that never produces a click: pointer events only.
    const init = { pointerId: 7, pointerType: "touch", isPrimary: true };
    await target.dispatchEvent("pointerdown", {
      ...init,
      clientX: x,
      clientY: y,
    });
    await target.dispatchEvent("pointermove", {
      ...init,
      clientX: x,
      clientY: y + 30,
    });
    await target.dispatchEvent("pointerup", {
      ...init,
      clientX: x,
      clientY: y + 30,
    });
    await expect(sheet(page)).toHaveCount(0);
    // The keyboard is never a drag's click.
    await target.focus();
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);

    // And a real tap right after another dead drag still opens it.
    await target.dispatchEvent("pointerdown", {
      ...init,
      clientX: x,
      clientY: y,
    });
    await target.dispatchEvent("pointermove", {
      ...init,
      clientX: x,
      clientY: y + 30,
    });
    await target.dispatchEvent("pointerup", {
      ...init,
      clientX: x,
      clientY: y + 30,
    });
    await target.click();
    await expect(sheet(page)).toBeVisible();
  });

  test("after a drag opened the sheet and it closed, Enter on the handle opens it again", async ({
    page,
  }) => {
    await page.goto(URL);
    const box = (await handle(page).boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 80, { steps: 8 });
    await page.mouse.up();
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    await expect(handle(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
  });

  test("selecting text in a field and letting go over the dimmed page does not close the sheet", async ({
    page,
  }) => {
    await page.goto(URL);
    await handle(page).click();
    const form = sheet(page);
    const length = form.getByLabel("Hand length");
    await length.fill("18.5");
    const box = (await length.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, 8, { steps: 6 });
    await page.mouse.up();
    await expect(sheet(page)).toBeVisible();
    // A plain tap on the dimmed page still closes it.
    await page.mouse.click(box.x + box.width / 2, 8);
    await expect(sheet(page)).toHaveCount(0);
  });

  test("Enter in a form that cannot be sent shows every problem and moves focus to the first one", async ({
    page,
  }) => {
    await page.goto(URL);
    const form = panel(page);
    const length = form.getByLabel("Hand length");
    const width = form.getByLabel("Hand width");
    const use = form.getByRole("button", { name: "Use these numbers" });
    await length.focus();
    await page.keyboard.press("Enter");
    // Everything at once: the hand, the length and the width.
    await expect(
      form.getByText("Choose the hand you use on the mouse first."),
    ).toBeVisible();
    await expect(
      form.getByText("Enter your hand length, for example 18.5."),
    ).toBeVisible();
    await expect(
      form.getByText("Enter your hand width, for example 8.2."),
    ).toBeVisible();
    // The first problem in the order of the form is the hand.
    await expect(form.getByRole("radio", { name: "Left hand" })).toBeFocused();
    await expect(use).toHaveAttribute("aria-disabled", "true");
    await expect(use).toBeEnabled({ enabled: false });
    expect(await use.evaluate((el) => (el as HTMLButtonElement).disabled)).toBe(
      false,
    );
    await expect(panel(page)).toBeVisible();
    await expect(result(page)).toHaveText("nothing yet");

    // Hand chosen, length fine, width wrong: Enter focuses the width.
    await form.getByLabel("Right hand").check();
    await length.fill("18.5");
    await width.fill("20");
    await width.press("Enter");
    await expect(width).toHaveAttribute("aria-invalid", "true");
    await expect(width).toBeFocused();

    // Hand chosen, length empty: Enter focuses the length.
    await length.fill("");
    await width.fill("8.2");
    await width.press("Enter");
    await expect(length).toBeFocused();
    await expect(result(page)).toHaveText("nothing yet");
  });

  test("pressing the grey button does the same: it is focusable, and says what is missing", async ({
    page,
  }) => {
    await page.goto(URL);
    const form = panel(page);
    const use = form.getByRole("button", { name: "Use these numbers" });
    await use.focus();
    await expect(use).toBeFocused();
    await use.click({ force: true });
    await expect(
      form.getByText("Choose the hand you use on the mouse first."),
    ).toBeVisible();
    await expect(
      form.getByText("Enter your hand length, for example 18.5."),
    ).toBeVisible();
    await expect(form.getByRole("radio", { name: "Left hand" })).toBeFocused();
    await expect(result(page)).toHaveText("nothing yet");
  });

  test("the hand group says it is required, and the missing-hand message sits next to the toggle", async ({
    page,
  }) => {
    await page.goto(URL);
    const form = panel(page);
    const group = form.getByRole("radiogroup");
    await expect(group).toHaveAttribute("aria-required", "true");
    await expect(group.getByText("Required")).toBeVisible();
    await fill(form, "18.5", "8.2");
    const message = form.getByText(
      "Choose the hand you use on the mouse first.",
    );
    await expect(message).toBeVisible();
    // Inside the hand group, not down by the button.
    await expect(
      group.getByText("Choose the hand you use on the mouse first."),
    ).toBeVisible();
    await expect(group).toHaveAttribute("aria-invalid", "true");
  });

  test("the unit is in each field's accessible name, and the dialog description is its intro", async ({
    page,
  }) => {
    await page.goto(URL);
    await expect(
      panel(page).getByRole("textbox", { name: "Hand length (cm)" }),
    ).toBeVisible();
    await expect(
      panel(page).getByRole("textbox", { name: "Hand width (cm)" }),
    ).toBeVisible();
    await handle(page).click();
    await expect(sheet(page)).toHaveAccessibleDescription(
      "No scan needed: enter your hand length and width.",
    );
  });

  test("what was typed survives a sheet that closed by accident, and a use clears it", async ({
    page,
  }) => {
    await page.goto(URL);
    await handle(page).click();
    await sheet(page).getByLabel("Left hand").check();
    await fill(sheet(page), "19.0", "8.5");
    await expect(page.getByTestId("demo-draft")).toContainText(
      '{"hand":"left","lengthText":"19.0","widthText":"8.5"}',
    );
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    await handle(page).click();
    await expect(sheet(page).getByLabel("Hand length (cm)")).toHaveValue(
      "19.0",
    );
    await expect(sheet(page).getByLabel("Hand width (cm)")).toHaveValue("8.5");
    await expect(sheet(page).getByLabel("Left hand")).toBeChecked();
    await sheet(page)
      .getByRole("button", { name: "Use these numbers" })
      .click();
    await expect(result(page)).toContainText("sheet: left, length 190 mm");
    await expect(page.getByTestId("demo-draft")).toContainText(
      '{"hand":null,"lengthText":"","widthText":""}',
    );
  });

  test("the buttons stay in view on a short screen, without scrolling the sheet", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 380 });
    await page.goto(URL);
    await handle(page).click();
    const use = sheet(page).getByRole("button", { name: "Use these numbers" });
    await expect(use).toBeInViewport({ ratio: 1 });
    await expect(
      sheet(page).getByRole("button", { name: "Cancel" }),
    ).toBeInViewport({ ratio: 1 });
    // The fields above are still reachable by scrolling the body.
    await sheet(page).getByLabel("Hand width (cm)").scrollIntoViewIfNeeded();
    await expect(use).toBeInViewport({ ratio: 1 });
  });

  test("forced colours: the chosen hand has a thick border and a check mark, not only a fill", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(URL);
    const form = panel(page);
    await form.getByLabel("Right hand").check();
    const chosen = await form
      .locator(".manualEntry-toggleOption")
      .filter({ has: page.getByRole("radio", { name: "Right hand" }) })
      .locator("span")
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          width: style.borderTopWidth,
          mark: getComputedStyle(el, "::before").content,
        };
      });
    expect(chosen.width).toBe("3px");
    expect(chosen.mark).toContain("\u2713");
    const other = await form
      .locator(".manualEntry-toggleOption")
      .filter({ has: page.getByRole("radio", { name: "Left hand" }) })
      .locator("span")
      .evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(other).toBe("1px");
  });

  test("a trailing zero and the ideographic full stop are accepted, an unfinished number is not", async ({
    page,
  }) => {
    await page.goto(URL);
    const form = panel(page);
    await fill(form, "18.50", "8。2");
    await form.getByLabel("Right hand").check();
    await expect(
      form.getByRole("button", { name: "Use these numbers" }),
    ).toBeEnabled();
    await form.getByLabel("Hand length").fill("18.");
    await form.getByLabel("Hand width").focus();
    await expect(
      form.getByText("Enter numbers only, for example 18.5."),
    ).toBeVisible();
  });

  test("the sheet can be dragged down while it is still opening", async ({
    page,
  }) => {
    await page.goto(URL);
    await handle(page).click();
    // Straight after opening, inside the 320 ms slide-up: the strip is moving,
    // so events go to it directly instead of to where it was a moment ago.
    const grab = page.locator(".manualEntry-grab");
    const init = { pointerId: 5, pointerType: "touch", isPrimary: true };
    await grab.dispatchEvent("pointerdown", {
      ...init,
      clientX: 100,
      clientY: 100,
    });
    await grab.dispatchEvent("pointermove", {
      ...init,
      clientX: 100,
      clientY: 200,
    });
    const state = await page.evaluate(() => {
      const dialog = document.querySelector("dialog")!;
      return {
        animation: dialog.style.animationName,
        transform: dialog.style.transform,
      };
    });
    // The opening animation is stopped, so the dragged transform shows.
    expect(state.animation).toBe("none");
    expect(state.transform).toBe("translateY(100px)");
    await grab.dispatchEvent("pointercancel", {
      ...init,
      clientX: 100,
      clientY: 200,
    });
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
