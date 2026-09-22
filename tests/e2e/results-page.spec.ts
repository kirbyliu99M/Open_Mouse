import { expect, test, type Page, type Route } from "@playwright/test";
import highConfidenceFixture from "../../src/components/results/fixtures/high-confidence.json";

/**
 * The fit and analysis routes (#27, #28) don't exist yet — every test here
 * stubs them with `page.route`, per issue #30's instruction to build and
 * test against the contract without waiting for the backend.
 */
const SCAN_ID = "a1b2c3d4-1111-4a2b-8c3d-9e0f1a2b3c4d";
const FIT_URL = `**/api/scans/${SCAN_ID}/fit`;
const ANALYSIS_URL = `**/api/scans/${SCAN_ID}/analysis`;

const READY_ANALYSIS_MODEL = {
  output: {
    headline: "A close match for your palm grip",
    whyTopPick:
      "The top pick's length and grip width both land close to your ideal.",
    tradeoffs: ["It runs slightly heavier than you prefer."],
    whatToAvoid: ["Mice with an aggressive back hump."],
    caveats: [],
  },
  source: "model",
  cached: false,
};

const READY_ANALYSIS_FALLBACK = {
  ...READY_ANALYSIS_MODEL,
  source: "fallback",
};

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function stubHappyFit(page: Page) {
  await page.route(FIT_URL, (route) =>
    fulfillJson(route, 200, highConfidenceFixture),
  );
}

test.describe("/results/[scanId] — real results page", () => {
  test("renders the ranking as soon as the fit route resolves, then the written analysis once it resolves too", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_MODEL),
    );

    await page.goto(`/results/${SCAN_ID}`);

    await expect(
      page.getByRole("heading", { level: 3, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();
    await expect(page.getByText("Why it fits")).toBeVisible();

    await expect(
      page.getByRole("heading", {
        level: 3,
        name: "A close match for your palm grip",
      }),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("shows the ranking immediately even while the analysis is still loading", async ({
    page,
  }) => {
    await stubHappyFit(page);
    // Never resolves within the test's lifetime — proves the ranking above
    // doesn't wait on it (acceptance criterion 2).
    await page.route(ANALYSIS_URL, () => {
      /* left pending */
    });

    await page.goto(`/results/${SCAN_ID}`);

    await expect(
      page.getByRole("heading", { level: 3, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText(/Preparing/);
  });

  test("404 on the fit route (expired or foreign scan, per routes.ts's ownership rule) shows 'scan again', never a raw error", async ({
    page,
  }) => {
    await page.route(FIT_URL, (route) =>
      fulfillJson(route, 404, { error: "Scan not found" }),
    );

    await page.goto(`/results/${SCAN_ID}`);

    await expect(
      page.getByRole("heading", { name: "We couldn't find this scan" }),
    ).toBeVisible();
    const scanAgain = page.getByRole("link", { name: "Scan again" });
    await expect(scanAgain).toBeVisible();
    await expect(scanAgain).toHaveAttribute("href", "/scan");
    // Never shows the numeric ranking for a 404.
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(0);
  });

  test("a network failure on the fit route shows 'try again', which retries the request", async ({
    page,
  }) => {
    let attempts = 0;
    await page.route(FIT_URL, async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await route.abort("failed");
      } else {
        await fulfillJson(route, 200, highConfidenceFixture);
      }
    });
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_MODEL),
    );

    await page.goto(`/results/${SCAN_ID}`);

    await expect(
      page.getByRole("heading", { name: "We couldn't reach the server" }),
    ).toBeVisible();
    const tryAgain = page.getByRole("button", { name: "Try again" });
    await expect(tryAgain).toBeVisible();

    await tryAgain.click();

    await expect(
      page.getByRole("heading", { level: 3, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();
  });

  test("a 5xx on the fit route shows a generic 'something went wrong' with try again", async ({
    page,
  }) => {
    await page.route(FIT_URL, (route) =>
      fulfillJson(route, 500, { error: "internal error" }),
    );

    await page.goto(`/results/${SCAN_ID}`);

    await expect(
      page.getByRole("heading", { name: "Something went wrong" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("429 on the analysis route leaves the ranking fully visible and says to retry later, never blocking on it", async ({
    page,
  }) => {
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 429, { error: "Too many requests" }),
    );

    await page.goto(`/results/${SCAN_ID}`);

    await expect(
      page.getByRole("heading", { level: 3, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();
    await expect(page.getByText("Why it fits")).toBeVisible();

    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Written analysis" });
    await expect(alert).toContainText(/unaffected/);
    await expect(alert).toContainText(/try again in a few minutes/i);
  });

  test("honest provenance: a fallback-sourced analysis says it was written from the scores, and never shows internal vocabulary", async ({
    page,
  }) => {
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_FALLBACK),
    );

    await page.goto(`/results/${SCAN_ID}`);

    await expect(
      page.getByText(
        "This was generated automatically from your scores above.",
      ),
    ).toBeVisible();

    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    for (const forbidden of ["fallback", "gemini", "llm", " model"]) {
      expect(bodyText).not.toContain(forbidden);
    }
  });
});
