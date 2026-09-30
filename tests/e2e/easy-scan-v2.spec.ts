import { expect, test, type Page } from "@playwright/test";

/**
 * Scan v2 (docs/design/scan-v2-2026-09-30/README.md): the stage that never
 * changes shape, reduced motion, the debug panel, the motion budget and focus.
 * All of it runs on the fake-camera project (390x844, paper-edge-full.y4m).
 * The fake camera has no real hand and cannot blur, so what needs those (the
 * out-of-focus cue, a failed sample) is covered by unit tests
 * (tests/unit/camera-*.test.ts).
 *
 * `/scan/easy/live-measured-demo` is the real camera screen with a pipeline
 * that answers "measured" once `window.__release()` is called, so the states
 * between the live picture and the measured sheet can be held and measured.
 */
const LIVE_DEMO = "/scan/easy/live-measured-demo";

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(
    testInfo.project.name !== "chromium-camera-paper-edge",
    "Needs the fake-camera project (paper-edge-full.y4m).",
  );
});

/** Holds the demo pipeline until `window.__release()` is called. */
async function holdPipeline(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & {
      __easyScanLiveHold?: Promise<void>;
      __release?: () => void;
    };
    w.__easyScanLiveHold = new Promise<void>((resolve) => {
      w.__release = resolve;
    });
  });
}
const release = (page: Page) =>
  page.evaluate(() =>
    (window as Window & { __release?: () => void }).__release?.(),
  );

const box = async (page: Page, selector: string) => {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  return b;
};
const maxDelta = (a: Record<string, number>, b: Record<string, number>) =>
  Math.max(...["x", "y", "width", "height"].map((k) => Math.abs(a[k] - b[k])));

async function openLive(page: Page, url = LIVE_DEMO) {
  await page.goto(url);
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible();
}

test.describe("AC1: the stage never changes shape", () => {
  test("its box is the same live, while processing, and when the measured sheet opens", async ({
    page,
  }) => {
    await holdPipeline(page);
    await openLive(page);
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "none",
    );
    const live = await box(page, ".easyStage");
    // The whole screen, not a rectangle inside it.
    expect(live).toEqual({ x: 0, y: 0, width: 390, height: 844 });

    // The auto-shutter fires by itself; the pipeline is held, so it stays here.
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "processing",
      { timeout: 20_000 },
    );
    await expect(page.locator(".easyStageDim")).toBeVisible();
    const processing = await box(page, ".easyStage");

    await release(page);
    await expect(
      page.getByRole("dialog", { name: "Hand measured" }),
    ).toBeVisible({ timeout: 20_000 });
    // The moment the sheet opens: the photo has not finished moving yet.
    const opening = await box(page, ".easyStage");
    // ...and once it has.
    await expect(page.locator(".easyStageContent")).toHaveClass(/moved/);
    await page.waitForTimeout(700);
    const settled = await box(page, ".easyStage");

    const deltas = {
      liveToProcessing: maxDelta(live, processing),
      liveToOpening: maxDelta(live, opening),
      liveToSettled: maxDelta(live, settled),
    };
    console.log(`AC1 stage delta (px): ${JSON.stringify(deltas)}`);
    for (const [name, delta] of Object.entries(deltas))
      expect(delta, name).toBeLessThanOrEqual(1);
  });

  test("the frozen photo is drawn in the live frame's own shape, not the still's", async ({
    page,
  }) => {
    await holdPipeline(page);
    await openLive(page);
    const video = await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>("video.cameraVideo")!;
      return { width: v.videoWidth, height: v.videoHeight };
    });
    expect(video.width).toBeGreaterThan(0);
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "processing",
      { timeout: 20_000 },
    );
    const photo = await box(page, "svg.easyFrozenSvg");
    // object-fit: cover of the stream in the stage: the same aspect ratio as
    // the stream, wider or taller than the stage, and centred on it.
    expect(photo.width / photo.height).toBeCloseTo(
      video.width / video.height,
      2,
    );
    expect(photo.x + photo.width / 2).toBeCloseTo(195, 0);
    expect(photo.y + photo.height / 2).toBeCloseTo(422, 0);
    await release(page);
  });
});

test.describe("AC6: the debug panel", () => {
  test("is absent without the query, and with a query that is not debug=1", async ({
    page,
  }) => {
    const urls = ["/scan/easy", "/scan/easy?debug=0", "/scan/easy?x=1"];
    for (const [i, url] of urls.entries()) {
      await page.goto(url);
      // The tip shows once per browser.
      if (i === 0) await page.getByRole("button", { name: "Got it" }).click();
      await expect(page.locator(".easyStage")).toBeVisible();
      await page.waitForTimeout(600);
      await expect(page.getByTestId("scan-debug-panel"), url).toHaveCount(0);
    }
  });

  test("with ?debug=1 shows live numbers and a capture, copies JSON, and sends nothing anywhere", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await holdPipeline(page);
    // Let the hand detector's one same-origin download finish first.
    await page.goto(`${LIVE_DEMO}?debug=1`);
    await page.waitForResponse((res) =>
      res.url().includes("/mediapipe/models/hand_landmarker.task"),
    );
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Got it" }).click();

    const requests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("blob:") || url.startsWith("data:")) return;
      if (/\/__nextjs_|__next_hmr|webpack-hmr|_next\/static/.test(url)) return;
      requests.push(url);
    });

    const panel = page.getByTestId("scan-debug-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Samples/s");
    await expect(panel).toContainText("Copy JSON");
    // The capture happens by itself and is held in "processing".
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "processing",
      { timeout: 20_000 },
    );
    await expect
      .poll(async () => (await panel.textContent()) ?? "", { timeout: 5_000 })
      .toMatch(/Capture(takePhoto|canvas)/);

    await panel.getByRole("button", { name: "Copy JSON" }).click();
    await expect(panel.getByRole("status")).toHaveText("Copied");
    const json = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    console.log(`AC6 debug JSON: ${JSON.stringify(json)}`);
    expect(Object.keys(json).sort()).toEqual([
      "capabilities",
      "capture",
      "focusApplied",
      "live",
      "track",
      "userAgent",
    ]);
    expect(json.userAgent).toMatch(/Chrome/);
    expect(json.track).toMatchObject({ width: 1000, height: 1300 });
    expect(json.capabilities.focusMode).toEqual([]);
    expect(json.live.laplacianFloor).toBe(15);
    expect(json.live.samplesPerSecond).toBeGreaterThan(3);
    expect(json.live.samplesPerSecond).toBeLessThan(9);
    expect(json.live.detectionMsAverage).toBeGreaterThan(0);
    expect(json.live.detectionMsP95).toBeGreaterThanOrEqual(
      json.live.detectionMsAverage * 0.5,
    );
    expect(json.live.cornersSeen).toBe(4);
    expect(["takePhoto", "canvas"]).toContain(json.capture.method);
    expect(json.capture.stillWidth).toBeGreaterThan(0);
    expect(json.capture.stillKb).toBeGreaterThan(0);
    expect(json.capture.ringCompleteToFrozenMs).toBeGreaterThan(0);

    await release(page);
    await expect(
      page.getByRole("dialog", { name: "Hand measured" }),
    ).toBeVisible({ timeout: 20_000 });
    // Nothing left the device: no request at all while the panel was in use.
    expect(requests).toEqual([]);
  });

  test("when the clipboard is refused the JSON is shown to copy by hand", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: () => Promise.reject(new Error("denied")),
        },
      });
    });
    await page.goto("/scan/easy?debug=1");
    await page.getByRole("button", { name: "Got it" }).click();
    const panel = page.getByTestId("scan-debug-panel");
    await panel.getByRole("button", { name: "Copy JSON" }).click();
    const box = panel.getByRole("textbox", { name: "Debug JSON" });
    await expect(box).toBeVisible();
    const text = await box.inputValue();
    expect(JSON.parse(text).live.laplacianFloor).toBe(15);
  });
});
