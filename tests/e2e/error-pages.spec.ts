import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  ACTIONS,
  ERROR_COPY,
  NOT_FOUND_COPY,
} from "../../src/components/errors/copy";

/**
 * The not-found page (src/app/not-found.tsx) and the error boundary
 * (src/app/error.tsx), against the real dev server. The error screen is
 * reached through /scan/error-demo, a dev-only route that throws on purpose
 * and 404s in production like the other demo routes.
 *
 * global-error.tsx cannot be reached this way (it only shows when the root
 * layout itself fails); tests/unit/error-screens.test.ts renders it.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

/** What the demo route throws (src/app/scan/error-demo/page.tsx). */
const THROWN_TEXT = [
  "DEMO-ERROR-MESSAGE-MUST-NOT-BE-SHOWN",
  "/srv/app/internal",
  "secret-path.ts",
];

const heading = (page: Page) => page.getByRole("heading", { level: 1 });

async function expectOneMainAndOneHeading(page: Page) {
  await expect(page.locator("main")).toHaveCount(1);
  await expect(heading(page)).toHaveCount(1);
}

test.describe("404 page", () => {
  for (const path of ["/no-such-page-xyz", "/scan/deep/no-such-page"]) {
    test(`${path} answers 404 and shows the not-found page`, async ({
      page,
    }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(heading(page)).toHaveText(NOT_FOUND_COPY.title);
      await expectOneMainAndOneHeading(page);
      await expect(page).toHaveTitle(NOT_FOUND_COPY.documentTitle);
      await expect(
        page.getByRole("link", { name: ACTIONS.scan }),
      ).toHaveAttribute("href", "/scan/easy");
      await expect(
        page.getByRole("link", { name: ACTIONS.home }),
      ).toHaveAttribute("href", "/");
    });
  }

  test("its two links lead somewhere real", async ({ page }) => {
    await page.goto("/no-such-page-xyz");
    await page.getByRole("link", { name: ACTIONS.home }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(heading(page)).toBeVisible();
    await expect(heading(page)).not.toHaveText(NOT_FOUND_COPY.title);

    await page.goto("/no-such-page-xyz");
    await page.getByRole("link", { name: ACTIONS.scan }).click();
    await expect(page).toHaveURL(/\/scan\/easy$/);
  });

  test("does not scroll sideways on a phone-sized screen", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
    await page.goto("/no-such-page-xyz");
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("error screen", () => {
  test("a page that throws shows the error screen and none of the error", async ({
    page,
  }) => {
    await page.goto("/scan/error-demo");
    await expect(heading(page)).toHaveText(ERROR_COPY.title);
    await expectOneMainAndOneHeading(page);

    // Only the page itself: in development Next draws its own overlay with the
    // message, outside <main>, which is not what a user is shown.
    const main = page.locator("main");
    const shown = (await main.innerText()) + (await main.innerHTML());
    for (const text of THROWN_TEXT) expect(shown).not.toContain(text);
    expect(shown).not.toMatch(/\bat\s+\S+\s+\(/); // a stack frame
    // The one detail allowed is the digest, a number-like hash.
    const reference = page.locator(".errorScreen-reference code");
    if ((await reference.count()) > 0) {
      await expect(reference).toHaveText(/^[0-9a-z]+$/i);
    }

    await expect(
      page.getByRole("link", { name: ACTIONS.scan }),
    ).toHaveAttribute("href", "/scan/easy");
    await expect(
      page.getByRole("link", { name: ACTIONS.home }),
    ).toHaveAttribute("href", "/");
  });

  test("moves focus to the heading, so the change is announced", async ({
    page,
  }) => {
    await page.goto("/scan/error-demo");
    await expect(heading(page)).toBeFocused();
  });

  test("Try again asks the server for the page again and stays usable", async ({
    page,
  }) => {
    await page.goto("/scan/error-demo");
    const retry = page.getByRole("button", { name: ACTIONS.retry });
    await expect(retry).toBeVisible();

    const refetches: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/scan/error-demo?_rsc=")) {
        refetches.push(request.url());
      }
    });
    await retry.click();
    // The route still throws, so the screen stays; what changed is that the
    // segment was requested again (router.refresh) and reset() ran.
    await expect.poll(() => refetches.length).toBeGreaterThan(0);
    await expect(heading(page)).toHaveText(ERROR_COPY.title);
    await expect(retry).toBeEnabled();
  });

  test("pressing Try again from the keyboard never drops focus to the page body", async ({
    page,
  }) => {
    await page.goto("/scan/error-demo");
    const retry = page.getByRole("button", { name: ACTIONS.retry });
    await expect(retry).toBeVisible();
    await retry.focus();
    await expect(retry).toBeFocused();

    const activeTags: string[] = [];
    const refetches: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/scan/error-demo?_rsc=")) {
        refetches.push(request.url());
      }
    });
    await page.keyboard.press("Enter");
    // Sample where focus is while the retry runs and after it ends.
    for (let i = 0; i < 20; i += 1) {
      activeTags.push(
        await page.evaluate(() => document.activeElement?.tagName ?? "none"),
      );
      await page.waitForTimeout(50);
    }
    await expect.poll(() => refetches.length).toBeGreaterThan(0);

    expect(activeTags).not.toContain("BODY");
    expect(activeTags).not.toContain("none");
    // The retry ended on the same screen: focus is on the heading or the
    // button, and the button was never given the disabled attribute.
    await expect
      .poll(() =>
        page.evaluate(() => document.activeElement?.tagName ?? "none"),
      )
      .toMatch(/^(H1|BUTTON)$/);
    await expect(retry).not.toHaveAttribute("disabled");
    await expect(retry).toHaveAttribute("aria-disabled", "false");
  });

  test("its links lead somewhere real", async ({ page }) => {
    await page.goto("/scan/error-demo");
    await page.getByRole("link", { name: ACTIONS.home }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(heading(page)).toBeVisible();
    await expect(heading(page)).not.toHaveText(NOT_FOUND_COPY.title);
  });

  test("does not scroll sideways on a phone-sized screen", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
    await page.goto("/scan/error-demo");
    await expect(heading(page)).toHaveText(ERROR_COPY.title);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

for (const [name, path, title] of [
  ["404 page", "/no-such-page-xyz", NOT_FOUND_COPY.title],
  ["error screen", "/scan/error-demo", ERROR_COPY.title],
] as const) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`the ${name} has no WCAG 2.2 AA violations in ${colorScheme} mode`, async ({
      page,
    }) => {
      // No transitions: a colour read mid-fade is neither theme's.
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto(path);
      await expect(heading(page)).toHaveText(title);
      const { violations } = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        // Next's development overlay, not part of the page.
        .exclude("nextjs-portal")
        .analyze();
      expect(
        violations.map((v) => ({
          rule: v.id,
          impact: v.impact,
          nodes: v.nodes.map(
            (n) => `${n.target.join(" ")}: ${n.failureSummary}`,
          ),
        })),
      ).toEqual([]);
    });
  }
}
