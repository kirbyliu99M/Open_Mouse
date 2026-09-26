import { expect, test } from "@playwright/test";

const output = "docs/design/easy-scan-shell-2026-09-25/built";

test("desktop shows a local QR code, the URL and upload path", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.goto("/scan/easy");
  await expect(
    page.getByRole("heading", { name: "Scan with your phone" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("img", { name: "QR code for this scan page" })
      .locator("svg"),
  ).toBeVisible();
  await expect(page.getByText(page.url(), { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Or upload a photo" }),
  ).toBeVisible();
  if (process.env.SCREENSHOTS === "1")
    await page.screenshot({ path: `${output}/desktop-qr.png`, fullPage: true });
});

test("desktop QR and displayed link omit query parameters and hash", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.goto("/scan/easy?source=private#camera");
  const canonicalUrl = new URL("/scan/easy", page.url()).toString();
  await expect(page.getByText(canonicalUrl, { exact: true })).toBeVisible();
  await expect(page.getByText(/source=private/)).toHaveCount(0);
  await expect(
    page
      .getByRole("img", { name: "QR code for this scan page" })
      .locator("svg"),
  ).toBeVisible();
});

test("LINE browser shows open-in-browser notice, copy link and upload", async ({
  browser,
}, info) => {
  test.skip(info.project.name !== "chromium");
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (iPhone) AppleWebKit/605 Mobile LINE/14.0",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/scan/easy");
  await expect(
    page.getByRole("heading", {
      name: "Open in Safari or Chrome to use the camera",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open in browser" }),
  ).toHaveAttribute("href", /openExternalBrowser=1/);
  await expect(
    page.getByRole("button", { name: "Or upload a photo" }),
  ).toBeVisible();
  if (process.env.SCREENSHOTS === "1")
    await page.screenshot({
      path: `${output}/in-app-notice.png`,
      fullPage: true,
    });
  await context.close();
});

test("copy link offers a selectable URL when Clipboard API is unavailable", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined });
  });
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(
    page.getByRole("textbox", { name: "Select link to copy" }),
  ).toHaveValue(page.url());
});

test("copy link announces success after the Clipboard API resolves", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => undefined },
    });
  });
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Link copied")).toBeVisible();
});

test("typed-length flow reaches hand detection gate with no requests after camera warm-up", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "chromium-camera-paper-edge");
  await page.goto("/scan/easy");
  await page.waitForResponse((res) =>
    res.url().includes("/mediapipe/models/hand_landmarker.task"),
  );
  await page.waitForLoadState("networkidle");
  await page
    .getByRole("dialog", { name: "One blank sheet is all you need" })
    .getByRole("button", { name: "No paper? Use a ruler instead" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Hand length" }),
  ).toBeVisible();
  if (process.env.SCREENSHOTS === "1")
    await page.screenshot({ path: `${output}/typed-length-step.png` });
  await page.getByLabel("Hand length (mm)").fill("186");
  const requests: string[] = [];
  page.on("request", (req) => {
    if (
      !req.url().startsWith("blob:") &&
      !/__nextjs_|__next_hmr|webpack-hmr/.test(req.url())
    )
      requests.push(req.url());
  });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("camera-cue")).toContainText(
    "Hand flat, fingers together, phone straight above",
  );
  await expect(page.locator(".cameraCornerDot")).toHaveCount(0);
  if (process.env.SCREENSHOTS === "1")
    await page.screenshot({ path: `${output}/no-paper-camera.png` });
  await page.waitForTimeout(1200);
  await expect(page.getByRole("button", { name: "Take photo" })).toBeVisible();
  await page.getByRole("button", { name: "Take photo" }).click();
  await expect(
    page.getByRole("dialog", { name: "Retake needed" }),
  ).toContainText("couldn't find a hand", { timeout: 20000 });
  expect(requests).toEqual([]);
});
