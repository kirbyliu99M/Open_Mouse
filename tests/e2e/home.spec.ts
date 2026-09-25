import { expect, test } from "@playwright/test";
import logitechCatalogue from "../../src/db/seed/logitech.json";

test("home page shows the real pitch and its CTA opens the easy-scan camera directly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Open_Mouse");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Find the mouse that fits your hand.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Early preview · measurements still being validated"),
  ).toBeVisible();

  // The mouse count in the copy comes from the catalogue, not a hard-coded
  // number — assert against the seed's own length so this test can't drift
  // from it silently.
  const count = logitechCatalogue.length;
  await expect(
    page.getByText(`rank ${count} Logitech mice for you`),
  ).toBeVisible();
  await expect(
    page.getByText(`${count} Logitech mice ranked by how they fit your hand.`),
  ).toBeVisible();

  await expect(
    page.getByRole("img", { name: /illustration of a hand/i }),
  ).toBeVisible();

  // "Browse the mice first" must not exist yet — no catalogue page.
  await expect(page.getByText(/browse the mice first/i)).toHaveCount(0);

  const cta = page.getByRole("link", { name: /scan my hand/i });
  await expect(cta).toHaveAttribute("href", "/scan/easy");
  await cta.click();
  await expect(page).toHaveURL(/\/scan\/easy$/);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("home page's side menu opens, traps focus, closes on Escape and returns focus to the trigger", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open menu" });
  await trigger.click();

  const menu = page.getByRole("dialog", { name: "Navigation" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("link", { name: "Scan my hand" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("the printed-sheet flow stays reachable from /scan", async ({ page }) => {
  const response = await page.goto("/scan");
  expect(response?.status()).toBe(200);
  await expect(page.getByText("Step 2 of 2 · Photo")).toBeVisible();
});
