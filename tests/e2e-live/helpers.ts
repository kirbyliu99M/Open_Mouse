import { expect, type Page } from "@playwright/test";
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
} from "../../src/lib/contracts/measurement";
import {
  fitPath,
  SCAN_SUBMIT_PATH,
  scanPath,
  scanSubmitResponseSchema,
} from "../../src/lib/contracts/routes";

/**
 * Shared by the live specs. Nothing here is mocked: it talks to the
 * deployment's real routes and database.
 */

/** A fixed, plausible right hand. */
export const submission = scanSubmissionSchema.parse({
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

/**
 * Submits one anonymous scan through the real API, from the page's own
 * browser context (so the session cookie it gets is the page's). The id is
 * pushed onto `created` at once, so `deleteScans` can remove it even when a
 * later step of the test fails.
 */
export async function submitScan(
  page: Page,
  created: string[],
): Promise<string> {
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
  const { scanId } = scanSubmitResponseSchema.parse(body);
  created.push(scanId);
  return scanId;
}

/**
 * Deletes the scans a test made, with the product's own delete API and the
 * page's browser context (it owns them). Meant for `test.afterEach`, so a
 * failed test leaves nothing behind in production.
 *
 * The delete route answers 404 both for a scan that is gone and for one that
 * is not this cookie's, so a 404 is fine only for a scan the test itself
 * deleted through the page (`deletedViaUi`). For any other id a 404, like any
 * status but 204, is reported with `console.warn` naming the id: it may be a
 * scan left behind. Nothing here throws, so one failure does not stop the
 * others from being deleted.
 */
export async function deleteScans(
  page: Page,
  created: readonly string[],
  deletedViaUi: ReadonlySet<string> = new Set(),
): Promise<void> {
  for (const scanId of created) {
    try {
      const res = await page.request.delete(scanPath(scanId));
      const status = res.status();
      if (status === 204) continue;
      if (status === 404 && deletedViaUi.has(scanId)) continue;
      console.warn(
        `cleanup: DELETE ${scanId} returned ${status}` +
          (status === 404
            ? " (gone, or not this cookie's: the scan may still be there)"
            : ""),
      );
    } catch (error) {
      console.warn(`cleanup: DELETE ${scanId} failed: ${String(error)}`);
    }
  }
}

/**
 * Deletes the scan the way a person does ("Delete this scan now", then
 * "Delete scan"), checks the page says so, records the id in `deletedViaUi`
 * (for `deleteScans`), and checks the fit route now answers 404.
 */
export async function deleteViaUi(
  page: Page,
  scanId: string,
  deletedViaUi: Set<string>,
): Promise<void> {
  await page.getByRole("button", { name: "Delete this scan now" }).click();
  await page.getByRole("button", { name: "Delete scan" }).click();
  await expect(
    page.getByRole("heading", { name: "This scan has been deleted" }),
  ).toBeVisible();
  deletedViaUi.add(scanId);

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
}

/**
 * The results page has rendered its top pick: the rank-1 line ("#1 · <brand>"),
 * a whole-number score, and that score's label. The browser here is English
 * (the page shows zh-TW only to a Chinese browser), so the label is
 * "fit score / 100". This replaces the old page's "Best match" heading.
 */
export async function expectTopPickShown(page: Page) {
  await expect(page.locator(".results-score-rank")).toHaveText(/^#1 · \S/);
  await expect(page.locator(".results-score-value")).toHaveText(/^\d{1,3}$/);
  await expect(page.getByText("fit score / 100")).toBeVisible();
}
