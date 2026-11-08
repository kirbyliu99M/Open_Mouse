/**
 * The hidden data-tester page (candidate 未拍板; contract
 * src/lib/contracts/tester.ts) in a real browser, happy path: code ->
 * consent -> tape -> conditions -> the real camera in tester mode -> result
 * -> next shot keeps the tape and the phone model. Both tester routes are
 * mocked (page.route: no database, no Blob store), and `/api/scans` must
 * never be called.
 *
 * Runs on the fake-camera project only (paper-edge-full.y4m), on
 * `/scan/tester/demo`: the dev-only twin of `/scan/tester` whose camera
 * answers "measured" for a REAL captured frame (the live-measured demo's
 * pipeline), so the prepared photo is a real JPEG from the camera.
 *
 *   PLAYWRIGHT_PORT=3217 npx playwright test tester-page \
 *     --project=chromium-camera-paper-edge --workers=1
 */
import { expect, test } from "@playwright/test";
import { TESTER_CONSENT_VERSION } from "../../src/lib/contracts/tester";
import { testerCopy as copy } from "../../src/lib/copy/tester";
import { inspectJpeg } from "../../src/lib/error-photo/jpeg";
import { skipFirstRun } from "./fixtures/first-run";

const DEMO = "/scan/tester/demo";

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(
    testInfo.project.name !== "chromium-camera-paper-edge",
    "Needs the fake-camera project (paper-edge-full.y4m).",
  );
});

test.describe.configure({ timeout: 120_000 });

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

test("a tester goes from code to a sent shot, and the next shot keeps tape and phone", async ({
  page,
}) => {
  await skipFirstRun(page);
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
  await page.goto(DEMO);
  await expect(page.getByTestId("tester-step-code")).toBeVisible();
  await page.getByLabel(copy.code.label).fill("p07-k7q2m9");
  await page.getByRole("button", { name: copy.code.submit }).click();
  await expect(page.getByTestId("tester-step-consent")).toBeVisible();
  expect(checks).toEqual([{ code: "P07-K7Q2M9" }]);
  await expect(page.getByText(copy.code.participant("P07"))).toBeVisible();

  // 2. Consent: the agree box gates the next step; the photo box is ticked.
  const start = page.getByRole("button", { name: copy.consent.next });
  await expect(start).toBeDisabled();
  await expect(page.getByLabel(copy.consent.photo)).toBeChecked();
  await page.getByLabel(copy.consent.agree).check();
  await start.click();

  // 3. Tape: right hand, A twice for each, B for the palm, one far pair.
  await expect(page.getByTestId("tester-step-tape")).toBeVisible();
  await page.getByRole("radio", { name: copy.tape.right, exact: true }).check();
  const field = (id: string) => page.locator(`[id="${id}"]`);
  await field("handLength.a.first").fill("188");
  await field("handLength.a.second").fill("193");
  await expect(page.getByText(copy.tape.recheck)).toBeVisible();
  await field("handLength.a.second").fill("189");
  await expect(page.getByText(copy.tape.recheck)).toHaveCount(0);
  await field("palmWidth.a.first").fill("84");
  await field("palmWidth.a.second").fill("84.5");
  await field("palmWidth.b.first").fill("85");
  await field("palmWidth.b.second").fill("84");
  await page.getByRole("button", { name: copy.tape.next }).click();

  // 4. Conditions.
  await expect(page.getByTestId("tester-step-conditions")).toBeVisible();
  await page.getByLabel(copy.conditions.phoneModel).fill("Pixel 8");
  await page
    .getByRole("radio", { name: copy.conditions.surfaces.white, exact: true })
    .check();
  await page
    .getByRole("radio", {
      name: copy.conditions.lightings.daylight,
      exact: true,
    })
    .check();
  await page
    .getByRole("radio", { name: copy.conditions.references.a4, exact: true })
    .check();
  await page.getByRole("button", { name: copy.conditions.start }).click();

  // 5. The real camera in tester mode: no manual entry, a give-up button.
  await expect(page.getByTestId("tester-give-up")).toBeVisible();
  await expect(page.locator(".manualEntry-handle")).toHaveCount(0);
  const confirm = page.getByTestId("paper-adjust-confirm");
  const sheet = page.locator("dialog.easyResultSheet[open]");
  await expect(confirm.or(sheet).first()).toBeVisible({ timeout: 60_000 });
  if (await confirm.isVisible()) await confirm.click();
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await sheet.getByTestId("answers-continue-button").click();

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
  expect(scansCalled).toBe(0);

  // 7. Next shot: tape and phone model kept, the rest asked again.
  await page.getByTestId("tester-next").click();
  await expect(page.getByTestId("tester-step-conditions")).toBeVisible();
  await expect(page.getByLabel(copy.conditions.phoneModel)).toHaveValue(
    "Pixel 8",
  );
  await page
    .getByRole("radio", { name: copy.conditions.surfaces.wood, exact: true })
    .check();
  await page
    .getByRole("radio", { name: copy.conditions.lightings.dim, exact: true })
    .check();
  await page
    .getByRole("radio", { name: copy.conditions.references.a4, exact: true })
    .check();
  await page.getByRole("button", { name: copy.conditions.start }).click();

  // 8. This time give up: only the attempt record goes, no photo.
  await page.getByTestId("tester-give-up").click();
  await page.getByTestId("tester-give-up-confirm").click();
  await expect(page.getByTestId("tester-send-status")).toHaveText(
    copy.result.gaveUpSent,
  );
  expect(shots).toHaveLength(2);
  expect(shots[1]!.photo).toBeUndefined();
  expect(shots[1]!.record).toMatchObject({
    gaveUp: true,
    surface: "wood",
    lighting: "dim",
    tape: r.tape,
  });
  expect(shots[1]!.record.shotId).not.toBe(r.shotId);
  expect(scansCalled).toBe(0);
});
