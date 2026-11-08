/**
 * The hidden data-tester page (candidate 未拍板; contract
 * src/lib/contracts/tester.ts) in a real browser: code -> consent -> tape ->
 * conditions -> the real camera in tester mode -> result; a second shot whose
 * scan used another reference is not sent; a third is given up. Both tester
 * routes are mocked (page.route: no database, no Blob store), and
 * `/api/scans` must never be called.
 *
 * Runs on the fake-camera project only (paper-edge-full.y4m), on
 * `/scan/tester/demo`: the dev-only twin of `/scan/tester` whose camera
 * answers "measured" (on A4) for a REAL captured frame (the live-measured
 * demo's pipeline), so the prepared photo is a real JPEG from the camera.
 *
 *   PLAYWRIGHT_PORT=3217 npx playwright test tester-page \
 *     --project=chromium-camera-paper-edge --workers=1
 *
 * With `TESTER_SHOTS_DIR=<folder>` it also saves phone-size screenshots of
 * each step there (for review; never into the repository).
 */
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { TESTER_CONSENT_VERSION } from "../../src/lib/contracts/tester";
import { testerCopy as copy } from "../../src/lib/tester/copy";
import { inspectJpeg } from "../../src/lib/error-photo/jpeg";
import { scanTourCopy } from "../../src/lib/copy/scan-tour";
import { dismissFirstRun } from "./fixtures/first-run";

const DEMO = "/scan/tester/demo";

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(
    testInfo.project.name !== "chromium-camera-paper-edge",
    "Needs the fake-camera project (paper-edge-full.y4m).",
  );
});

test.describe.configure({ timeout: 180_000 });

/** The parts of a multipart/form-data body. */
function parseMultipart(body: Buffer, contentType: string) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) throw new Error(`no boundary in ${contentType}`);
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const parts = new Map<string, Buffer>();
  let at = body.indexOf(delimiter);
  while (at !== -1) {
    const start = at + delimiter.length;
    if (body.subarray(start, start + 2).toString() === "--") break;
    const next = body.indexOf(delimiter, start);
    if (next === -1) break;
    const chunk = body.subarray(start + 2, next - 2);
    const headerEnd = chunk.indexOf("\r\n\r\n");
    const name = /name="([^"]+)"/.exec(
      chunk.subarray(0, headerEnd).toString(),
    )?.[1];
    if (name) parts.set(name, chunk.subarray(headerEnd + 4));
    at = next;
  }
  return parts;
}

/** Screenshots for review when TESTER_SHOTS_DIR is set. */
async function shot(page: Page, name: string) {
  const dir = process.env.TESTER_SHOTS_DIR;
  if (!dir) return;
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: true });
}

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

async function chooseConditions(page: Page, names: readonly string[]) {
  for (const name of names)
    await page.getByRole("radio", { name, exact: true }).check();
}

/** Waits for the measured sheet (confirming the frame if asked) and taps 繼續. */
async function continueFromMeasured(page: Page) {
  const confirm = page.getByTestId("paper-adjust-confirm");
  const sheet = page.locator("dialog.easyResultSheet[open]");
  await expect(confirm.or(sheet).first()).toBeVisible({ timeout: 60_000 });
  if (await confirm.isVisible()) await confirm.click();
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await sheet.getByTestId("answers-continue-button").click();
}

test("code to a sent shot; a wrong reference is not sent; giving up sends no photo", async ({
  page,
}) => {
  const checks: unknown[] = [];
  const shots: {
    code: string;
    record: Record<string, unknown>;
    photo?: Buffer;
  }[] = [];
  let scansCalled = 0;
  await page.route("**/api/scans**", async (route) => {
    scansCalled++;
    await route.fulfill({ status: 500, body: "{}" });
  });
  await page.route("**/api/tester/check", async (route) => {
    checks.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ participant: "P07" }),
    });
  });
  await page.route("**/api/tester/shots", async (route) => {
    const request = route.request();
    const parts = parseMultipart(
      request.postDataBuffer() ?? Buffer.alloc(0),
      request.headers()["content-type"] ?? "",
    );
    const record = JSON.parse(parts.get("record")?.toString() ?? "{}");
    shots.push({
      code: parts.get("code")?.toString() ?? "",
      record,
      ...(parts.has("photo") ? { photo: parts.get("photo")! } : {}),
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ shotId: record.shotId }),
    });
  });

  // 1. Code.
  // The project runs as an English browser (locale en-US, playwright.config):
  // the page is zh-TW only all the same, and /en/ sends it to the bare URL.
  await page.goto(`/en${DEMO}`);
  await expect(page).toHaveURL(new RegExp(`${DEMO}$`));
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  await expect(page.getByTestId("tester-step-code")).toBeVisible();
  await expect(page.getByText(copy.stepOf(1, 6))).toBeVisible();
  await page.getByLabel(copy.code.label).fill("p07-k7q2m9");
  await shot(page, "1-code");
  await page.getByRole("button", { name: copy.code.submit }).click();
  await expect(page.getByTestId("tester-step-consent")).toBeVisible();
  expect(checks).toEqual([{ code: "P07-K7Q2M9" }]);
  await expect(page.getByText(copy.code.participant("P07"))).toBeVisible();

  // 2. Consent: agree gates the next step; the photo box starts unticked.
  const start = page.getByRole("button", { name: copy.consent.next });
  await expect(start).toBeDisabled();
  const photoBox = page.getByRole("checkbox", { name: copy.consent.photo });
  await expect(photoBox).not.toBeChecked();
  await shot(page, "2-consent");
  await page.getByRole("checkbox", { name: copy.consent.agree }).check();
  await photoBox.check();
  await start.click();

  // 3. Tape. An empty submit says what is missing and focuses it.
  await expect(page.getByTestId("tester-step-tape")).toBeVisible();
  await page.getByRole("button", { name: copy.tape.next }).click();
  await expect(page.getByText(copy.tape.handRequired)).toBeVisible();
  await expect(
    page.getByRole("radio", { name: copy.tape.left, exact: true }),
  ).toBeFocused();
  // Each box is named by its measure and measurer; A required, B and the
  // edge-to-edge width not.
  const box = (name: string) =>
    page.getByRole("textbox", { name, exact: true });
  await expect(
    box(`${copy.tape.handLength} ${copy.tape.measurerA} ${copy.tape.first}`),
  ).toHaveAttribute("aria-required", "true");
  await expect(
    box(`${copy.tape.handLength} ${copy.tape.measurerB} ${copy.tape.first}`),
  ).not.toHaveAttribute("aria-required", "true");
  await expect(
    box(`${copy.tape.palmWidthEdge} ${copy.tape.measurerAOnce}`),
  ).not.toHaveAttribute("aria-required", "true");
  await page.getByRole("radio", { name: copy.tape.right, exact: true }).check();
  const field = (id: string) => page.locator(`[data-field="${id}"]`);
  await field("handLength.a.first").fill("188");
  await field("handLength.a.second").fill("193");
  await expect(page.getByText(copy.tape.recheck)).toBeVisible();
  await field("handLength.a.second").fill("189");
  await expect(page.getByText(copy.tape.recheck)).toHaveCount(0);
  await field("palmWidth.a.first").fill("84");
  await field("palmWidth.a.second").fill("84.5");
  await field("palmWidth.b.first").fill("85");
  await field("palmWidth.b.second").fill("84");
  // Errors go as their fields are fixed.
  await expect(page.getByText(copy.tape.required)).toHaveCount(0);
  await expect(page.getByText(copy.tape.handRequired)).toHaveCount(0);
  await shot(page, "3-tape");
  await page.getByRole("button", { name: copy.tape.next }).click();

  // 4. Conditions (no card offered on a build without the card reference).
  await expect(page.getByTestId("tester-step-conditions")).toBeVisible();
  if (process.env.NEXT_PUBLIC_CARD_REFERENCE_ENABLED !== "1")
    await expect(
      page.getByRole("radio", { name: copy.conditions.references.card }),
    ).toHaveCount(0);
  await page.getByLabel(copy.conditions.phoneModel).fill("Pixel 8");
  // The photo choice from the consent page is shown, and can change, per shot.
  await expect(
    page.getByRole("checkbox", { name: copy.conditions.photo }),
  ).toBeChecked();
  await expect(page.getByText(copy.conditions.photoOn)).toBeVisible();
  await chooseConditions(page, [
    copy.conditions.surfaces.white,
    copy.conditions.lightings.daylight,
    copy.conditions.references.a4,
  ]);
  await shot(page, "4-conditions");
  await page.getByRole("button", { name: copy.conditions.start }).click();

  // 5. The real camera in tester mode. First visit: the tour's welcome says
  // the photo will be sent (the box was ticked), not "stays on the phone".
  await expect(
    page.getByTestId("scan-tour").getByText(copy.scan.photoNotice),
  ).toBeVisible({
    timeout: 30_000,
  });
  // The camera's own words are Chinese too.
  await expect(
    page.getByText(scanTourCopy("zh-TW").welcomeTitle, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(scanTourCopy("en").welcomeTitle, { exact: true }),
  ).toHaveCount(0);
  await shot(page, "5a-tour-welcome");
  await dismissFirstRun(page);
  const giveUp = page.getByTestId("tester-give-up");
  await expect(giveUp).toHaveText(copy.scan.giveUp);
  await expect(page.locator(".manualEntry-handle")).toHaveCount(0);
  // The declared reference as a plain chip: no menu, no toggle.
  await expect(page.getByTestId("tester-reference-chip")).toBeVisible();
  await expect(page.locator(".easyPaperToggle")).toHaveCount(0);
  await continueFromMeasured(page);

  // 6. Result: the comparison, then 已送出.
  await expect(page.getByTestId("tester-step-result")).toBeVisible();
  await expect(page.getByTestId("tester-send-status")).toHaveText(
    copy.result.sent,
    { timeout: 30_000 },
  );
  const diffs = page.getByTestId("tester-diff");
  await expect(diffs).toHaveCount(2);
  // Demo pipeline: 190 / 84 mm; tape averages 188.5 / 84.375.
  await expect(diffs.nth(0)).toHaveText(copy.result.mmValue("+1.5"));
  await expect(diffs.nth(1)).toHaveText(copy.result.mmValue("−0.4"));
  await shot(page, "6-result");

  expect(shots).toHaveLength(1);
  const sent = shots[0]!;
  expect(sent.code).toBe("P07-K7Q2M9");
  const r = sent.record;
  expect(r.consent).toBe(TESTER_CONSENT_VERSION);
  expect(r.tape).toEqual({
    hand: "right",
    handLength: { a: { first: 188, second: 189 } },
    palmWidth: { a: { first: 84, second: 84.5 }, b: { first: 85, second: 84 } },
  });
  expect(r).toMatchObject({
    phoneModel: "Pixel 8",
    surface: "white",
    lighting: "daylight",
    reference: "a4",
    deliberatelyPoor: false,
    captureMode: "camera",
    gaveUp: false,
    measured: {
      handLengthMm: 190,
      palmWidthMm: 84,
      calibrationMethod: "paper-edge",
    },
  });
  expect(r.attempts).toBeGreaterThanOrEqual(1);
  expect(r.firstTryOk).toBe(r.attempts === 1);
  // The photo: a clean JPEG of exactly the size the record states.
  expect(sent.photo).toBeDefined();
  const jpeg = inspectJpeg(new Uint8Array(sent.photo!));
  expect(jpeg.ok).toBe(true);
  if (jpeg.ok) {
    expect(jpeg.app1Segments).toBe(0);
    expect({ widthPx: jpeg.width, heightPx: jpeg.height }).toEqual(r.photo);
  }

  // 7. Next shot on Letter: the demo camera measures on A4, so the shot is
  // NOT sent and the page says why.
  await page.getByTestId("tester-next").click();
  await expect(page.getByTestId("tester-step-conditions")).toBeVisible();
  await expect(page.getByLabel(copy.conditions.phoneModel)).toHaveValue(
    "Pixel 8",
  );
  await chooseConditions(page, [
    copy.conditions.surfaces.wood,
    copy.conditions.lightings.dim,
    copy.conditions.references.letter,
  ]);
  await page.getByRole("button", { name: copy.conditions.start }).click();
  await expect(page.getByTestId("tester-reference-chip")).toBeVisible({
    timeout: 30_000,
  });
  // The A4 fixture never locks as a Letter sheet: take the shot by hand.
  await page.locator(".cameraShutter").click();
  await continueFromMeasured(page);
  await expect(page.getByTestId("tester-send-status")).toHaveText(
    copy.result.referenceMismatch,
  );
  // 再拍一次 after a shot that was not sent keeps the conditions.
  await expect(page.getByTestId("tester-result-table")).toHaveCount(0);
  expect(shots).toHaveLength(1);
  await page.getByTestId("tester-next").click();
  await expect(
    page.getByRole("radio", {
      name: copy.conditions.references.letter,
      exact: true,
    }),
  ).toBeChecked();
  await expect(page.getByTestId("tester-hand-reminder")).toHaveText(
    copy.conditions.handReminder(copy.tape.right),
  );

  // 8. Third shot on a 375 px phone: 這次放棄 sits in the top bar without
  // touching the hand chip or help, at least 44 px tall; giving up sends the
  // attempts and the tape, no photo and no measurement.
  await page.setViewportSize({ width: 375, height: 812 });
  await chooseConditions(page, [
    copy.conditions.surfaces.wood,
    copy.conditions.lightings.dim,
    copy.conditions.references.a4,
  ]);
  await page.getByRole("button", { name: copy.conditions.start }).click();
  await expect(giveUp).toBeVisible({ timeout: 30_000 });
  const pill = (await giveUp.boundingBox())!;
  expect(pill.height).toBeGreaterThanOrEqual(44);
  const others = await page
    .locator(".easyScanTopRight > *")
    .evaluateAll((els) =>
      els.map((el) => {
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      }),
    );
  expect(others.length).toBeGreaterThan(0);
  for (const other of others)
    if (other.width > 0) expect(overlaps(pill, other)).toBe(false);
  await shot(page, "5-scan-375");
  await giveUp.click();
  await expect(page.getByTestId("tester-step-giveUp")).toBeVisible();
  await expect(page.getByText(copy.giveUp.body)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "7-give-up");
  await page.getByTestId("tester-give-up-confirm").click();
  await expect(
    page.getByRole("heading", { name: copy.result.gaveUpTitle }),
  ).toBeVisible();
  await expect(page.getByTestId("tester-send-status")).toHaveText(
    copy.result.gaveUpSent,
  );
  await shot(page, "8-give-up-sent");
  expect(shots).toHaveLength(2);
  const gaveUp = shots[1]!;
  expect(gaveUp.photo).toBeUndefined();
  expect(gaveUp.record).toMatchObject({
    gaveUp: true,
    surface: "wood",
    lighting: "dim",
    reference: "a4",
    tape: r.tape,
  });
  expect(gaveUp.record.measured).toBeUndefined();
  expect(gaveUp.record.shotId).not.toBe(r.shotId);
  expect(scansCalled).toBe(0);
});
