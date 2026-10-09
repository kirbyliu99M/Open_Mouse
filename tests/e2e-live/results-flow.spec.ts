import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { fitPath, resultsPagePath } from "../../src/lib/contracts/routes";
import { EXCLUSION_REASONS } from "../../src/lib/contracts/fit";
import { en } from "../../src/lib/copy/results-page";
import {
  deleteScans,
  deleteViaUi,
  expectTopPickShown,
  submitScan,
} from "./helpers";

/**
 * The results flow of the new page, against the deployment's real routes and
 * database (nothing is mocked): top pick, a rank 2 detail page and back (the
 * fit is requested once), Details, Other mice and its excluded rows, the share
 * card, a reload, then delete.
 *
 * The scan is deleted afterwards, also when a step fails (`afterEach`, with the
 * product's own delete API and this browser context). The browser is English,
 * so the English words are the ones checked.
 */
const created: string[] = [];
const deletedViaUi = new Set<string>();

test.afterEach(async ({ page }) => {
  await deleteScans(page, created, deletedViaUi);
  created.length = 0;
  deletedViaUi.clear();
});

test("main page, a detail page and back, Details, Other mice, share card, reload, delete", async ({
  page,
}) => {
  // Make the share path deterministic: the browser says it cannot share
  // files, so the card is downloaded (a native share sheet cannot be driven).
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
  });

  const scanId = await submitScan(page, created);
  const main = resultsPagePath(scanId);

  // How many times the page asks for the fit.
  let fitRequests = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === fitPath(scanId)
    )
      fitRequests += 1;
  });

  // 1. The top pick.
  await page.goto(main);
  await expectTopPickShown(page);
  await expect(page).toHaveTitle(/^Your results/);
  expect(fitRequests).toBe(1);

  // 2. The first card under "Other picks": rank 2, on its own page and title.
  await expect(
    page.getByRole("heading", { level: 2, name: "Other picks" }),
  ).toBeVisible();
  const firstCard = page.locator(".results-others .results-card").first();
  const href = await firstCard.getAttribute("href");
  expect(href).toMatch(new RegExp(`^${main}/m/[a-z0-9-]+$`));
  await firstCard.click();
  await expect(page).toHaveURL(new RegExp(`${main}/m/[a-z0-9-]+$`));
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.locator(".results-score-rank")).toHaveText(/^#2 · \S/);
  await expect(page).toHaveTitle(/^Another pick/);

  // 3. Back: the main page again, and no second fit request.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${main}$`));
  await expectTopPickShown(page);
  await expect(page).toHaveTitle(/^Your results/);
  expect(fitRequests).toBe(1);

  // 4. Details: the six sub-scores.
  const details = page.locator(".results-details");
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").click();
  const bars = details.locator(".results-subscoreBar");
  await expect(bars).toHaveCount(6);
  for (let i = 0; i < 6; i++) await expect(bars.nth(i)).toBeVisible();

  // 5. Other mice, and the excluded rows when the response has any.
  const others = page.locator(".results-otherMice");
  if ((await others.count()) === 0) {
    test.info().annotations.push({
      type: "skipped check",
      description:
        "The response has no mice past the top five and none excluded, so there is no Other mice section.",
    });
  } else {
    await others.locator("summary").click();
    const excluded = page.locator(".results-excluded-list li");
    const excludedCount = await excluded.count();
    if (excludedCount === 0) {
      test.info().annotations.push({
        type: "skipped check",
        description:
          "The response has no excluded mice, so the reason and label check was skipped.",
      });
    } else {
      // The scan is a right hand: the exact English words the page may show.
      const reasons = EXCLUSION_REASONS.map((r) =>
        en.excludedReason(r, "right"),
      );
      const mirrorLabel = en.excludedMirrorLabel("right"); // "as a right-hand shape:"
      for (let i = 0; i < excludedCount; i++) {
        const row = excluded.nth(i);
        // Every excluded row says why, in one of the three exact texts.
        const reason = (
          await row.locator(".results-excluded-reason").innerText()
        ).trim();
        expect(reasons, `row ${i} reason "${reason}"`).toContain(reason);
        // A number, when there is one, follows exactly the right-hand label,
        // and only a wrong-hand mouse carries one.
        const mirror = row.locator(".results-excluded-mirror");
        if ((await mirror.count()) > 0) {
          expect(reason).toBe(en.excludedReason("wrong_hand", "right"));
          await expect(mirror).toHaveText(
            new RegExp(String.raw`^${mirrorLabel}[\s\u00A0]+\d{1,3} / 100$`),
          );
        }
        // And a row with a number never shows a bare one.
        await expect(row.locator(".results-excluded-score")).toHaveCount(
          await mirror.count(),
        );
      }
    }
  }

  // 6. The share card: a PNG download that loads back at 1080 x 1920. On this
  // phone project the primary button is the one under Other mice.
  const primary = page.getByRole("button", { name: "Make my share card" });
  await expect(primary).toBeVisible();
  const download = page.waitForEvent("download");
  await primary.click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^palmate-.*\.png$/);
  const png = readFileSync(await file.path());
  const size = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    return [img.naturalWidth, img.naturalHeight];
  }, png.toString("base64"));
  expect(size).toEqual([1080, 1920]);
  await expect(page.locator(".shareCard-error")).toHaveCount(0);

  // 7. A reload keeps the results, and delete removes them.
  await page.reload();
  await expectTopPickShown(page);

  await deleteViaUi(page, scanId, deletedViaUi);
});
