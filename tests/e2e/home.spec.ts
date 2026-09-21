import { expect, test } from "@playwright/test";

test("the placeholder is available without a database or browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Open_Mouse");
  await expect(
    page.getByRole("heading", { level: 1, name: "Open_Mouse" }),
  ).toBeVisible();
  await expect(page.getByText("In development", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
