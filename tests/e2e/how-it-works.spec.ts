import { expect, test } from "@playwright/test";

test("How it works shows the illustration, steps, privacy details and navigation", async ({
  page,
}) => {
  const response = await page.goto("/how-it-works");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "How it works" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /illustration of a hand laid flat/i }),
  ).toBeVisible();
  await expect(page.getByText("All four corners found")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Three steps" }),
  ).toBeVisible();
  for (const step of [
    "Any blank A4 sheet",
    "Hand flat, phone above",
    "Your best matches",
  ]) {
    await expect(page.getByText(step, { exact: true })).toBeVisible();
  }
  await expect(
    page.getByText(
      "Your photo never leaves your phone. Only measurements are sent.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Scans without an account are deleted within 24 hours."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "‹ Home" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(
    page.getByRole("link", { name: "Scan my hand" }),
  ).toHaveAttribute("href", "/scan/easy");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
