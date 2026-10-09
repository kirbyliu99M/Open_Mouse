import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import { numberUnitPairs } from "./fixtures/number-unit";

/**
 * A measurement and its unit ("84 mm", "13 g") must never wrap onto two lines.
 * In a wide font (CI's, or a user's larger text) a plain space between them is
 * a place to break; a no-break space (U+00A0) is not. Each check squeezes the
 * element to 1px so every word has its own line (see fixtures/number-unit.ts), so it holds in
 * any font and does not depend on how wide this machine's font is.
 */

test("the probe tells a plain space from a no-break space", async ({
  page,
}) => {
  await page.setContent(
    `<p id="plain">about 84 mm wide</p><p id="joined">about 84\u00A0mm wide</p>`,
  );
  expect(await numberUnitPairs(page.locator("#plain"))).toEqual({
    pairs: 1,
    split: ["84 mm"],
  });
  expect(await numberUnitPairs(page.locator("#joined"))).toEqual({
    pairs: 1,
    split: [],
  });
});

async function expectWhole(page: Page, selector: string, atLeastPairs: number) {
  const { pairs, split } = await numberUnitPairs(page.locator(selector));
  expect(pairs, `${selector}: pairs found`).toBeGreaterThanOrEqual(
    atLeastPairs,
  );
  expect(split, `${selector}: pairs split over two lines`).toEqual([]);
}

test("/results/demo keeps millimetres and grams with their numbers", async ({
  page,
}) => {
  await page.goto("/results/demo");
  for (const fixture of [
    "High confidence",
    "Low confidence (nulls)",
    "With exclusions",
    "Many mice + hand type",
  ]) {
    await page.getByRole("button", { name: fixture, exact: true }).click();
    // The sentences and the weight sit in the Details section.
    const closed = page.locator(".results-disclosure:not([open]) > summary");
    while ((await closed.count()) > 0) await closed.first().click();
    // The sentences under each score ("Length is within 1.2 mm of your
    // ideal", "about 13 g heavier") and the weight beside each mouse.
    await expectWhole(page, ".results-subscoreBar-reason", 0);
    await expectWhole(page, ".results-mouseHeader-stats dd", 0);
  }
  // The first fixture really has some of each, so the loop above is not empty.
  await page.getByRole("button", { name: "High confidence" }).click();
  await expectWhole(page, ".results-subscoreBar-reason", 1);
  await expectWhole(page, ".results-mouseHeader-stats dd", 1);
});

const SCAN_ID = "a1b2c3d4-1111-4a2b-8c3d-9e0f1a2b3c4d";
const highConfidenceFixture: object = JSON.parse(
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
async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test("/results/[scanId] keeps the typed length with its unit", async ({
  page,
}) => {
  await page.route(`**/api/scans/${SCAN_ID}/fit`, (route) =>
    fulfillJson(route, 200, highConfidenceFixture),
  );
  await page.route(`**/api/scans/${SCAN_ID}/analysis`, (route) =>
    fulfillJson(route, 500, { error: "Unavailable" }),
  );
  await page.addInitScript(
    ([key]) => localStorage.setItem(key, "186"),
    [`open-mouse:user-length:${SCAN_ID}`],
  );
  await page.goto(`/results/${SCAN_ID}`);
  await expect(
    page.getByText(/Based on the hand length you entered/),
  ).toBeVisible();
  await expectWhole(page, ".results-handNotice", 1);
});

test("the measured sheet keeps its numbers with their units", async ({
  page,
}) => {
  await page.goto("/scan/easy/measured-demo");
  await expect(page.getByTestId("easy-sheet-numbers")).toBeVisible();
  await expectWhole(page, "[data-testid=easy-sheet-numbers]", 2);

  await page.goto("/scan/easy/measured-length-demo");
  await expect(page.getByTestId("easy-sheet-numbers")).toBeVisible();
  await expectWhole(page, "[data-testid=easy-sheet-numbers]", 2);
  // "Based on the hand length you entered (186 mm)"
  await expectWhole(page, ".easyLengthDisclosure p", 1);
});

test("the printed-sheet scan page keeps each measurement with its unit", async ({
  page,
}) => {
  await page.goto("/scan/measured-demo");
  await expect(page.getByTestId("scan-measurements")).toBeVisible();
  await expectWhole(page, "[data-testid=scan-measurements] dd", 1);
});

test("the hand-length step keeps '18.6 cm = 186 mm' together", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Uses the phone's tip dialog.");
  await page.goto("/scan/easy/length-failure-demo");
  await page
    .getByRole("dialog", { name: "One blank sheet is all you need" })
    .getByRole("button", { name: "No paper? Use a ruler instead" })
    .click();
  await expect(page.getByLabel("Hand length (mm)")).toBeVisible();
  await expectWhole(page, "#easy-length-hint", 2);
});

test("the retake message keeps the typed length with its unit", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Uses the upload path.");
  await page.goto("/scan/easy/length-failure-demo");
  await page
    .getByRole("dialog", { name: "One blank sheet is all you need" })
    .getByRole("button", { name: "No paper? Use a ruler instead" })
    .click();
  await page.getByLabel("Hand length (mm)").fill("186");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("#easy-scan-upload").setInputFiles({
    name: "hand.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  });
  const sheet = page.getByRole("dialog", { name: "Retake needed" });
  await expect(sheet.locator(".easySheetErrorMessage")).toContainText(
    "186 mm you entered",
  );
  await expectWhole(page, ".easySheetErrorMessage", 1);
});
