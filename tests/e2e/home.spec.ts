import { expect, test } from "@playwright/test";

test("home starts the measurement journey without browser errors", async ({
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
      name: "Find a mouse that fits your hand.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Early preview · measurements still being validated"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Get started" }).click();
  await expect(page).toHaveURL(/\/sheet$/);
  await expect(page.getByText("Step 1 of 2 · Print")).toBeVisible();
  await page.getByRole("link", { name: "Back to Home" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "I already have the sheet" }).click();
  await expect(page).toHaveURL(/\/scan$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
