import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

type CatalogueMouse = {
  model: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightG: number;
};
const catalogue: CatalogueMouse[] = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../src/db/seed/logitech.json", import.meta.url)),
    "utf-8",
  ),
);
const featured = catalogue.find(
  (mouse) => mouse.model === "G Pro X Superlight 2",
);
if (!featured)
  throw new Error("Featured mouse is missing from the test catalogue");
const format = (value: number, unit: string) =>
  `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)} ${unit}`;

test("landing shows the headline, sketch, catalogue specifications and CTA destinations", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Shape matters more than specs.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Line sketch of the G Pro X Superlight 2 mouse",
    }),
  ).toBeVisible();
  const specs = page.locator("dl.landing-specs");
  for (const [label, value] of [
    ["Length", format(featured.lengthMm, "mm")],
    ["Width", format(featured.widthMm, "mm")],
    ["Height", format(featured.heightMm, "mm")],
    ["Weight", format(featured.weightG, "g")],
  ]) {
    await expect(
      specs
        .locator("div")
        .filter({ has: page.locator("dt", { hasText: label }) }),
    ).toContainText(value);
  }
  await expect(
    page.getByText(
      `${catalogue.length} Logitech mice scored on length, grip width and weight.`,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Scan my hand" }),
  ).toHaveAttribute("href", "/scan/easy");
  await expect(
    page.getByRole("link", { name: "How it works" }),
  ).toHaveAttribute("href", "/how-it-works");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("landing side menu lists How it works and returns focus on Escape", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open menu" });
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "Navigation" });
  await expect(
    menu.getByRole("link", { name: "How it works" }),
  ).toHaveAttribute("href", "/how-it-works");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("the printed-sheet flow stays reachable from /scan", async ({ page }) => {
  const response = await page.goto("/scan");
  expect(response?.status()).toBe(200);
  await expect(page.getByText("Step 2 of 2 · Photo")).toBeVisible();
});
