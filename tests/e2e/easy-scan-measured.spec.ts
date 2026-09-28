import { expect, test } from "@playwright/test";

/**
 * `/scan/easy/measured-demo` mounts the real EasyScanCamera against a
 * fixed, schema-valid measured state (no synthetic e2e photo makes
 * MediaPipe detect a hand — see tests/e2e/scan.spec.ts's own comment), so
 * this is the only deterministic way to reach and exercise the measured
 * bottom sheet: its dimension lines, the grip chips, and what "See my
 * matches" actually submits.
 */
const SUBMIT_BUTTON = () => "[data-testid='submit-scan-button']";

test.describe("/scan/easy/measured-demo — the measured bottom sheet", () => {
  test("shows the dimension lines, grip chips default to Not sure, and the sheet is a modal dialog", async ({
    page,
  }) => {
    await page.goto("/scan/easy/measured-demo");
    const sheet = page.getByRole("dialog", { name: "Hand measured" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Hand measured");

    await expect(page.getByText("Hand 190 mm")).toBeVisible();
    await expect(page.getByText("Palm 84 mm")).toBeVisible();

    const notSure = sheet.getByRole("button", { name: "Not sure" });
    await expect(notSure).toHaveAttribute("aria-pressed", "true");
    for (const label of ["Palm", "Claw", "Fingertip"]) {
      await expect(
        sheet.getByRole("button", { name: label, exact: true }),
      ).toHaveAttribute("aria-pressed", "false");
    }
  });

  test("submitting with the default grip (Not sure) sends no gripStyleStated", async ({
    page,
  }) => {
    let capturedBody: string | null = null;
    await page.route("**/api/scans", async (route) => {
      capturedBody = route.request().postData();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          scanId: "623e4567-e89b-12d3-a456-426614174010",
        }),
      });
    });

    await page.goto("/scan/easy/measured-demo");
    await page.locator(SUBMIT_BUTTON()).click();
    await expect.poll(() => capturedBody).toBeTruthy();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed).not.toHaveProperty("gripStyleStated");
  });

  test("picking a grip chip carries that grip in the submitted scan", async ({
    page,
  }) => {
    let capturedBody: string | null = null;
    await page.route("**/api/scans", async (route) => {
      capturedBody = route.request().postData();
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          scanId: "723e4567-e89b-12d3-a456-426614174011",
        }),
      });
    });

    await page.goto("/scan/easy/measured-demo");
    const sheet = page.getByRole("dialog", { name: "Hand measured" });
    const claw = sheet.getByRole("button", { name: "Claw", exact: true });
    await claw.click();
    await expect(claw).toHaveAttribute("aria-pressed", "true");

    await page.locator(SUBMIT_BUTTON()).click();
    await expect.poll(() => capturedBody).toBeTruthy();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.gripStyleStated).toBe("claw");
  });

  test("the retake icon button closes the measured sheet", async ({ page }) => {
    await page.goto("/scan/easy/measured-demo");
    const sheet = page.getByRole("dialog", { name: "Hand measured" });
    await expect(sheet).toBeVisible();
    await page.getByRole("button", { name: "Retake photo" }).click();
    await expect(sheet).toBeHidden();
  });
});
