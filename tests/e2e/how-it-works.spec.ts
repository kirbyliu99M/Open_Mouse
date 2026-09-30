import { expect, test } from "@playwright/test";
import { timePromises } from "./fixtures/time-promise";

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
  ).toHaveAttribute("src", "/images/hand-on-a4-camera.png");
  await expect(page.locator(".home-how-icon")).toHaveText(["1", "2", "3"]);
  await expect(page.getByText("Step by step", { exact: true })).toHaveCount(0);
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
    page.getByText(
      "Scans without an account are deleted automatically after a while.",
    ),
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

// Kirby, 2026-09-30: the product pages do not promise a deletion time. The
// server's schedule is a design detail (see src/server/scans/retention.ts),
// not something the copy should state, so no page says how long anything is
// kept or when it goes. What counts as such a sentence is
// tests/e2e/fixtures/time-promise.ts (unit-tested in time-promise.test.ts).
test("no product page promises a deletion time", async ({ page }) => {
  for (const path of [
    "/",
    "/how-it-works",
    "/account",
    "/scan/easy",
    "/scan",
    "/sheet",
    "/results/demo",
  ]) {
    await page.goto(path, { timeout: 60_000 });
    const text = await page.locator("main").innerText();
    expect(timePromises(text), path).toEqual([]);
    if (path === "/how-it-works" || path === "/account")
      expect(text, path).toMatch(/deleted automatically/i);
  }
});
