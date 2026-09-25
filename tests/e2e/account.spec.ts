import { expect, type Page, test } from "@playwright/test";

/**
 * Next's dev server compiles each route on its first request; a route hit
 * for the very first time in a run can occasionally 404 while that
 * in-flight compile is still being registered. Retrying the navigation is
 * the standard workaround — `home.spec.ts` doesn't need this because its
 * one route (`/`) is also `webServer.url`, which Playwright already
 * requests once while waiting for the server to come up.
 */
async function gotoWarm(page: Page, path: string) {
  let response = await page.goto(path);
  for (let attempt = 0; attempt < 5 && response?.status() === 404; attempt++) {
    await page.waitForTimeout(300);
    response = await page.goto(path);
  }
  return response;
}

/**
 * No real OAuth credentials exist in this environment (issue #17): the
 * sign-in button must show "Sign-in unavailable" rather than a broken
 * Google OAuth flow, and the page must render without a database or a
 * server error either way.
 */
test("an anonymous visitor sees Sign-in unavailable, no server or browser errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  const response = await gotoWarm(page, "/account");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "Keep your scans" }),
  ).toBeVisible();
  await expect(
    page.getByText(/sign-in is unavailable right now/i),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Start measuring without signing in" })
    .click();
  await expect(page).toHaveURL(/\/scan\/easy$/);
  expect(errors).toEqual([]);
});

test("deletion confirmation contains focus and returns it to the trigger", async ({
  page,
}) => {
  await gotoWarm(page, "/account");
  const trigger = page.getByRole("button", { name: "Delete everything" });
  if ((await trigger.count()) === 0 || (await trigger.isDisabled())) {
    test.skip(true, "Requires a signed-in account with a saved scan");
  }
  await trigger.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Delete everything" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("the home page links to /account", async ({ page }) => {
  await gotoWarm(page, "/");
  await page.getByRole("link", { name: "Sign in to keep your scans" }).click();
  await expect(page).toHaveURL(/\/account$/);
});
