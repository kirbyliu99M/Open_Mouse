import { expect, test, type Page } from "@playwright/test";
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
} from "../../src/lib/contracts/measurement";
import {
  fitPath,
  resultsPagePath,
  SCAN_SUBMIT_PATH,
  scanSubmitResponseSchema,
} from "../../src/lib/contracts/routes";

/**
 * The results page has rendered its top pick: the rank-1 line ("#1 · <brand>"),
 * a whole-number score, and that score's label. The browser here is English
 * (the page shows zh-TW only to a Chinese browser), so the label is
 * "fit score / 100". This replaces the old page's "Best match" heading.
 */
async function expectTopPickShown(page: Page) {
  await expect(page.locator(".results-score-rank")).toHaveText(/^#1 · \S/);
  await expect(page.locator(".results-score-value")).toHaveText(/^\d{1,3}$/);
  await expect(page.getByText("fit score / 100")).toBeVisible();
}

/**
 * Regression for #42: a `pagehide` beacon deleted the anonymous session on
 * every reload or full navigation, so results vanished on refresh. Nothing is
 * mocked here — this talks to the deployment's real routes and database.
 */
const submission = scanSubmissionSchema.parse({
  hand: "right",
  gripStyleStated: "claw",
  measurements: { handLengthMm: 190, palmLengthMm: 108, palmWidthMm: 84 },
  calibration: {
    markerIds: [0, 1, 2, 3],
    reprojectionErrorMm: 0.4,
    cardScaleRatio: 1.004,
    parallaxCorrected: true,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
});

test("an anonymous scan's results survive navigation and reload, and delete removes them", async ({
  page,
}) => {
  await page.goto("/scan");
  const body = await page.evaluate(
    async ({ path, payload }) => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status !== 201) throw new Error(`submit returned ${res.status}`);
      return res.json();
    },
    { path: SCAN_SUBMIT_PATH, payload: submission },
  );
  const { scanId: scanA } = scanSubmitResponseSchema.parse(body);
  const secondBody = await page.evaluate(
    async ({ path, payload }) => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status !== 201)
        throw new Error(`second submit returned ${res.status}`);
      return res.json();
    },
    { path: SCAN_SUBMIT_PATH, payload: submission },
  );
  const { scanId } = scanSubmitResponseSchema.parse(secondBody);
  expect(scanId).not.toBe(scanA);

  // A full navigation, as following a link or a bookmark does. This is the
  // step the beacon broke: leaving /scan fired `pagehide`.
  await page.goto(resultsPagePath(scanId));
  await expectTopPickShown(page);

  await page.reload();
  await expectTopPickShown(page);

  await page.getByRole("button", { name: "Delete this scan now" }).click();
  await page.getByRole("button", { name: "Delete scan" }).click();
  await expect(
    page.getByRole("heading", { name: "This scan has been deleted" }),
  ).toBeVisible();

  const status = await page.evaluate(
    async (path) =>
      (
        await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
    fitPath(scanId),
  );
  expect(status).toBe(404);

  // The same browser cookie still owns A. Deleting B must leave A and the
  // session intact, through the deployment's real route and database.
  await page.goto(resultsPagePath(scanA));
  await expectTopPickShown(page);
  await page.reload();
  await expectTopPickShown(page);
});
