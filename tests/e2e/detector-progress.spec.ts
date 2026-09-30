import { expect, test } from "@playwright/test";
import {
  LOAD_FAILED,
  MODEL_URL,
  openLengthFlow,
  pill,
  release,
  slowModel,
  uploadGreyPhoto,
} from "./fixtures/slow-model";

test("shows real progress while the model streams in, in coarse steps for assistive technology, then goes away", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  await slowModel(page, "gated");
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Got it" }).click();

  await expect(pill(page)).toBeVisible();
  const bar = pill(page).getByRole("progressbar");
  await expect(bar).toHaveAttribute("aria-valuenow", "0");
  await expect(pill(page)).toContainText("Loading the hand detector");

  await release(page, 3);
  await expect(bar).toHaveAttribute("aria-valuenow", "30");
  await expect(pill(page)).toContainText(/2\.\d of 7\.8 MB/);
  // The bar is exact for the eye: 30% of the model is 3 of 10 chunks.
  const transform = await pill(page)
    .locator(".easyDetectorFill")
    .evaluate((el) => (el as HTMLElement).style.transform);
  expect(transform).toBe("scaleX(0.3)");

  await release(page, 7);
  await expect(bar).toHaveAttribute("aria-valuenow", "70");
  await release(page, 10);
  await expect(pill(page)).toHaveCount(0, { timeout: 15_000 });
  expect(
    await page.evaluate(
      () => (window as Window & { __modelFetches?: number }).__modelFetches,
    ),
  ).toBe(1);
});

test("a screen reader is offered a handful of values, not one per chunk", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  await slowModel(page, "steady", 100);
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(pill(page)).toBeVisible();
  await expect(pill(page)).toHaveCount(0, { timeout: 30_000 });
  const values = await page.evaluate(
    () => (window as Window & { __progressValues?: string[] }).__progressValues,
  );
  const numeric = values!.filter((v) => v !== "indeterminate").map(Number);
  // 100 chunks, so 100 visual updates; only multiples of 10, at most 11 values.
  expect(numeric.every((v) => v % 10 === 0)).toBe(true);
  expect(new Set(numeric).size).toBeLessThanOrEqual(11);
  expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
  expect(numeric.length).toBeGreaterThan(3);
});

test("without a Content-Length the bar is indeterminate and still says how much has arrived", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  await slowModel(page, "gated-no-length");
  await page.goto("/scan/easy");
  await page.getByRole("button", { name: "Got it" }).click();
  await release(page, 3);
  const bar = pill(page).getByRole("progressbar");
  await expect(pill(page)).toContainText(
    /Loading the hand detector · \d\.\d MB/,
  );
  await expect(pill(page)).not.toContainText(" of ");
  await expect(bar).not.toHaveAttribute("aria-valuenow");
  await expect(pill(page).locator(".easyDetectorFill")).toHaveClass(
    /indeterminate/,
  );
  await release(page, 10);
  await expect(pill(page)).toHaveCount(0, { timeout: 15_000 });
});

test("if the app's own download fails, MediaPipe loads the same file by path and the detector really works", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  await slowModel(page, "fail-first");
  await openLengthFlow(page);
  // Ours failed (1), MediaPipe fetched by path (2): the same URL both times.
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __modelUrls?: string[] }).__modelUrls,
      ),
    )
    .toHaveLength(2);
  const urls = await page.evaluate(
    () => (window as Window & { __modelUrls?: string[] }).__modelUrls!,
  );
  expect(urls.map((u) => new URL(u, page.url()).pathname)).toEqual([
    MODEL_URL,
    MODEL_URL,
  ]);
  // The detector came up through the fallback: a photo with no hand in it is
  // answered "no hand", not "couldn't load the detector".
  await uploadGreyPhoto(page);
  const sheet = page.getByRole("dialog", { name: "Retake needed" });
  await expect(sheet).toContainText("couldn't find a hand", {
    timeout: 30_000,
  });
  await expect(sheet).not.toContainText(LOAD_FAILED);
  await expect(pill(page)).toHaveCount(0);
});

test("when both ways of loading the model fail, the person is told, with a retry, and a photo gets the same message", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  await page.route(`**${MODEL_URL}`, (route) => route.abort());
  await openLengthFlow(page);
  const notice = page.getByRole("alert").filter({ hasText: LOAD_FAILED });
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice.getByRole("button", { name: "Try again" })).toBeVisible();

  await uploadGreyPhoto(page);
  const sheet = page.getByRole("dialog", { name: "Retake needed" });
  // The same words, and no offer to edit the length: that cannot fix this.
  await expect(sheet.locator(".easySheetErrorMessage")).toHaveText(
    "We couldn't load the hand detector. Check your connection and try again.",
    { timeout: 30_000 },
  );
  await expect(
    sheet.getByRole("button", { name: "Edit hand length" }),
  ).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("Try again on the notice loads the detector once the connection is back", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  await page.route(`**${MODEL_URL}`, (route) => route.abort());
  await openLengthFlow(page);
  const notice = page.getByRole("alert").filter({ hasText: LOAD_FAILED });
  await expect(notice).toBeVisible({ timeout: 30_000 });

  // Still offline: the retry fails again and the notice comes back.
  await notice.getByRole("button", { name: "Try again" }).click();
  await expect(notice).toBeVisible({ timeout: 30_000 });

  await page.unroute(`**${MODEL_URL}`);
  await notice.getByRole("button", { name: "Try again" }).click();
  await expect(pill(page)).toHaveCount(0, { timeout: 30_000 });
  await uploadGreyPhoto(page);
  const sheet = page.getByRole("dialog", { name: "Retake needed" });
  await expect(sheet).toContainText("couldn't find a hand", {
    timeout: 30_000,
  });
  await expect(sheet).not.toContainText(LOAD_FAILED);
});

test("the progress pill is out of the way of assistive technology while the hand-length step covers it", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  await slowModel(page, "gated");
  await page.goto("/scan/easy");
  const noPaper = page.getByRole("button", {
    name: "No paper? Use a ruler instead",
  });
  await expect(noPaper).toHaveCount(1);
  await expect(pill(page)).toBeVisible();
  await expect(pill(page)).not.toHaveAttribute("inert");
  await noPaper.click();
  await expect(
    page.getByRole("heading", { name: "Hand length" }),
  ).toBeVisible();
  await expect(pill(page)).toHaveAttribute("inert", "");
  await page.getByRole("button", { name: /^Back to/ }).click();
  await expect(pill(page)).not.toHaveAttribute("inert");
});

for (const [motion, animation] of [
  ["no-preference", "easyDetectorSlide"],
  ["reduce", "easyDetectorPulse"],
] as const) {
  test(`the indeterminate bar ${motion === "reduce" ? "fades slowly instead of sitting full" : "slides"} with motion set to ${motion}`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
    await slowModel(page, "gated-no-length");
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    const fill = pill(page).locator(".easyDetectorFill.indeterminate");
    await release(page, 3);
    await expect(fill).toBeVisible();
    expect(
      await fill.evaluate((el) => getComputedStyle(el).animationName),
    ).toBe(animation);
  });
}

// The notice is laid out in flow above a card that is itself in flow (the
// camera was refused, or there is none), so the two cannot overlap at any text
// size. Measured at the default size and at 150%, for the loading pill and for
// the failure notice.
type Box = { top: number; bottom: number; left: number; right: number };
const overlap = (a: Box, b: Box) =>
  a.left < b.right - 0.5 &&
  b.left < a.right - 0.5 &&
  a.top < b.bottom - 0.5 &&
  b.top < a.bottom - 0.5;

for (const scale of ["100%", "150%"]) {
  for (const state of ["loading", "failed"] as const) {
    for (const screen of ["camera refused", "no camera"] as const) {
      test(`the ${state} notice does not overlap the ${screen} card at ${scale} text`, async ({
        page,
      }, info) => {
        test.skip(
          info.project.name !== "mobile",
          "Runs in the mobile project.",
        );
        if (state === "loading") await slowModel(page, "gated");
        else await page.route(`**${MODEL_URL}`, (route) => route.abort());
        if (screen === "no camera")
          await page.addInitScript(() => {
            Object.defineProperty(navigator, "mediaDevices", {
              value: undefined,
            });
          });
        await page.goto("/scan/easy");
        await page.getByRole("button", { name: "Got it" }).click();
        await page.addStyleTag({ content: `html { font-size: ${scale}; }` });
        const notice = pill(page);
        await expect(notice).toBeVisible({ timeout: 30_000 });
        if (state === "failed")
          await expect(notice).toHaveAttribute("data-state", "failed");
        const card = page.locator(
          screen === "camera refused"
            ? ".cameraErrorCard"
            : ".easyScanNoCamera",
        );
        await expect(card).toBeVisible();
        const boxes = await page.evaluate(() => {
          const rect = (selector: string) => {
            const r = document.querySelector(selector)!.getBoundingClientRect();
            return {
              top: r.top,
              bottom: r.bottom,
              left: r.left,
              right: r.right,
            };
          };
          return {
            notice: rect("[data-testid=detector-progress]"),
            card: rect(".cameraErrorCard, .easyScanNoCamera"),
            topBar: rect(".cameraTopBar"),
            viewport: { width: innerWidth },
          };
        });
        expect(overlap(boxes.notice, boxes.card), "notice over the card").toBe(
          false,
        );
        expect(
          overlap(boxes.notice, boxes.topBar),
          "notice over the top bar",
        ).toBe(false);
        // Nor does it run off the screen.
        expect(boxes.notice.left).toBeGreaterThanOrEqual(0);
        expect(boxes.notice.right).toBeLessThanOrEqual(boxes.viewport.width);
      });
    }
  }
}

test("coming back to the scan screen in the same session downloads nothing again", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  await slowModel(page, "passthrough");
  const modelResponse = page.waitForResponse((res) =>
    res.url().includes("/mediapipe/models/hand_landmarker.task"),
  );
  await page.goto("/scan/easy");
  await modelResponse;
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(pill(page)).toHaveCount(0, { timeout: 20_000 });

  await page
    .getByRole("button", { name: "Close camera, back to Home" })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: "Scan my hand" }).first().click();
  await expect(page).toHaveURL(/\/scan\/easy$/);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(pill(page)).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as Window & { __modelFetches?: number }).__modelFetches,
    ),
  ).toBe(1);
});

test("the download stays on this origin under the unchanged connect-src 'self'", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Runs in the mobile project.");
  const origins = new Set<string>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http")) origins.add(url.origin);
  });
  const response = await page.goto("/scan/easy");
  expect(response!.headers()["content-security-policy"]).toContain(
    "connect-src 'self'",
  );
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(pill(page)).toHaveCount(0, { timeout: 20_000 });
  expect([...origins]).toEqual([new URL(page.url()).origin]);
});
