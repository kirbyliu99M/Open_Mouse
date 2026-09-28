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
      name: "Measure your hand. Find the mouse that fits.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Line sketch of the G Pro X Superlight 2 mouse",
    }),
  ).toBeVisible();
  await expect(page.locator(".landing-dimension")).toContainText(
    format(featured.lengthMm, "mm"),
  );
  await expect(page.locator(".landing-annotation")).toContainText(
    format(featured.weightG, "g"),
  );
  for (const value of [
    featured.lengthMm,
    featured.widthMm,
    featured.heightMm,
  ]) {
    await expect(page.locator(".landing-annotation")).toContainText(
      String(value),
    );
  }
  await expect(
    page.getByText(
      `${catalogue.length} Logitech mice scored on length, grip width and weight.`,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Scan my hand" }),
  ).toHaveAttribute("href", "/scan/easy");
  await expect(page.locator(".landing-preview-note")).toHaveText(
    "Early preview — measurements are still being validated.",
  );
  await expect(
    page.getByRole("link", { name: "How it works" }),
  ).toHaveAttribute("href", "/how-it-works");
  await expect(
    page.getByText(
      "Your photo never leaves your phone. Only measurements are sent.",
    ),
  ).toBeVisible();
  await expect(page.locator(".landing-points > div > span")).toHaveCount(0);
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
