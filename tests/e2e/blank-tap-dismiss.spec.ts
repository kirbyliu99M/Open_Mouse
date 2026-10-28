import { expect, test, type Page } from "@playwright/test";

/**
 * Kirby 2026-10-26 (candidate / 未拍板): every pop-up closes on a tap on the
 * empty page around it. Driven here on /results/demo (no database): the side
 * menu and the share preview, on a phone and on a wide screen. A tap inside
 * the panel (its own padding too) does not close it. Run alone through the
 * safe runner: `--project=chromium --workers=1`.
 */

async function openMenu(page: Page) {
  await page
    .locator(".results-topBar")
    .getByRole("button", { name: "Open menu" })
    .click();
  const menu = page.locator("dialog.navMenu");
  await expect(menu).toBeVisible();
  return menu;
}

async function openShare(page: Page) {
  await page.locator('[data-testid="share-card-button"]:visible').click();
  const preview = page.getByTestId("share-preview");
  await expect(preview).toBeVisible();
  return preview;
}

for (const size of [
  { name: "a phone", width: 390, height: 844 },
  { name: "a wide screen", width: 1440, height: 900 },
]) {
  test.describe(`blank taps close pop-ups on ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("the menu: a tap on its padding keeps it, a tap on the page beside it closes it", async ({
      page,
    }) => {
      await page.goto("/results/demo");
      const menu = await openMenu(page);
      const box = (await menu.boundingBox())!;
      // Its own padding, under the list: still open.
      await page.mouse.click(box.x + 8, box.y + box.height - 8);
      await expect(menu).toBeVisible();
      // The dimmed page on its left: it slides out and focus returns.
      await page.mouse.click(Math.max(4, box.x / 2), box.y + box.height / 2);
      await expect(menu).toHaveCount(0);
      await expect(
        page
          .locator(".results-topBar")
          .getByRole("button", { name: "Open menu" }),
      ).toBeFocused();
    });

    test("the share preview: a tap beside the card closes it, a tap on the card does not", async ({
      page,
    }) => {
      await page.goto("/results/demo");
      const preview = await openShare(page);
      const card = page.locator(".sharePreview-card");
      const cardBox = (await card.boundingBox())!;
      await page.mouse.click(
        cardBox.x + cardBox.width / 2,
        cardBox.y + cardBox.height / 2,
      );
      await expect(preview).toBeVisible();
      // Beside the card: the stage's own space on a phone, the dimmed page
      // around the panel on a wide screen.
      await page.mouse.click(Math.max(4, cardBox.x / 2), cardBox.y + 40);
      await expect(preview).toHaveCount(0);
    });

    test("a press in the menu dragged out onto the page does not close it", async ({
      page,
    }) => {
      await page.goto("/results/demo");
      const menu = await openMenu(page);
      const box = (await menu.boundingBox())!;
      await page.mouse.move(box.x + 12, box.y + box.height - 12);
      await page.mouse.down();
      await page.mouse.move(Math.max(4, box.x / 2), box.y + box.height / 2, {
        steps: 4,
      });
      await page.mouse.up();
      await expect(menu).toBeVisible();
    });
  });
}
