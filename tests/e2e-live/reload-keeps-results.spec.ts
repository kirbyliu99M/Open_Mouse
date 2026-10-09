import { test, expect } from "@playwright/test";
import { resultsPagePath } from "../../src/lib/contracts/routes";
import {
  deleteScans,
  deleteViaUi,
  expectTopPickShown,
  submitScan,
} from "./helpers";

/**
 * Regression for #42: a `pagehide` beacon deleted the anonymous session on
 * every reload or full navigation, so results vanished on refresh. Nothing is
 * mocked here — this talks to the deployment's real routes and database.
 *
 * Every scan the test makes is deleted afterwards, also when it fails.
 */
const created: string[] = [];
const deletedViaUi = new Set<string>();

test.afterEach(async ({ page }) => {
  await deleteScans(page, created, deletedViaUi);
  created.length = 0;
  deletedViaUi.clear();
});

test("an anonymous scan's results survive navigation and reload, and delete removes them", async ({
  page,
}) => {
  const scanA = await submitScan(page, created);
  const scanId = await submitScan(page, created);
  expect(scanId).not.toBe(scanA);

  // A full navigation, as following a link or a bookmark does. This is the
  // step the beacon broke: leaving /scan fired `pagehide`.
  await page.goto(resultsPagePath(scanId));
  await expectTopPickShown(page);

  await page.reload();
  await expectTopPickShown(page);

  await deleteViaUi(page, scanId, deletedViaUi);

  // The same browser cookie still owns A. Deleting B must leave A and the
  // session intact, through the deployment's real route and database.
  await page.goto(resultsPagePath(scanA));
  await expectTopPickShown(page);
  await page.reload();
  await expectTopPickShown(page);
});
