import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import { scanPath } from "../../src/lib/contracts/routes";

// Read as plain JSON rather than `import ... from "*.json"` — Playwright's
// test runner loads spec files as native Node ESM, which requires an
// `type: "json"` import attribute Node's resolver doesn't universally
// support yet; reading the file directly sidesteps that.
const highConfidenceFixture: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../src/components/results/fixtures/high-confidence.json",
        import.meta.url,
      ),
    ),
    "utf-8",
  ),
);

/**
 * The fit and analysis routes (#27, #28) don't exist yet — every test here
 * stubs them with `page.route`, per issue #30's instruction to build and
 * test against the contract without waiting for the backend.
 */
const SCAN_ID = "a1b2c3d4-1111-4a2b-8c3d-9e0f1a2b3c4d";
const FIT_URL = `**/api/scans/${SCAN_ID}/fit`;
const ANALYSIS_URL = `**/api/scans/${SCAN_ID}/analysis`;
const HAND_KEY = `openMouse.resultHand.${SCAN_ID}`;
const LENGTH_KEY = `open-mouse:user-length:${SCAN_ID}`;

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

test("a new tab retains typed-length and hand disclosures, then deletion clears both keys", async ({
  page,
  context,
}) => {
  await stubHappyFit(page);
  await page.route(ANALYSIS_URL, (route) =>
    fulfillJson(route, 200, READY_ANALYSIS_MODEL),
  );
  await page.goto(`/results/${SCAN_ID}`);
  await page.evaluate(
    ([handKey, lengthKey]) => {
      localStorage.setItem(handKey, "left");
      localStorage.setItem(lengthKey, "190");
    },
    [HAND_KEY, LENGTH_KEY],
  );

  const newTab = await context.newPage();
  await stubHappyFit(newTab);
  await newTab.route(ANALYSIS_URL, (route) =>
    fulfillJson(route, 200, READY_ANALYSIS_MODEL),
  );
  await newTab.route(`**${scanPath(SCAN_ID)}`, (route) =>
    route.fulfill({ status: 204 }),
  );
  await newTab.goto(`/results/${SCAN_ID}`);
  await expect(
    newTab.getByText(/Based on the hand length you entered \(190 mm\)/),
  ).toBeVisible();
  await expect(newTab.getByText(/Left-hand fit isn't rated yet/)).toBeVisible();
  await newTab.getByRole("button", { name: "Delete this scan now" }).click();
  await newTab.getByRole("button", { name: "Delete scan" }).click();
  await expect(
    newTab.getByRole("heading", { name: "This scan has been deleted" }),
  ).toBeVisible();
  expect(
    await newTab.evaluate(
      ([handKey, lengthKey]) => [
        localStorage.getItem(handKey),
        localStorage.getItem(lengthKey),
      ],
      [HAND_KEY, LENGTH_KEY],
    ),
  ).toEqual([null, null]);
  await newTab.close();
});

test.describe("/results/[scanId] — real results page", () => {
  test("shows the left-hand disclosure, poor-fit line below 50, and ranked-list h2", async ({
    page,
  }) => {
    const fixture = structuredClone(highConfidenceFixture) as {
      results: { total: number }[];
    };
    fixture.results[0].total = 49;
    await page.addInitScript(
      ([key]) => localStorage.setItem(key, "left"),
      [`openMouse.resultHand.${SCAN_ID}`],
    );
    await page.route(FIT_URL, (route) => fulfillJson(route, 200, fixture));
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 500, { error: "Unavailable" }),
    );
    await page.goto(`/results/${SCAN_ID}`);
    await expect(
      page.getByText(
        "None of these fits your hand well. The closest is below.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Left-hand fit isn't rated yet — check each mouse's shape before you buy.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Other matches" }),
    ).toBeVisible();
  });

  test("omits the poor-fit line at 50 and the left-hand disclosure for a right scan", async ({
    page,
  }) => {
    const fixture = structuredClone(highConfidenceFixture) as {
      results: { total: number }[];
    };
    fixture.results[0].total = 50;
    await page.addInitScript(
      ([key]) => localStorage.setItem(key, "right"),
      [`openMouse.resultHand.${SCAN_ID}`],
    );
    await page.route(FIT_URL, (route) => fulfillJson(route, 200, fixture));
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 500, { error: "Unavailable" }),
    );
    await page.goto(`/results/${SCAN_ID}`);
    await expect(
      page.getByRole("heading", { level: 2, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "None of these fits your hand well. The closest is below.",
      ),
    ).toHaveCount(0);
    await expect(page.getByText(/Left-hand fit isn't rated yet/)).toHaveCount(
      0,
    );
  });
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
      page.getByRole("heading", { level: 2, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { level: 2, name: "Why this one" }),
    ).toBeVisible();
    await expect(
      page.getByText("A close match for your palm grip"),
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
      page.getByRole("heading", { level: 2, name: /G Pro X Superlight 2/ }),
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
    // Scoped to the error panel's own action — the TopBar above it also has
    // a "Scan again" link (its accessible name is "Back to Scan again"),
    // and an unscoped query matches both.
    const scanAgain = page
      .locator(".results-page-error")
      .getByRole("link", { name: "Scan again", exact: true });
    await expect(scanAgain).toBeVisible();
    await expect(scanAgain).toHaveAttribute("href", "/scan");
    // Never shows the numeric ranking for a 404.
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);
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
      page.getByRole("heading", { level: 2, name: /G Pro X Superlight 2/ }),
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
      page.getByRole("heading", { level: 2, name: /G Pro X Superlight 2/ }),
    ).toBeVisible();
    await expect(page.getByText("How it scores")).toBeVisible();

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
      page.getByText("Generated automatically from your scores above."),
    ).toBeVisible();

    const bodyText = (await page.locator("body").innerText()).toLowerCase();
    for (const forbidden of ["fallback", "gemini", "llm", " model"]) {
      expect(bodyText).not.toContain(forbidden);
    }
  });
});

// Issue #42, acceptance criterion 2: "deleting is the user's choice". No real
// OAuth credentials exist in this environment (issue #17, matching
// account.spec.ts's own note), so `page.tsx`'s `auth()` call always resolves
// to no session here — every case below is exercising the anonymous branch,
// which is also the only branch that ever renders this action at all.
test.describe("/results/[scanId] — delete this scan now (issue #42)", () => {
  const SCAN_URL = `**${scanPath(SCAN_ID)}`;

  test("presses feedback with a confirmation, and focus lands on Cancel", async ({
    page,
  }) => {
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_MODEL),
    );
    await page.goto(`/results/${SCAN_ID}`);

    const trigger = page.getByRole("button", { name: "Delete this scan now" });
    await expect(trigger).toBeVisible();
    await trigger.click();

    await expect(
      page.getByRole("alertdialog", { name: "Delete this scan now?" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  });

  test("Cancel and Escape both close the dialog and return focus to the trigger, without deleting anything", async ({
    page,
  }) => {
    let deleteCalls = 0;
    await page.route(SCAN_URL, (route) => {
      deleteCalls += 1;
      return route.fulfill({ status: 204 });
    });
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_MODEL),
    );
    await page.goto(`/results/${SCAN_ID}`);

    const trigger = page.getByRole("button", { name: "Delete this scan now" });

    await trigger.click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    expect(deleteCalls).toBe(0);
  });

  test("confirming deletes this scan and shows the deleted state, with focus on its heading", async ({
    page,
  }) => {
    let method = "";
    await page.route(SCAN_URL, (route) => {
      method = route.request().method();
      return route.fulfill({ status: 204 });
    });
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_MODEL),
    );
    await page.goto(`/results/${SCAN_ID}`);

    await page.getByRole("button", { name: "Delete this scan now" }).click();
    await page.getByRole("button", { name: "Delete scan" }).click();

    const heading = page.getByRole("heading", {
      name: "This scan has been deleted",
    });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page.getByText("permanently removed")).toBeVisible();
    const scanAgain = page.getByRole("link", { name: "Scan again" });
    await expect(scanAgain).toHaveAttribute("href", "/scan");
    // The ranking is gone — deleted really replaces the page, not just a toast.
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0);

    expect(method).toBe("DELETE");
  });

  test("a failed delete names the problem, gives one fix, and leaves the dialog open to retry", async ({
    page,
  }) => {
    await page.route(SCAN_URL, (route) => route.fulfill({ status: 500 }));
    await stubHappyFit(page);
    await page.route(ANALYSIS_URL, (route) =>
      fulfillJson(route, 200, READY_ANALYSIS_MODEL),
    );
    await page.goto(`/results/${SCAN_ID}`);

    await page.getByRole("button", { name: "Delete this scan now" }).click();
    await page.getByRole("button", { name: "Delete scan" }).click();

    const error = page.getByRole("alertdialog").getByRole("alert");
    await expect(error).toContainText("Couldn't delete");
    await expect(error).toContainText(/check your connection and try again/i);
    // Still open, and the ranking underneath is untouched.
    await expect(page.getByRole("alertdialog")).toBeVisible();
  });
});
