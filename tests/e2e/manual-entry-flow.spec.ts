import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Typing the hand length and width instead of scanning, wired into the real
 * easy scan (`/scan/easy`; candidate, 2026-10-12):
 *
 *   phone  : camera screen -> the handle at the bottom -> the sheet (hand,
 *            length, width, 確認) -> the grip page with no 跳過 -> the thickness
 *            page (optional) -> POST
 *   desktop: the form next to the QR card (two columns wide, stacked below
 *            960 px) -> the same two pages -> POST
 *
 * The POST and the results' fit and analysis are stubbed. English strings: the
 * e2e locale is en-US. Phone tests run in the fake-camera project
 * (`chromium-camera-paper-edge`), desktop tests in `chromium`; run each spec
 * alone: `npx playwright test tests/e2e/manual-entry-flow.spec.ts
 * --project=<project> --workers=1`.
 */
const SCAN_ID = "723e4567-e89b-12d3-a456-426614174099";
const OTHER_SCAN_ID = "823e4567-e89b-12d3-a456-426614174098";
const KEY = (id: string) => `open-mouse:manual-entry:${id}`;

const fitFixture: unknown = JSON.parse(
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
const ANALYSIS = {
  output: {
    headline: "A close match",
    whyTopPick: "The length and grip width land close to your ideal.",
    tradeoffs: ["It runs slightly heavier than you prefer."],
    whatToAvoid: ["Mice with an aggressive back hump."],
    caveats: [],
  },
  source: "fallback",
  cached: false,
};

/** Collects every POST to /api/scans; `answer` decides the response. */
async function captureScans(
  page: Page,
  answer: (n: number) => { status: number; body: unknown } = () => ({
    status: 201,
    body: { scanId: SCAN_ID },
  }),
) {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/scans", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    bodies.push(JSON.parse(route.request().postData() ?? "{}"));
    const { status, body } = answer(bodies.length);
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  return bodies;
}

async function stubResults(page: Page, scanId: string) {
  await page.route(`**/api/scans/${scanId}/fit`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fitFixture),
    }),
  );
  await page.route(`**/api/scans/${scanId}/analysis`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ANALYSIS),
    }),
  );
}

const entrySheet = (page: Page) =>
  page.getByRole("dialog", { name: "Enter your hand size" });
const gripPage = (page: Page) =>
  page.getByRole("dialog", { name: "How you hold a mouse" });
const thicknessPage = (page: Page) =>
  page.getByRole("dialog", { name: "Palm thickness" });
const handle = (page: Page) =>
  page.getByRole("button", { name: /Enter your hand size/ });
const panel = (page: Page) => page.getByTestId("manual-entry-panel");

async function typePair(
  scope: Locator,
  hand: "Left hand" | "Right hand",
  length: string,
  width: string,
) {
  await scope.getByLabel("Hand length").fill(length);
  await scope.getByLabel("Hand width").fill(width);
  await scope.getByRole("radio", { name: hand }).check();
}

/** The exact shape of a typed pair's POST (no photo, no scan-only field). */
function expectManualShape(
  body: Record<string, unknown>,
  expected: { grip: string; thickness?: string },
) {
  expect(Object.keys(body).sort()).toEqual(
    [
      "calibration",
      "gripStyleStated",
      "hand",
      "measurementModelVersion",
      "measurements",
      ...(expected.thickness ? ["palmThicknessStated"] : []),
    ].sort(),
  );
  expect(body.hand).toBe("right");
  expect(body.gripStyleStated).toBe(expected.grip);
  if (expected.thickness)
    expect(body.palmThicknessStated).toBe(expected.thickness);
  expect(Object.keys(body.measurements as object).sort()).toEqual([
    "handLengthMm",
    "palmLengthMm",
    "palmWidthMm",
  ]);
  expect(body.measurements).toMatchObject({
    handLengthMm: 185,
    palmWidthMm: 82,
  });
  expect(body.calibration).toMatchObject({
    method: "manual-entry",
    handLengthMm: 185,
    handWidthMm: 82,
    palmLengthEstimated: true,
  });
  expect(JSON.stringify(body)).not.toContain("indexLengthMm");
}

test.describe("phone: the handle, the sheet, the grip and thickness pages", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    void page;
    test.skip(
      testInfo.project.name !== "chromium-camera-paper-edge",
      "Needs the fake-camera project.",
    );
  });

  async function openCameraAndHandle(page: Page) {
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    // Early: before the auto-shutter has anything to take.
    await expect(handle(page)).toBeVisible();
    await handle(page).click();
    await expect(entrySheet(page)).toBeVisible();
  }

  /**
   * A real finger on the handle, through CDP touch events (a tap that wobbles):
   * touch down on the handle's centre, move by each step in turn, lift. Counts
   * how many times the entry sheet is opened (showModal), to catch a second
   * open.
   */
  async function touchGesture(page: Page, steps: { dx: number; dy: number }[]) {
    await page.addInitScript(() => {
      const w = window as unknown as { __dialogAdds: number };
      w.__dialogAdds = 0;
      const original = HTMLDialogElement.prototype.showModal;
      HTMLDialogElement.prototype.showModal = function () {
        // Only the entry sheet: the first-run tip is a modal dialog too.
        if (this.dataset.testid === "manual-entry-sheet") w.__dialogAdds++;
        return original.call(this);
      };
    });
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(handle(page)).toBeVisible();
    const box = await handle(page).boundingBox();
    if (!box) throw new Error("the handle has no box");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const at = (dx: number, dy: number) => [{ x: x + dx, y: y + dy }];
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: at(0, 0),
    });
    for (const s of steps)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: at(s.dx, s.dy),
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  const dialogAdds = (page: Page) =>
    page.evaluate(
      () => (window as unknown as { __dialogAdds: number }).__dialogAdds,
    );

  test("a tap with 10 px of sideways jitter opens the sheet, once", async ({
    page,
  }) => {
    await touchGesture(page, [
      { dx: 4, dy: 0 },
      { dx: 10, dy: 0 },
    ]);
    await expect(entrySheet(page)).toBeVisible();
    // Give a second (wrongly doubled) open time to show up.
    await page.waitForTimeout(600);
    await expect(entrySheet(page)).toBeVisible();
    expect(await dialogAdds(page)).toBe(1);
  });

  test("a tap with 12 px of upward jitter opens the sheet, once", async ({
    page,
  }) => {
    await touchGesture(page, [
      { dx: 0, dy: -6 },
      { dx: 0, dy: -12 },
    ]);
    await expect(entrySheet(page)).toBeVisible();
    await page.waitForTimeout(600);
    await expect(entrySheet(page)).toBeVisible();
    expect(await dialogAdds(page)).toBe(1);
  });

  test("a 12 px downward wiggle does not open the sheet", async ({ page }) => {
    await touchGesture(page, [
      { dx: 0, dy: 6 },
      { dx: 0, dy: 12 },
    ]);
    await page.waitForTimeout(600);
    await expect(entrySheet(page)).toHaveCount(0);
    expect(await dialogAdds(page)).toBe(0);
  });

  test("handle -> sheet -> grip with no Skip -> thickness skipped -> the POST is exactly the manual-entry shape", async ({
    page,
  }) => {
    const bodies = await captureScans(page);
    await stubResults(page, SCAN_ID);
    await openCameraAndHandle(page);
    await typePair(entrySheet(page), "Right hand", "18.5", "8.2");
    await entrySheet(page).getByRole("button", { name: "Confirm" }).click();

    // The grip page is the required one: no Skip, Confirm waits for a choice.
    await expect(gripPage(page)).toBeVisible();
    await expect(
      gripPage(page).getByRole("button", { name: "Skip" }),
    ).toHaveCount(0);
    await expect(
      gripPage(page).getByRole("button", { name: "Confirm" }),
    ).toBeDisabled();
    await gripPage(page).getByRole("radio", { name: /^Claw/ }).check();
    await gripPage(page).getByRole("button", { name: "Confirm" }).click();

    await expect(thicknessPage(page)).toBeVisible();
    await thicknessPage(page)
      .getByRole("button", { name: "Skip and see results" })
      .click();
    await expect.poll(() => bodies.length).toBe(1);
    expectManualShape(bodies[0], { grip: "claw" });
    expect(bodies[0]).not.toHaveProperty("palmThicknessStated");
    await expect(page).toHaveURL(new RegExp(`/results/${SCAN_ID}`), {
      timeout: 30_000,
    });
    // The disclosure key is written after the 201.
    expect(
      await page.evaluate((key) => localStorage.getItem(key), KEY(SCAN_ID)),
    ).toBe(JSON.stringify({ handLengthMm: 185, handWidthMm: 82 }));
    // ...and the results page says so, in the typed numbers.
    await expect(
      page.getByText(
        "Estimated from the hand length of 18.5 cm and hand width of 8.2 cm you entered; palm length is an estimate.",
      ),
    ).toBeVisible();
  });

  test("with a thickness chosen the POST carries it", async ({ page }) => {
    const bodies = await captureScans(page);
    await stubResults(page, SCAN_ID);
    await openCameraAndHandle(page);
    await typePair(entrySheet(page), "Right hand", "18.5", "8.2");
    await entrySheet(page).getByRole("button", { name: "Confirm" }).click();
    await gripPage(page).getByRole("radio", { name: /^Palm/ }).check();
    await gripPage(page).getByRole("button", { name: "Confirm" }).click();
    await thicknessPage(page)
      .getByRole("radio", { name: /^Thick/ })
      .check();
    await thicknessPage(page)
      .getByRole("button", { name: "See results", exact: true })
      .click();
    await expect.poll(() => bodies.length).toBe(1);
    expectManualShape(bodies[0], { grip: "palm", thickness: "thick" });
  });

  test("Back from the grip page returns to the sheet with the draft kept, and the answers survive another round", async ({
    page,
  }) => {
    await openCameraAndHandle(page);
    await typePair(entrySheet(page), "Right hand", "18.5", "8.2");
    await entrySheet(page).getByRole("button", { name: "Confirm" }).click();
    await gripPage(page)
      .getByRole("radio", { name: /^Fingertip/ })
      .check();
    await gripPage(page).getByRole("button", { name: "Back" }).click();
    await expect(entrySheet(page)).toBeVisible();
    await expect(gripPage(page)).toBeHidden();
    await expect(entrySheet(page).getByLabel("Hand length")).toHaveValue(
      "18.5",
    );
    await expect(entrySheet(page).getByLabel("Hand width")).toHaveValue("8.2");
    await expect(
      entrySheet(page).getByRole("radio", { name: "Right hand" }),
    ).toBeChecked();
    // Edit a number and go on: the grip chosen before is still chosen.
    await entrySheet(page).getByLabel("Hand width").fill("8.4");
    await entrySheet(page).getByRole("button", { name: "Confirm" }).click();
    await expect(
      gripPage(page).getByRole("radio", { name: /^Fingertip/ }),
    ).toBeChecked();
  });

  test("closing the sheet by Cancel keeps the draft for the next time", async ({
    page,
  }) => {
    await openCameraAndHandle(page);
    await typePair(entrySheet(page), "Left hand", "19.0", "8.5");
    await entrySheet(page).getByRole("button", { name: "Cancel" }).click();
    await expect(entrySheet(page)).toBeHidden();
    await expect(handle(page)).toBeFocused();
    await handle(page).click();
    await expect(entrySheet(page).getByLabel("Hand length")).toHaveValue(
      "19.0",
    );
    await expect(
      entrySheet(page).getByRole("radio", { name: "Left hand" }),
    ).toBeChecked();
  });

  test("the camera waits while the sheet is open: no photo is taken behind it", async ({
    page,
  }) => {
    await openCameraAndHandle(page);
    // The fake camera's auto-shutter would fire within a few seconds.
    await page.waitForTimeout(5000);
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "none",
    );
    await expect(
      page.getByRole("dialog", { name: "Retake needed" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Hand measured" }),
    ).toHaveCount(0);
  });

  test("a failed send (500) writes no disclosure key", async ({ page }) => {
    await captureScans(page, () => ({ status: 500, body: { error: "boom" } }));
    await openCameraAndHandle(page);
    await typePair(entrySheet(page), "Right hand", "18.5", "8.2");
    await entrySheet(page).getByRole("button", { name: "Confirm" }).click();
    await gripPage(page).getByRole("radio", { name: /^Claw/ }).check();
    await gripPage(page).getByRole("button", { name: "Confirm" }).click();
    await thicknessPage(page)
      .getByRole("button", { name: "Skip and see results" })
      .click();
    await expect(thicknessPage(page).getByRole("alert")).toBeVisible();
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((k) =>
          k.startsWith("open-mouse:manual-entry:"),
        ),
      ),
    ).toEqual([]);
  });

  test("an invalid failure: no photo to retake, so the banner says Change the numbers and goes back to the sheet with the draft", async ({
    page,
  }) => {
    const bodies = await captureScans(page, () => ({
      status: 400,
      body: { error: "no" },
    }));
    await openCameraAndHandle(page);
    await typePair(entrySheet(page), "Right hand", "18.5", "8.2");
    await entrySheet(page).getByRole("button", { name: "Confirm" }).click();
    await gripPage(page).getByRole("radio", { name: /^Claw/ }).check();
    await gripPage(page).getByRole("button", { name: "Confirm" }).click();
    await thicknessPage(page).getByRole("radio", { name: /^Thin/ }).check();
    await thicknessPage(page)
      .getByRole("button", { name: "See results", exact: true })
      .click();
    await expect.poll(() => bodies.length).toBe(1);
    const dialog = thicknessPage(page);
    await expect(dialog.getByRole("alert")).toContainText(
      "These numbers weren't saved. Check them",
    );
    await expect(dialog.getByRole("alert")).not.toContainText("photo");
    await expect(
      dialog.getByRole("button", { name: "Retake photo" }),
    ).toHaveCount(0);
    await dialog.getByRole("button", { name: "Change the numbers" }).click();
    await expect(entrySheet(page)).toBeVisible();
    await expect(entrySheet(page).getByLabel("Hand length")).toHaveValue(
      "18.5",
    );
    // The answers given are still given.
    await entrySheet(page).getByRole("button", { name: "Confirm" }).click();
    await expect(
      gripPage(page).getByRole("radio", { name: /^Claw/ }),
    ).toBeChecked();
  });

  for (const [width, height] of [
    [390, 844],
    [360, 640],
  ] as const) {
    test(`${width}x${height}: the handle sits on the bottom edge, under the shutter, and the shutter stays on screen`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/scan/easy");
      await page.getByRole("button", { name: "Got it" }).click();
      await expect(handle(page)).toBeVisible();
      const h = (await handle(page).boundingBox())!;
      const shutter = (await page
        .getByRole("button", { name: "Take photo" })
        .boundingBox())!;
      await page.screenshot({
        path: test.info().outputPath(`handle-${width}x${height}.png`),
      });
      expect(Math.round(h.y + h.height)).toBe(height);
      expect(h.height).toBeGreaterThanOrEqual(44);
      expect(shutter.y + shutter.height).toBeLessThanOrEqual(h.y);
      expect(shutter.y).toBeGreaterThanOrEqual(0);
    });
  }
});

test.describe("desktop: the form next to the QR card", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== "chromium", "Desktop project only.");
  });

  test("two columns when wide: the QR card on the left, the form on the right", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/scan/easy");
    await expect(
      page.getByRole("heading", {
        name: "Scan your hand, or enter your size",
        level: 1,
      }),
    ).toBeVisible();
    const card = (await page.locator(".easyDeviceScanCard").boundingBox())!;
    const form = (await panel(page).boundingBox())!;
    expect(card.x + card.width).toBeLessThanOrEqual(form.x);
    expect(Math.abs(card.y - form.y)).toBeLessThan(4);
    // No pull-up handle on a desktop.
    await expect(handle(page)).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("desktop-1280.png"),
    });
  });

  test("stacked below 960 px: the card, then the form", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto("/scan/easy");
    await expect(panel(page)).toBeVisible();
    const card = (await page.locator(".easyDeviceScanCard").boundingBox())!;
    const form = (await panel(page).boundingBox())!;
    expect(form.y).toBeGreaterThanOrEqual(card.y + card.height - 1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath("desktop-800.png"),
      fullPage: true,
    });
  });

  test("type, confirm, grip (no Skip), thickness, POST in the manual-entry shape", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const bodies = await captureScans(page);
    await stubResults(page, SCAN_ID);
    await page.goto("/scan/easy");
    await typePair(panel(page), "Right hand", "18.5", "8.2");
    await panel(page).getByRole("button", { name: "Confirm" }).click();
    await expect(gripPage(page)).toBeVisible();
    await expect(
      gripPage(page).getByRole("button", { name: "Skip" }),
    ).toHaveCount(0);
    await gripPage(page)
      .getByRole("radio", { name: /^Fingertip/ })
      .check();
    await gripPage(page).getByRole("button", { name: "Confirm" }).click();
    await thicknessPage(page)
      .getByRole("radio", { name: /^Medium/ })
      .check();
    await thicknessPage(page)
      .getByRole("button", { name: "See results", exact: true })
      .click();
    await expect.poll(() => bodies.length).toBe(1);
    expectManualShape(bodies[0], { grip: "fingertip", thickness: "medium" });
    await expect(page).toHaveURL(new RegExp(`/results/${SCAN_ID}`), {
      timeout: 30_000,
    });
    expect(
      await page.evaluate((key) => localStorage.getItem(key), KEY(SCAN_ID)),
    ).toBe(JSON.stringify({ handLengthMm: 185, handWidthMm: 82 }));
  });

  test("Back from the grip page leaves the panel as it was; a 500 writes no key; a scan's results have no manual-entry line", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await captureScans(page, () => ({ status: 500, body: { error: "boom" } }));
    await stubResults(page, OTHER_SCAN_ID);
    await page.goto("/scan/easy");
    await typePair(panel(page), "Left hand", "19.0", "8.5");
    await panel(page).getByRole("button", { name: "Confirm" }).click();
    await gripPage(page).getByRole("button", { name: "Back" }).click();
    await expect(gripPage(page)).toBeHidden();
    await expect(panel(page).getByLabel("Hand length")).toHaveValue("19.0");
    await expect(panel(page).getByLabel("Hand width")).toHaveValue("8.5");
    await panel(page).getByRole("button", { name: "Confirm" }).click();
    await gripPage(page).getByRole("radio", { name: /^Palm/ }).check();
    await gripPage(page).getByRole("button", { name: "Confirm" }).click();
    await thicknessPage(page)
      .getByRole("button", { name: "Skip and see results" })
      .click();
    await expect(thicknessPage(page).getByRole("alert")).toBeVisible();
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((k) =>
          k.startsWith("open-mouse:manual-entry:"),
        ),
      ),
    ).toEqual([]);
    // A scan that was not typed: its results page shows no such line.
    await page.goto(`/results/${OTHER_SCAN_ID}`);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByText(/you entered; palm length/)).toHaveCount(0);
  });
});

test.describe("phone: where the camera cannot be used, typing the size is still there", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    void page;
    test.skip(
      testInfo.project.name !== "chromium-camera-paper-edge",
      "Needs the phone project.",
    );
  });

  const SCENARIOS = [
    [
      "permission refused",
      ".cameraErrorCard",
      () =>
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
          configurable: true,
          value: () =>
            Promise.reject(new DOMException("denied", "NotAllowedError")),
        }),
    ],
    [
      "no camera at all",
      ".easyScanNoCamera",
      () =>
        Object.defineProperty(navigator, "mediaDevices", {
          configurable: true,
          value: undefined,
        }),
    ],
  ] as const;

  for (const [name, screen, script] of SCENARIOS) {
    test(`${name}: the handle is on the screen, and the whole flow (sheet, required grip, thickness, POST) works`, async ({
      page,
    }) => {
      const bodies = await captureScans(page);
      await stubResults(page, SCAN_ID);
      await page.addInitScript(script);
      await page.goto("/scan/easy");
      await page.getByRole("button", { name: "Got it" }).click();
      await expect(page.locator(screen)).toBeVisible();
      await expect(handle(page)).toBeVisible();
      const h = (await handle(page).boundingBox())!;
      expect(Math.round(h.y + h.height)).toBe(844);
      expect(h.height).toBeGreaterThanOrEqual(44);
      await handle(page).click();
      await typePair(entrySheet(page), "Right hand", "18.5", "8.2");
      await entrySheet(page).getByRole("button", { name: "Confirm" }).click();
      await expect(
        gripPage(page).getByRole("button", { name: "Skip" }),
      ).toHaveCount(0);
      await gripPage(page).getByRole("radio", { name: /^Claw/ }).check();
      await gripPage(page).getByRole("button", { name: "Confirm" }).click();
      await thicknessPage(page)
        .getByRole("button", { name: "Skip and see results" })
        .click();
      await expect.poll(() => bodies.length).toBe(1);
      expectManualShape(bodies[0], { grip: "claw" });
    });
  }

  test("Cancel returns focus to the handle on the refused-permission screen too", async ({
    page,
  }) => {
    await page.addInitScript(SCENARIOS[0][2]);
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    await handle(page).click();
    await entrySheet(page).getByRole("button", { name: "Cancel" }).click();
    await expect(entrySheet(page)).toBeHidden();
    await expect(handle(page)).toBeFocused();
  });

  test("on its side (844x390) the shutter and the handle are both on the screen and do not overlap", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(handle(page)).toBeVisible();
    const h = (await handle(page).boundingBox())!;
    const shutter = (await page
      .getByRole("button", { name: "Take photo" })
      .boundingBox())!;
    await page.screenshot({
      path: test.info().outputPath("landscape-844x390.png"),
    });
    for (const [what, b] of [
      ["handle", h],
      ["shutter", shutter],
    ] as const) {
      expect(b.x, `${what} left`).toBeGreaterThanOrEqual(0);
      expect(b.y, `${what} top`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${what} right`).toBeLessThanOrEqual(844);
      expect(b.y + b.height, `${what} bottom`).toBeLessThanOrEqual(390);
    }
    // One above the other, never across.
    expect(shutter.y + shutter.height).toBeLessThanOrEqual(h.y);
    // The strip is one compact line there (no bar, no padding).
    expect(h.height).toBeLessThanOrEqual(56);
  });
});

test.describe("desktop: the panel's colours, focus and the required grip page", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== "chromium", "Desktop project only.");
  });

  /** A computed colour as [r, g, b] (0-255): `rgb()`, or `color(srgb ...)` from a color-mix. */
  const channels = (css: string): number[] => {
    const nums = (css.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    return css.startsWith("color(srgb") ? nums.map((n) => n * 255) : nums;
  };
  const luminance = ([r, g, b]: number[]) => {
    const f = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (fg: string, bg: string) => {
    const [a, b] = [luminance(channels(fg)), luminance(channels(bg))].sort(
      (x, y) => y - x,
    );
    return (a + 0.05) / (b + 0.05);
  };

  test("an error line in the panel is red, not the page's muted grey, and reads at 4.5:1", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/scan/easy");
    await panel(page).getByLabel("Hand length").fill("5");
    await panel(page).getByLabel("Hand width").focus();
    const error = panel(page).locator(".manualEntry-error").first();
    await expect(error).toBeVisible();
    const style = await error.evaluate((el) => {
      const own = getComputedStyle(el);
      const surface = getComputedStyle(
        el.closest("[data-testid='manual-entry-panel']")!,
      );
      return { color: own.color, background: surface.backgroundColor };
    });
    // The frame's red (--me-error #ff9d90), not --scan-muted (#b5b5bd).
    expect(style.color).toBe("rgb(255, 157, 144)");
    expect(ratio(style.color, style.background)).toBeGreaterThanOrEqual(4.5);
    // The scan card's lines keep the muted grey.
    const muted = await page
      .locator(".easyDeviceScanCard p")
      .first()
      .evaluate((el) => getComputedStyle(el).color);
    expect(muted).toBe("rgb(181, 181, 189)");
  });

  test("the required grip page says why, and Confirm pressed with nothing chosen says what is missing", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/scan/easy");
    await typePair(panel(page), "Right hand", "18.5", "8.2");
    await panel(page).getByRole("button", { name: "Confirm" }).click();
    const grip = gripPage(page);
    await expect(
      grip.getByText("Without a photo we can't tell, so please choose one."),
    ).toBeVisible();
    const confirm = grip.getByRole("button", { name: "Confirm" });
    // Not a silent `disabled`: it says it is unavailable and where to read why.
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await expect(confirm).not.toHaveAttribute("disabled", "");
    await expect(confirm).toHaveAccessibleDescription(
      "Choose a grip to continue.",
    );
    // aria-disabled stays pressable (Playwright's own actionability refuses it).
    await confirm.click({ force: true });
    await expect(grip.getByRole("alert")).toHaveText(
      "Choose a grip to continue.",
    );
    await expect(grip).toBeVisible();
    await grip.getByRole("radio", { name: /^Palm/ }).check();
    await expect(grip.getByRole("alert")).toHaveCount(0);
    await expect(confirm).not.toHaveAttribute("aria-disabled", "true");
    await confirm.click();
    await expect(thicknessPage(page)).toBeVisible();
  });

  test("Back from the grip page puts focus on the panel's heading, not on the page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/scan/easy");
    await typePair(panel(page), "Left hand", "19.0", "8.5");
    await panel(page).getByRole("button", { name: "Confirm" }).click();
    await gripPage(page).getByRole("button", { name: "Back" }).click();
    await expect(gripPage(page)).toBeHidden();
    await expect(
      panel(page).getByRole("heading", { name: "Enter your hand size" }),
    ).toBeFocused();
    // Escape on the grip page does the same.
    await panel(page).getByRole("button", { name: "Confirm" }).click();
    await expect(gripPage(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(gripPage(page)).toBeHidden();
    await expect(
      panel(page).getByRole("heading", { name: "Enter your hand size" }),
    ).toBeFocused();
  });

  test("Change the numbers (after a failed send) puts focus on the panel's heading", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await captureScans(page, () => ({ status: 400, body: { error: "no" } }));
    await page.goto("/scan/easy");
    await typePair(panel(page), "Right hand", "18.5", "8.2");
    await panel(page).getByRole("button", { name: "Confirm" }).click();
    await gripPage(page).getByRole("radio", { name: /^Claw/ }).check();
    await gripPage(page).getByRole("button", { name: "Confirm" }).click();
    await thicknessPage(page)
      .getByRole("button", { name: "Skip and see results" })
      .click();
    const dialog = thicknessPage(page);
    await expect(dialog.getByRole("alert")).toContainText(
      "These numbers weren't saved",
    );
    await dialog.getByRole("button", { name: "Change the numbers" }).click();
    await expect(thicknessPage(page)).toBeHidden();
    await expect(
      panel(page).getByRole("heading", { name: "Enter your hand size" }),
    ).toBeFocused();
    await expect(panel(page).getByLabel("Hand length")).toHaveValue("18.5");
  });
});
