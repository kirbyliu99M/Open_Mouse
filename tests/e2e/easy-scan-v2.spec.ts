import { expect, test, type Page } from "@playwright/test";
import { contrast, overWhite } from "./fixtures/contrast";

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
    await expect(page.locator(".easyStageContent.moved")).toBeAttached();
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
    // The video element is on screen before its first frame: read its size once
    // it is playing (this read 0 x 0 once in a full run).
    await expect(page.locator("video.cameraVideo.ready")).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLVideoElement>("video.cameraVideo")!
          .videoWidth > 0,
    );
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

/** Remembers, for the test to read, when a flash or a scan line is ever added. */
async function watchForMotionElements(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { __seen?: Record<string, number> };
    w.__seen = {};
    const selectors = [".easyFlash", ".easyScanLine"];
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          for (const selector of selectors)
            if (node.matches(selector) || node.querySelector(selector))
              w.__seen![selector] = (w.__seen![selector] ?? 0) + 1;
        }
    }).observe(document, { subtree: true, childList: true });
  });
}
const seen = (page: Page) =>
  page.evaluate(
    () => (window as Window & { __seen?: Record<string, number> }).__seen ?? {},
  );

/** Runs the capture through to the opened measured sheet, holding on "processing". */
async function captureAndMeasure(page: Page) {
  await holdPipeline(page);
  await openLive(page);
  await expect(page.locator(".easyStage")).toHaveAttribute(
    "data-phase",
    "processing",
    { timeout: 20_000 },
  );
  await page.waitForTimeout(150);
  const whileProcessing = {
    flash: await page.locator(".easyFlash").count(),
    scanLine: await page.locator(".easyScanLine").count(),
  };
  await release(page);
  const sheet = page.getByRole("dialog", { name: "Hand measured" });
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  return { whileProcessing, sheet };
}

const computed = (page: Page, selector: string, props: string[]) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, props) => {
      const style = getComputedStyle(el);
      return Object.fromEntries(
        props.map((p) => [p, style.getPropertyValue(p)]),
      );
    }, props);

test.describe("AC7: reduced motion", () => {
  test("no flash, no scan line, no pulse, no spring: a 120 ms fade instead", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await watchForMotionElements(page);
    const { whileProcessing, sheet } = await captureAndMeasure(page);

    // Not hidden: never rendered at all, not even for one frame.
    expect(whileProcessing).toEqual({ flash: 0, scanLine: 0 });
    expect(await seen(page)).toEqual({});
    await expect(page.locator(".easyFlash, .easyScanLine")).toHaveCount(0);
    // The pulse ring is not drawn.
    expect(
      await page
        .locator(".easyCornerPulse")
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).display)),
    ).toEqual(["none", "none", "none", "none"]);
    // The dots do not glide between samples.
    expect(
      await computed(page, ".easyCorner", ["transition-duration"]),
    ).toEqual({ "transition-duration": "0s" });
    // The sheet fades in for 120 ms instead of springing up.
    expect(
      await sheet.evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.animationName, style.animationDuration];
      }),
    ).toEqual(["easyFadeIn", "0.12s"]);
    // The photo still ends up clear of the sheet, without a spring: no
    // transition, a fade.
    expect(
      await computed(page, ".easyStageContent.moved", [
        "transition-duration",
        "animation-name",
        "animation-duration",
      ]),
    ).toEqual({
      "transition-duration": "0s",
      "animation-name": "easyFadeIn",
      "animation-duration": "0.12s",
    });
    await expect(page.locator(".easyStageContent.moved")).toBeAttached();
    const transform = await page
      .locator(".easyStageContent.moved")
      .evaluate((el) => getComputedStyle(el).transform);
    expect(transform).not.toBe("none");
    // The lines appear together in a fade, not one after the other.
    expect(
      await page
        .locator(".easyDimGrow")
        .first()
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return [style.animationName, style.animationDelay];
        }),
    ).toEqual(["easyFadeIn", "0s"]);
  });

  test("control: with motion allowed the same flow does flash, scan and spring", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await watchForMotionElements(page);
    const { whileProcessing, sheet } = await captureAndMeasure(page);
    expect(whileProcessing.scanLine).toBe(1);
    expect((await seen(page))[".easyFlash"]).toBeGreaterThanOrEqual(1);
    expect((await seen(page))[".easyScanLine"]).toBe(1);
    expect(
      await sheet.evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("easySheetSlideIn");
    expect(
      await computed(page, ".easyStageContent.moved", ["transition-duration"]),
    ).toEqual({ "transition-duration": "0.55s" });
    expect(
      await page
        .locator(".easyCornerPulse")
        .first()
        .evaluate((el) => {
          const style = getComputedStyle(el);
          return [style.display, style.animationDuration];
        }),
    ).toEqual(["block", "0.35s"]);
  });
});

test.describe("AC5: only transform and opacity move", () => {
  test("every property the scan flow animates or transitions is one of those two (one named exception)", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as Window & { __animated?: string[] };
      w.__animated = [];
      addEventListener(
        "transitionrun",
        (event) => {
          w.__animated!.push(
            `transition:${(event as TransitionEvent).propertyName}`,
          );
        },
        true,
      );
      addEventListener(
        "animationstart",
        (event) => {
          const name = (event as AnimationEvent).animationName;
          const animation = document
            .getAnimations()
            .find((a) => (a as CSSAnimation).animationName === name);
          const frames = (animation?.effect as KeyframeEffect | null)
            ?.getKeyframes()
            .flatMap((frame) => Object.keys(frame))
            .filter(
              (key) =>
                !["offset", "easing", "composite", "computedOffset"].includes(
                  key,
                ),
            );
          for (const key of new Set(frames ?? []))
            w.__animated!.push(`animation:${name}:${key}`);
        },
        true,
      );
    });
    const { sheet } = await captureAndMeasure(page);
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(1500); // the lines draw, the labels fade in
    const animated = await page.evaluate(
      () => (window as Window & { __animated?: string[] }).__animated ?? [],
    );
    const properties = [
      ...new Set(animated.map((entry) => entry.split(":").pop()!)),
    ].sort();
    console.log(`AC5 animated properties: ${JSON.stringify(properties)}`);
    console.log(
      `AC5 animated entries: ${JSON.stringify([...new Set(animated)])}`,
    );
    // The one deliberate exception: the shutter ring's fill, a 96 px SVG circle
    // (camera.css, unchanged from before this slice).
    const allowed = new Set(["transform", "opacity", "stroke-dashoffset"]);
    expect(properties.filter((p) => !allowed.has(p))).toEqual([]);
    expect(properties).toContain("transform");
    expect(properties).toContain("opacity");
    expect(properties).not.toContain("left");
    expect(properties).not.toContain("top");
  });

  test("the dots are placed by transform: left and top are 0 and only transform is transitioned", async ({
    page,
  }) => {
    await holdPipeline(page);
    await openLive(page);
    const dots = await page.locator(".easyCorner").evaluateAll((els) =>
      els.map((el) => {
        const style = getComputedStyle(el);
        return {
          left: style.left,
          top: style.top,
          transitionProperty: style.transitionProperty,
          transform: style.transform,
        };
      }),
    );
    expect(dots).toHaveLength(4);
    for (const dot of dots) {
      expect(dot.left).toBe("0px");
      expect(dot.top).toBe("0px");
      expect(dot.transitionProperty).toBe("transform");
      expect(dot.transform).not.toBe("none");
    }
    await release(page);
  });
});

/**
 * A camera that reports focus support (Android Chrome does; the fake device
 * does not) and records every constraint it is asked to apply.
 */
async function fakeFocusSupport(page: Page, supported: boolean) {
  await page.addInitScript((supported) => {
    const w = window as Window & { __constraints?: unknown[] };
    w.__constraints = [];
    const proto = MediaStreamTrack.prototype;
    const realApply = proto.applyConstraints;
    proto.applyConstraints = function (constraints) {
      w.__constraints!.push(JSON.parse(JSON.stringify(constraints ?? {})));
      return realApply.call(this, constraints).catch(() => undefined);
    };
    if (!supported) return;
    const realCapabilities = proto.getCapabilities;
    proto.getCapabilities = function () {
      return {
        ...realCapabilities.call(this),
        focusMode: ["manual", "single-shot", "continuous"],
      } as MediaTrackCapabilities;
    };
    const realSettings = proto.getSettings;
    proto.getSettings = function () {
      return { ...realSettings.call(this), pointsOfInterest: [] };
    };
  }, supported);
}
const constraintsSeen = (page: Page) =>
  page.evaluate(
    () =>
      (window as Window & { __constraints?: unknown[] }).__constraints ?? [],
  );

/**
 * Holds the live loop where it is, so the auto-shutter cannot fire mid-test.
 * It first waits for the camera to be RUNNING and the loop to have SAMPLED (the
 * fixture's four corners found): the cue line is on screen from the start, long
 * before either, and freezing then leaves a screen with no camera behind it.
 */
async function freezeLoop(page: Page) {
  await expect(page.locator(".easyStage video.cameraVideo.ready")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(".easyCorner[data-found=true]")).toHaveCount(4, {
    timeout: 20_000,
  });
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0;
  });
}

test.describe("AC3 and AC4: focus", () => {
  test("a camera that reports focusMode is put in continuous focus; a tap focuses once at that point and shows the reticle", async ({
    page,
  }) => {
    await fakeFocusSupport(page, true);
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible();
    await freezeLoop(page);

    expect((await constraintsSeen(page))[0]).toEqual({
      advanced: [{ focusMode: "continuous" }],
    });

    const video = await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>("video.cameraVideo")!;
      return { width: v.videoWidth, height: v.videoHeight };
    });
    await page
      .locator(".easyStage")
      .click({ position: { x: 100, y: 300 }, force: true });

    const reticle = page.getByTestId("focus-reticle");
    await expect(reticle).toBeVisible();
    // 88 px, centred on the tap.
    const at = await reticle.boundingBox();
    expect(at!.width).toBeCloseTo(88, 0);
    expect(at!.x + at!.width / 2).toBeCloseTo(100, 0);
    expect(at!.y + at!.height / 2).toBeCloseTo(300, 0);

    // The tap is mapped into the video frame with the cover crop undone.
    const scale = Math.max(390 / video.width, 844 / video.height);
    const coverWidth = video.width * scale;
    const coverHeight = video.height * scale;
    const expected = {
      x: (100 - (390 - coverWidth) / 2) / coverWidth,
      y: (300 - (844 - coverHeight) / 2) / coverHeight,
    };
    const tapCall = (await constraintsSeen(page)).at(-1) as {
      advanced: {
        focusMode: string;
        pointsOfInterest: { x: number; y: number }[];
      }[];
    };
    expect(tapCall.advanced[0].focusMode).toBe("single-shot");
    expect(tapCall.advanced[0].pointsOfInterest).toHaveLength(1);
    expect(tapCall.advanced[0].pointsOfInterest[0].x).toBeCloseTo(
      expected.x,
      3,
    );
    expect(tapCall.advanced[0].pointsOfInterest[0].y).toBeCloseTo(
      expected.y,
      3,
    );

    // About 1.2 s later continuous focus is asked for again, and the reticle goes.
    await expect
      .poll(async () => (await constraintsSeen(page)).at(-1), {
        timeout: 4_000,
      })
      .toEqual({ advanced: [{ focusMode: "continuous" }] });
    await expect(reticle).toHaveCount(0, { timeout: 4_000 });
  });

  test("where the camera reports nothing: no reticle, no tap handling, no focus constraint at all", async ({
    page,
  }) => {
    await fakeFocusSupport(page, false);
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible();
    await freezeLoop(page);
    await page
      .locator(".easyStage")
      .click({ position: { x: 100, y: 300 }, force: true });
    await page.waitForTimeout(1600);
    await expect(page.getByTestId("focus-reticle")).toHaveCount(0);
    expect(await constraintsSeen(page)).toEqual([]);
  });

  test("a camera that lists focus modes but refuses the request does not break the scan", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const proto = MediaStreamTrack.prototype;
      proto.getCapabilities = function () {
        return {
          focusMode: ["single-shot", "continuous"],
        } as MediaTrackCapabilities;
      };
      proto.getSettings = function () {
        return { width: 1000, height: 1300, pointsOfInterest: [] };
      };
      proto.applyConstraints = () =>
        Promise.reject(new DOMException("no", "OverconstrainedError"));
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto("/scan/easy?debug=1");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible();
    await expect(page.getByTestId("scan-debug-panel")).toContainText(
      "continuous no (OverconstrainedError)",
    );
    // The scan carries on: the auto-shutter still fires (the fake scene has no
    // hand, so it ends at the retake sheet).
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      /processing|gateFailure/,
      { timeout: 20_000 },
    );
    expect(errors).toEqual([]);
  });
});

test.describe("the measured and retake layouts", () => {
  test("once measured, the paper corners, both lines and both labels are all above the sheet", async ({
    page,
  }) => {
    const { sheet } = await captureAndMeasure(page);
    await expect(page.locator(".easyStageContent.moved")).toBeAttached();
    await page.waitForTimeout(1600); // the spring settles, the lines are drawn
    const sheetTop = (await sheet.boundingBox())!.y;
    const parts = await page.evaluate(() => {
      const rects = (selector: string) =>
        [...document.querySelectorAll(selector)].map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        });
      return {
        checks: rects(".easyCornerCheck circle"),
        labels: rects(".easyDimLabelBg"),
        lines: rects(".easyDimLine"),
      };
    });
    expect(parts.checks).toHaveLength(4);
    expect(parts.labels).toHaveLength(2);
    expect(parts.lines).toHaveLength(2);
    const all = [...parts.checks, ...parts.labels, ...parts.lines];
    const lowest = Math.max(...all.map((r) => r.bottom));
    const highest = Math.min(...all.map((r) => r.top));
    const layer = await page
      .locator(".easyStageContent.moved")
      .evaluate((el) => {
        const m = new DOMMatrix(getComputedStyle(el).transform);
        return { scale: m.a, translateY: m.f };
      });
    console.log(
      `measured layout: photo scale ${layer.scale.toFixed(3)}, moved ${layer.translateY.toFixed(0)} px, lowest drawn part ${lowest.toFixed(0)} px, sheet top ${sheetTop.toFixed(0)} px, highest ${highest.toFixed(0)} px`,
    );
    expect(lowest).toBeLessThanOrEqual(sheetTop);
    expect(highest).toBeGreaterThanOrEqual(0);
    for (const r of all) {
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(390);
    }
  });

  test("lines draw in order: hand length first, palm width 350 ms later", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await captureAndMeasure(page);
    const timing = await page.locator(".easyDimGrow").evaluateAll((els) =>
      els.map((el) => {
        const style = getComputedStyle(el);
        return [style.animationDuration, style.animationDelay];
      }),
    );
    expect(timing).toEqual([
      ["0.35s", "0.3s"],
      ["0.35s", "0.65s"],
    ]);
  });

  test("a located problem is outlined in amber, above the sheet; an unlocated one is not", async ({
    page,
  }) => {
    await holdPipeline(page);
    await openLive(page, `${LIVE_DEMO}?result=retake`);
    await release(page);
    const sheet = page.getByRole("dialog", { name: "Retake needed" });
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".easyStageContent.moved")).toBeAttached();
    await page.waitForTimeout(1200);
    const outline = page.locator(".easyProblem");
    await expect(outline).toHaveCount(1);
    const outlineBox = (await outline.boundingBox())!;
    const sheetTop = (await sheet.boundingBox())!.y;
    expect(outlineBox.y + outlineBox.height).toBeLessThanOrEqual(sheetTop);
    expect(await outline.evaluate((el) => getComputedStyle(el).stroke)).toBe(
      "rgb(240, 178, 58)",
    );
  });

  test("no hand found means nothing to outline: the photo is shown, no box is guessed", async ({
    page,
  }) => {
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(
      page.getByRole("dialog", { name: "Retake needed" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("svg.easyFrozenSvg")).toBeVisible();
    await expect(page.locator(".easyProblem")).toHaveCount(0);
  });
});

test.describe("AC6: the debug panel once a sheet is open", () => {
  test("the numbers of the capture are still reachable and copyable from the bottom sheet", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await holdPipeline(page);
    await openLive(page, `${LIVE_DEMO}?debug=1`);
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "processing",
      { timeout: 20_000 },
    );
    await release(page);
    const sheet = page.getByRole("dialog", { name: "Hand measured" });
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    // Only one panel at a time: the page's is behind the modal sheet.
    await expect(page.getByTestId("scan-debug-panel")).toHaveCount(1);
    await expect(page.getByTestId("scan-debug-panel")).toBeHidden();
    await sheet.getByText("Debug", { exact: true }).click();
    const panel = sheet.getByTestId("scan-debug-panel");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Copy JSON" }).click();
    await expect(panel.getByRole("status")).toHaveText("Copied");
    const json = JSON.parse(
      await page.evaluate(() => navigator.clipboard.readText()),
    );
    expect(["takePhoto", "canvas"]).toContain(json.capture.method);
    expect(json.capture.stillWidth).toBeGreaterThan(0);
    expect(json.capture.ringCompleteToFrozenMs).toBeGreaterThan(0);
    expect(json.track.videoWidth).toBeGreaterThan(0);
  });
});

test.describe("fix round 1: the sheet growing after it opened", () => {
  test("when the sheet grows the photo moves clear of it again", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { sheet } = await captureAndMeasure(page);
    await expect(page.locator(".easyStageContent.moved")).toBeAttached();
    await page.waitForTimeout(400);
    const layerTransform = () =>
      page
        .locator(".easyStageContent.moved")
        .evaluate((el) => getComputedStyle(el).transform);
    const drawn = () =>
      page.evaluate(() => {
        const rects = [
          ...document.querySelectorAll(
            ".easyCornerCheck circle, .easyDimLabelBg, .easyDimLine",
          ),
        ].map((el) => el.getBoundingClientRect());
        return {
          lowest: Math.max(...rects.map((r) => r.bottom)),
          count: rects.length,
        };
      });
    const before = { transform: await layerTransform(), ...(await drawn()) };
    const topBefore = (await sheet.boundingBox())!.y;
    expect(before.lowest).toBeLessThanOrEqual(topBefore);

    // What happens in the app when a status line or an error block is added,
    // or the text is made larger: the sheet gets taller.
    await sheet.evaluate((el) => {
      const extra = document.createElement("div");
      extra.id = "grown";
      extra.style.height = "60px"; // stays under the 52vh cap
      el.appendChild(extra);
    });
    await expect
      .poll(async () => (await sheet.boundingBox())!.y, { timeout: 3_000 })
      .toBeLessThan(topBefore - 50);
    await expect
      .poll(layerTransform, { timeout: 3_000 })
      .not.toBe(before.transform);
    await page.waitForTimeout(300);
    const after = await drawn();
    const top = (await sheet.boundingBox())!.y;
    console.log(
      `sheet grew: top ${topBefore.toFixed(0)} -> ${top.toFixed(0)} px, lowest drawn part ${before.lowest.toFixed(0)} -> ${after.lowest.toFixed(0)} px`,
    );
    expect(after.count).toBe(before.count);
    expect(after.lowest).toBeLessThanOrEqual(top);
  });
});

test.describe("fix round 1: a retake starts clean", () => {
  test("while the camera reopens, the last run's full ring, green cue and hint are gone", async ({
    page,
  }) => {
    // The second camera request is held for 2.5 s, so the screen can be read
    // in the moment between "Try again" and the first picture.
    await page.addInitScript(() => {
      const w = window as Window & { __delayNextCamera?: boolean };
      const media = navigator.mediaDevices;
      const real = media.getUserMedia.bind(media);
      media.getUserMedia = async (...args) => {
        if (w.__delayNextCamera) {
          w.__delayNextCamera = false;
          await new Promise((resolve) => setTimeout(resolve, 2500));
        }
        return real(...args);
      };
    });
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    const sheet = page.getByRole("dialog", { name: "Retake needed" });
    await expect(sheet).toBeVisible({ timeout: 20_000 });

    await page.evaluate(() => {
      (window as Window & { __delayNextCamera?: boolean }).__delayNextCamera =
        true;
    });
    await sheet.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "none",
    );
    await page.waitForTimeout(400);

    const screen = await page.evaluate(() => {
      const circle = document.querySelector(".cameraShutterRing circle");
      return {
        cue: document.querySelector("[data-testid=camera-cue]")?.textContent,
        cueIsGreen: Boolean(document.querySelector(".cameraCue.perfect")),
        hints: document.querySelectorAll(".easyHint").length,
        // What the polite live region under the cue would read out.
        announced: document.querySelector(
          ".cameraCueWrap + .visuallyHiddenLive",
        )?.textContent,
        ringDashoffset: Number(circle?.getAttribute("stroke-dashoffset")),
        videoHasStream:
          (document.querySelector("video.cameraVideo") as HTMLVideoElement)
            ?.srcObject !== null,
      };
    });
    // The camera has not answered yet: nothing of the last run is on screen.
    expect(screen.videoHasStream).toBe(false);
    expect(screen.cue).toBe("Point the camera at the paper");
    expect(screen.cueIsGreen).toBe(false);
    expect(screen.hints).toBe(0);
    // ...and a screen reader is not told "Photo taken" again.
    expect(screen.announced).toBe("");
    // An empty ring: the whole circumference is still to fill.
    expect(screen.ringDashoffset).toBeCloseTo(2 * Math.PI * 40, 3);

    // ...and it works again once the camera does.
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      /processing|gateFailure/,
      { timeout: 20_000 },
    );
  });
});

test.describe("fix round 1: the drawing reads on white paper", () => {
  test("each white measurement line has a dark halo under it, and both contrast enough", async ({
    page,
  }) => {
    await captureAndMeasure(page);
    await page.waitForTimeout(1600);
    const drawn = await page.evaluate(() => {
      const style = (el: Element) => getComputedStyle(el);
      const lines = [...document.querySelectorAll(".easyDimLine")];
      return lines.map((line) => {
        const halo = line.previousElementSibling!;
        return {
          haloClass: halo.getAttribute("class"),
          haloStroke: style(halo).stroke,
          haloWidth: parseFloat(style(halo).strokeWidth),
          haloCap: style(halo).strokeLinecap,
          lineStroke: style(line).stroke,
          lineWidth: parseFloat(style(line).strokeWidth),
          // Same path: the halo and the line share their end points.
          samePath: ["x1", "y1", "x2", "y2"].every(
            (a) => halo.getAttribute(a) === line.getAttribute(a),
          ),
        };
      });
    });
    expect(drawn).toHaveLength(2);
    for (const line of drawn) {
      expect(line.haloClass).toBe("easyDimHalo");
      expect(line.samePath).toBe(true);
      expect(line.haloStroke).toBe("rgba(0, 0, 0, 0.55)");
      expect(line.haloWidth).toBeCloseTo(4.5, 1);
      expect(line.haloCap).toBe("round");
      expect(line.lineStroke).toBe("rgb(255, 255, 255)");
      const halo = overWhite(line.haloStroke);
      const whiteOnHalo = contrast(line.lineStroke, halo);
      const haloOnPaper = contrast(halo, "rgb(255, 255, 255)");
      console.log(
        `measurement line: white on its halo ${whiteOnHalo.toFixed(2)}:1, halo on white paper ${haloOnPaper.toFixed(2)}:1 (white on the paper alone was ${contrast(line.lineStroke, "rgb(246, 246, 242)").toFixed(2)}:1)`,
      );
      expect(whiteOnHalo).toBeGreaterThanOrEqual(4.5);
      expect(haloOnPaper).toBeGreaterThanOrEqual(3);
    }
    // The extension lines have one too.
    expect(await page.locator(".easyDimExtensionHalo").count()).toBe(4);
  });

  test("the amber outline sits on a dark halo and reaches 3:1 on white paper", async ({
    page,
  }) => {
    await holdPipeline(page);
    await openLive(page, `${LIVE_DEMO}?result=retake`);
    await release(page);
    await expect(
      page.getByRole("dialog", { name: "Retake needed" }),
    ).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    const stroke = await page.evaluate(() => {
      const outline = document.querySelector(".easyProblem")!;
      const halo = document.querySelector(".easyProblemHalo")!;
      return {
        amber: getComputedStyle(outline).stroke,
        halo: getComputedStyle(halo).stroke,
        haloWidth: parseFloat(getComputedStyle(halo).strokeWidth),
        amberWidth: parseFloat(getComputedStyle(outline).strokeWidth),
        haloFirst: Boolean(
          halo.compareDocumentPosition(outline) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      };
    });
    expect(stroke.haloFirst).toBe(true);
    expect(stroke.haloWidth).toBeGreaterThan(stroke.amberWidth);
    const halo = overWhite(stroke.halo);
    const amberOnHalo = contrast(stroke.amber, halo);
    const haloOnPaper = contrast(halo, "rgb(255, 255, 255)");
    const amberOnPaperAlone = contrast(stroke.amber, "rgb(255, 255, 255)");
    console.log(
      `amber outline: alone on white ${amberOnPaperAlone.toFixed(2)}:1; on its halo ${amberOnHalo.toFixed(2)}:1; halo on white ${haloOnPaper.toFixed(2)}:1`,
    );
    expect(amberOnPaperAlone).toBeLessThan(3); // why the halo is there
    expect(amberOnHalo).toBeGreaterThanOrEqual(3);
    expect(haloOnPaper).toBeGreaterThanOrEqual(3);
  });
});

test.describe("fix round 1: reduced motion cross-fades, it does not blink", () => {
  test("the picture is never transparent while the measured layer fades in", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await holdPipeline(page);
    await openLive(page);
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "processing",
      { timeout: 20_000 },
    );
    // Freeze every animation at 0 ms the moment the measured layer appears, so
    // the cross-fade can be read at chosen instants instead of raced.
    await page.evaluate(() => {
      const w = window as Window & { __release?: () => void };
      new MutationObserver((records, observer) => {
        if (!document.querySelector(".easyStageContent.moved")) return;
        for (const a of document.getAnimations()) {
          a.pause();
          a.currentTime = 0;
        }
        observer.disconnect();
        (window as Window & { __frozen?: boolean }).__frozen = true;
      }).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
      w.__release?.();
    });
    await page.waitForFunction(
      () => (window as Window & { __frozen?: boolean }).__frozen === true,
    );

    const at = (ms: number) =>
      page.evaluate((ms) => {
        for (const a of document.getAnimations()) a.currentTime = ms;
        const opacity = (selector: string) => {
          const el = document.querySelector(selector);
          return el ? Number(getComputedStyle(el).opacity) : null;
        };
        return {
          leaving: opacity(".easyStageContent.leaving"),
          moved: opacity(".easyStageContent.moved"),
        };
      }, ms);

    const samples = [0, 30, 60, 90, 110, 119, 121, 200];
    const seen: Record<
      number,
      { leaving: number | null; moved: number | null }
    > = {};
    for (const ms of samples) seen[ms] = await at(ms);
    console.log(`reduced-motion cross-fade: ${JSON.stringify(seen)}`);
    // The unmoved picture stays fully opaque while the moved one fades in over it...
    for (const ms of [0, 30, 60, 90, 110]) {
      expect(seen[ms].leaving, `unmoved at ${ms} ms`).toBe(1);
      expect(seen[ms].moved, `moved at ${ms} ms`).toBeCloseTo(ms / 120, 2);
    }
    // At every instant, the two together cover the stage: the picture is
    // never see-through (1 - (1 - a)(1 - b) is what stacking them leaves).
    for (const ms of samples) {
      const { leaving, moved } = seen[ms];
      const covered = 1 - (1 - (leaving ?? 0)) * (1 - (moved ?? 0));
      expect(covered, `covered at ${ms} ms`).toBeGreaterThanOrEqual(0.99);
    }
    // ...and only when it is fully covered does it let go.
    expect(seen[121].leaving).toBe(0);
    expect(seen[121].moved).toBe(1);
    expect(seen[200].moved).toBe(1);
    // Only one of them is ever exposed to a screen reader.
    expect(await page.locator("svg.easyFrozenSvg[role=img]").count()).toBe(1);
    expect(
      await page.locator("svg.easyFrozenSvg[aria-hidden=true]").count(),
    ).toBe(1);
  });
});

test.describe("fix round 1: the reticle is the spec's", () => {
  async function tapAndReadReticle(page: Page) {
    await fakeFocusSupport(page, true);
    await page.goto("/scan/easy");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible();
    await freezeLoop(page);
    await page
      .locator(".easyStage")
      .click({ position: { x: 120, y: 320 }, force: true });
    await expect(page.getByTestId("focus-reticle")).toBeVisible();
    return page.evaluate(() => {
      const box = document.querySelector(".easyReticleBox")!;
      const style = getComputedStyle(box);
      const dot = getComputedStyle(box, "::after");
      const rect = document
        .querySelector("[data-testid=focus-reticle]")!
        .getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        borderWidth: style.borderTopWidth,
        borderStyle: style.borderTopStyle,
        borderColor: style.borderTopColor,
        radius: style.borderTopLeftRadius,
        shadow: style.boxShadow,
        dotColor: dot.backgroundColor,
        dotSize: [dot.width, dot.height],
      };
    });
  }

  test("88 px, drafting blue #0A64E0, 2 px, 12 px radius, a centre dot, and a thin white halo", async ({
    page,
  }) => {
    const reticle = await tapAndReadReticle(page);
    expect(reticle.width).toBeCloseTo(88, 0);
    expect(reticle.height).toBeCloseTo(88, 0);
    expect(reticle.borderWidth).toBe("2px");
    expect(reticle.borderStyle).toBe("solid");
    expect(reticle.borderColor).toBe("rgb(10, 100, 224)");
    expect(reticle.radius).toBe("12px");
    expect(reticle.dotColor).toBe("rgb(10, 100, 224)");
    expect(reticle.dotSize).toEqual(["6px", "6px"]);
    // The halo: white, 1 px, nearly opaque, so the blue does not vanish on a dark picture.
    expect(reticle.shadow).toContain(
      "rgba(255, 255, 255, 0.9) 0px 0px 0px 1px",
    );
  });

  test("with increased contrast it is still blue, and gets a white then black ring so it shows on a bright picture", async ({
    page,
  }) => {
    await page.emulateMedia({ contrast: "more" });
    const reticle = await tapAndReadReticle(page);
    // Not white: a plain white stroke vanishes on a bright picture.
    expect(reticle.borderColor).toBe("rgb(10, 100, 224)");
    expect(parseFloat(reticle.borderWidth)).toBeGreaterThanOrEqual(2);
    expect(reticle.shadow).toContain("rgb(255, 255, 255) 0px 0px 0px 2px");
    expect(reticle.shadow).toContain("rgb(0, 0, 0) 0px 0px 0px 3px");
  });

  test("also when the camera is slow to start (the loop is frozen only once it is sampling)", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const media = navigator.mediaDevices;
      const real = media.getUserMedia.bind(media);
      media.getUserMedia = async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return real(...args);
      };
    });
    const reticle = await tapAndReadReticle(page);
    expect(reticle.borderColor).toBe("rgb(10, 100, 224)");
    expect(reticle.width).toBeCloseTo(88, 0);
  });
});

test.describe("fix round 1: a very tall sheet does not shrink the photo to a thumbnail", () => {
  test("the sheet stops at 52vh and scrolls inside; the photo stays at 0.4 or more", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { sheet } = await captureAndMeasure(page);
    await expect(page.locator(".easyStageContent.moved")).toBeAttached();
    // What a large system font does to the sheet: far more content than fits.
    await sheet.evaluate((el) => {
      const extra = document.createElement("div");
      extra.style.height = "1200px";
      el.appendChild(extra);
    });
    await expect
      .poll(
        async () =>
          (await sheet.evaluate((el) => el.getBoundingClientRect().height)) <=
          0.52 * 844 + 1,
        { timeout: 3_000 },
      )
      .toBe(true);
    await page.waitForTimeout(300);
    const measured = await sheet.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      scrolls: el.scrollHeight > el.clientHeight + 100,
    }));
    const scale = await page
      .locator(".easyStageContent.moved")
      .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    console.log(
      `tall sheet: ${measured.height.toFixed(0)} px of ${(0.52 * 844).toFixed(0)} px allowed, scrolls inside: ${measured.scrolls}, photo scale ${scale.toFixed(3)}`,
    );
    expect(measured.height).toBeLessThanOrEqual(0.52 * 844 + 1);
    expect(measured.scrolls).toBe(true);
    expect(scale).toBeGreaterThanOrEqual(0.4 - 1e-6);
    expect(scale).toBeLessThanOrEqual(0.9 + 1e-6);
  });
});

test.describe("fix round 1: a browser whose getSettings throws", () => {
  test("the camera still opens, focus is skipped, the scan still runs, and the debug panel shows no track", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      MediaStreamTrack.prototype.getSettings = () => {
        throw new DOMException("no settings", "InvalidStateError");
      };
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto("/scan/easy?debug=1");
    await page.getByRole("button", { name: "Got it" }).click();
    await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible();
    await expect(page.getByTestId("scan-debug-panel")).toBeVisible();
    // The scan carries on to a result.
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      /processing|gateFailure/,
      { timeout: 20_000 },
    );
    expect(errors).toEqual([]);
  });
});

test.describe("fix round 1: the close button is a circle", () => {
  const closeBox = async (page: Page) => {
    const box = await page
      .getByRole("button", { name: "Close camera, back to Home" })
      .boundingBox();
    const radius = await page
      .getByRole("button", { name: "Close camera, back to Home" })
      .evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    return { width: box!.width, height: box!.height, radius };
  };

  test("44 x 44 with a 50% radius (a true circle): live, with increased contrast, and behind the measured sheet", async ({
    page,
  }) => {
    await holdPipeline(page);
    await openLive(page);
    const live = await closeBox(page);
    await page.emulateMedia({ contrast: "more" });
    const contrastMore = await closeBox(page);
    await page.emulateMedia({ contrast: "no-preference" });
    await release(page);
    await expect(
      page.getByRole("dialog", { name: "Hand measured" }),
    ).toBeVisible({ timeout: 20_000 });
    const measured = await closeBox(page);
    console.log(
      `close button: ${JSON.stringify({ live, contrastMore, measured })}`,
    );
    for (const [name, box] of Object.entries({
      live,
      contrastMore,
      measured,
    })) {
      expect(box.width, `${name} width`).toBeCloseTo(44, 1);
      expect(box.height, `${name} height`).toBeCloseTo(44, 1);
      expect(box.radius, `${name} radius`).toBe("50%");
    }
  });
});

test.describe("fix round 2: the outline is drawn as centred segments", () => {
  test("four edges, each centred on its own origin, each laid by a transform and never turned a full circle", async ({
    page,
  }) => {
    await holdPipeline(page);
    await openLive(page);
    // Wait until the dots are found, so the edges have real corners to lie on.
    await expect(page.locator(".easyCorner[data-found=true]")).toHaveCount(4, {
      timeout: 20_000,
    });
    const edges = await page.locator(".easyEdge").evaluateAll((els) =>
      els.map((el) => {
        const style = getComputedStyle(el);
        const m = new DOMMatrix(style.transform);
        return {
          left: style.left,
          origin: style.transformOrigin,
          angle: Math.atan2(m.b, m.a),
        };
      }),
    );
    expect(edges).toHaveLength(4);
    for (const edge of edges) {
      expect(edge.left).toBe("-0.5px");
      expect(edge.origin).toBe("0.5px 1px");
      // Unwrapped against nothing yet, so within a half turn either way.
      expect(Math.abs(edge.angle)).toBeLessThanOrEqual(Math.PI / 2 + 1e-6);
    }
    await release(page);
  });
});

test.describe("fix round 2: large text", () => {
  for (const percent of [100, 150, 200]) {
    test(`at ${percent}% text size nothing drawn is under the sheet or under the top bar`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await holdPipeline(page);
      await openLive(page);
      await page.evaluate((percent) => {
        document.documentElement.style.fontSize = `${percent}%`;
      }, percent);
      await expect(page.locator(".easyStage")).toHaveAttribute(
        "data-phase",
        "processing",
        { timeout: 20_000 },
      );
      await release(page);
      const sheet = page.getByRole("dialog", { name: "Hand measured" });
      await expect(sheet).toBeVisible({ timeout: 20_000 });
      await expect(page.locator(".easyStageContent.moved")).toBeAttached();
      await page.waitForTimeout(700); // the sheet settles, the lines are drawn
      const layout = await page.evaluate(() => {
        const rect = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        };
        const parts = (selector: string) =>
          [...document.querySelectorAll(selector)].map(rect);
        const bar = document.querySelector(".cameraTopBar")!;
        // The top bar's own controls, not its empty middle.
        const controls = [...bar.querySelectorAll("button")].map(rect);
        return {
          sheet: rect(document.querySelector("dialog.easyResultSheet")!),
          barBottom: Math.max(...controls.map((c) => c.bottom)),
          checks: parts(".easyCornerCheck circle"),
          lines: parts(".easyDimLine"),
          labels: parts(".easyDimLabelBg"),
          scale: new DOMMatrix(
            getComputedStyle(document.querySelector(".easyStageContent.moved")!)
              .transform,
          ).a,
        };
      });
      const drawn = [...layout.checks, ...layout.lines, ...layout.labels];
      expect(layout.checks).toHaveLength(4);
      expect(layout.lines).toHaveLength(2);
      expect(layout.labels).toHaveLength(2);
      const lowest = Math.max(...drawn.map((r) => r.bottom));
      const highest = Math.min(...drawn.map((r) => r.top));
      console.log(
        `text ${percent}%: photo scale ${layout.scale.toFixed(3)}, top bar ends ${layout.barBottom.toFixed(0)} px, highest drawn part ${highest.toFixed(0)} px, lowest ${lowest.toFixed(0)} px, sheet top ${layout.sheet.top.toFixed(0)} px (sheet ${(layout.sheet.bottom - layout.sheet.top).toFixed(0)} px tall)`,
      );
      // Not under the sheet...
      expect(lowest).toBeLessThanOrEqual(layout.sheet.top);
      // ...nor under the top bar's buttons...
      expect(highest).toBeGreaterThanOrEqual(layout.barBottom);
      // ...and on the screen.
      for (const r of drawn) {
        expect(r.left).toBeGreaterThanOrEqual(0);
        expect(r.right).toBeLessThanOrEqual(390);
      }
    });
  }
});

/**
 * Fix round 3: the buttons that finish the sheet are pinned at its foot. At
 * 200% text the capped sheet (52vh) scrolls inside, and the main action used to
 * be below the fold. Two phones: 390x844 and the small 360x640.
 */
const PINNED_PHONES = [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
] as const;

type PinnedLayout = {
  viewport: { width: number; height: number };
  sheet: { top: number; bottom: number; height: number };
  scrollable: boolean;
  scale: number;
  barBottom: number;
  /** Drawn parts of the measurement, in the photo. */
  drawn: { top: number; bottom: number; left: number; right: number }[];
  /** How many of them have their middle under a button of the top bar. */
  middleUnderBar: number;
  main: {
    label: string;
    rect: { top: number; bottom: number; left: number; right: number };
    /** The element that is on top at the middle of the button. */
    onTopIsIt: boolean;
  };
  retake: { top: number; bottom: number; onTopIsIt: boolean } | null;
  row: { top: number; bottom: number; background: string; position: string };
  sheetBackground: string;
  /** Scrolled to the end: the lowest of the content above the row, and the row. */
  endOfContent: { contentBottom: number; rowTop: number };
};

/** Open the measured (or retake) sheet at `percent` text on `phone`, and read how it is laid out. */
async function pinnedLayout(
  page: Page,
  phone: { width: number; height: number },
  percent: number,
  kind: "measured" | "retake",
): Promise<PinnedLayout> {
  await page.setViewportSize(phone);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await holdPipeline(page);
  await openLive(
    page,
    kind === "retake" ? `${LIVE_DEMO}?result=retake` : LIVE_DEMO,
  );
  await page.evaluate((percent) => {
    document.documentElement.style.fontSize = `${percent}%`;
  }, percent);
  await expect(page.locator(".easyStage")).toHaveAttribute(
    "data-phase",
    "processing",
    { timeout: 20_000 },
  );
  await release(page);
  const sheet = page.getByRole("dialog", {
    name: kind === "retake" ? "Retake needed" : "Hand measured",
  });
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".easyStageContent.moved")).toBeAttached();
  await page.waitForTimeout(700); // the sheet settles, the lines are drawn
  return page.evaluate((kind) => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    const dialog = document.querySelector<HTMLElement>(
      "dialog.easyResultSheet",
    )!;
    const onTop = (el: Element) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return hit === el || el.contains(hit);
    };
    const bar = document.querySelector(".cameraTopBar")!;
    const main = document.querySelector<HTMLElement>(
      kind === "retake"
        ? ".easyTryAgainButton"
        : ".easySeeMatches .primaryButton",
    )!;
    const retake = document.querySelector<HTMLElement>(".easyRetakeButton");
    const row = dialog.querySelector<HTMLElement>(".easyStickyActions")!;
    const rowStyle = getComputedStyle(row);
    const sheetRect = rect(dialog);
    const drawn = [
      ...document.querySelectorAll(
        ".easyCornerCheck circle, .easyDimLine, .easyDimLabelBg, .easyProblem",
      ),
    ].map(rect);
    const middleUnderBar = [
      ...document.querySelectorAll(
        ".easyCornerCheck circle, .easyDimLine, .easyDimLabelBg, .easyProblem",
      ),
    ].filter((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2,
      );
      return !!hit?.closest(".cameraTopBar");
    }).length;
    // To the end of the content: what is above the row must clear it.
    const scrollable = dialog.scrollHeight > dialog.clientHeight + 1;
    dialog.scrollTop = dialog.scrollHeight;
    const above = [...dialog.children].filter(
      (child) => child !== row && !child.matches("details"),
    );
    const contentBottom = Math.max(
      ...above.map((child) => child.getBoundingClientRect().bottom),
    );
    const rowTop = row.getBoundingClientRect().top;
    dialog.scrollTop = 0;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      sheet: {
        top: sheetRect.top,
        bottom: sheetRect.bottom,
        height: dialog.offsetHeight,
      },
      scrollable,
      scale: new DOMMatrix(
        getComputedStyle(document.querySelector(".easyStageContent.moved")!)
          .transform,
      ).a,
      barBottom: Math.max(
        ...[...bar.querySelectorAll("button")].map(
          (b) => b.getBoundingClientRect().bottom,
        ),
      ),
      drawn,
      middleUnderBar,
      main: {
        label: main.textContent ?? "",
        rect: rect(main),
        onTopIsIt: onTop(main),
      },
      retake: retake
        ? {
            top: rect(retake).top,
            bottom: rect(retake).bottom,
            onTopIsIt: onTop(retake),
          }
        : null,
      row: {
        top: rect(row).top,
        bottom: rect(row).bottom,
        background: rowStyle.backgroundColor,
        position: rowStyle.position,
      },
      sheetBackground: getComputedStyle(dialog).backgroundColor,
      endOfContent: { contentBottom, rowTop },
    };
  }, kind);
}

test.describe("fix round 3: the actions stay in view at large text", () => {
  for (const phone of PINNED_PHONES) {
    for (const percent of [100, 150, 200]) {
      for (const kind of ["measured", "retake"] as const) {
        test(`${phone.width}x${phone.height} at ${percent}% text: the ${kind === "retake" ? "Try again" : "See my matches"} button is fully on screen and in front`, async ({
          page,
        }) => {
          const l = await pinnedLayout(page, phone, percent, kind);
          const pinned = l.main.rect;
          console.log(
            `${phone.width}x${phone.height}, text ${percent}%, ${kind}: sheet ${l.sheet.height.toFixed(0)} px of ${l.viewport.height} (cap ${(0.52 * l.viewport.height).toFixed(0)}), scrolls inside: ${l.scrollable}, photo scale ${l.scale.toFixed(3)}, main button ${pinned.top.toFixed(0)}-${pinned.bottom.toFixed(0)} px, row ${l.row.position}`,
          );
          // The cap holds and the sheet sits on the bottom edge...
          expect(l.sheet.height).toBeLessThanOrEqual(
            0.52 * l.viewport.height + 1,
          );
          expect(l.sheet.bottom).toBeCloseTo(l.viewport.height, 0);
          // ...and the main action is inside the screen, inside the sheet, and
          // nothing covers it.
          expect(pinned.top).toBeGreaterThanOrEqual(l.sheet.top);
          expect(pinned.bottom).toBeLessThanOrEqual(l.viewport.height);
          expect(pinned.left).toBeGreaterThanOrEqual(0);
          expect(pinned.right).toBeLessThanOrEqual(l.viewport.width);
          expect(l.main.onTopIsIt).toBe(true);
          if (l.retake) {
            expect(l.retake.top).toBeGreaterThanOrEqual(l.sheet.top);
            expect(l.retake.bottom).toBeLessThanOrEqual(l.viewport.height);
            expect(l.retake.onTopIsIt).toBe(true);
          }
          // The row is what holds it there, and it has the sheet's own
          // (opaque) background, so what scrolls behind it does not show.
          expect(l.row.position).toBe("sticky");
          expect(l.row.background).toBe(l.sheetBackground);
          // Scrolled to the end, nothing of the content is left under the row.
          expect(l.endOfContent.contentBottom).toBeLessThanOrEqual(
            l.endOfContent.rowTop + 0.5,
          );
        });
      }
    }
  }

  for (const phone of PINNED_PHONES) {
    for (const percent of [100, 150, 200]) {
      test(`${phone.width}x${phone.height} at ${percent}% text: nothing drawn on the photo is under the sheet or the top bar`, async ({
        page,
      }) => {
        const l = await pinnedLayout(page, phone, percent, "measured");
        expect(l.drawn.length).toBeGreaterThanOrEqual(8); // 4 checks, 2 lines, 2 labels
        const lowest = Math.max(...l.drawn.map((r) => r.bottom));
        const highest = Math.min(...l.drawn.map((r) => r.top));
        console.log(
          `${phone.width}x${phone.height}, text ${percent}%: photo scale ${l.scale.toFixed(3)}, top bar ends ${l.barBottom.toFixed(0)} px, highest drawn part ${highest.toFixed(0)} px, lowest ${lowest.toFixed(0)} px, sheet top ${l.sheet.top.toFixed(0)} px`,
        );
        for (const r of l.drawn) {
          expect(r.left).toBeGreaterThanOrEqual(0);
          expect(r.right).toBeLessThanOrEqual(l.viewport.width);
        }
        // Not under the sheet...
        expect(lowest).toBeLessThanOrEqual(l.sheet.top);
        // ...nor under the top bar's buttons. The one accepted exception
        // (README, "Accepted limits"): on the 360x640 phone at 200% text the
        // top bar is 139 px tall and the paper's band is 6 px short of clearing
        // it, so a check mark touches the hand chip by a few px. Its middle is
        // clear of the chip: it stays visible.
        const accepted = phone.height === 640 && percent === 200;
        if (accepted) {
          expect(l.barBottom - highest).toBeLessThanOrEqual(8);
        } else {
          expect(highest).toBeGreaterThanOrEqual(l.barBottom);
        }
        expect(l.middleUnderBar).toBe(0);
      });
    }
  }

  test("the keyboard reaches every control in the sheet in reading order, each one visible and ringed, none under the pinned row", async ({
    page,
  }) => {
    await pinnedLayout(page, { width: 360, height: 640 }, 200, "measured");
    // The sheet focuses its heading when it opens; Tab goes on from there.
    const stops = [] as {
      name: string;
      inRow: boolean;
      visible: boolean;
      ring: string;
      ringWidth: number;
    }[];
    for (let press = 0; press < 12; press++) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        const dialog = document.querySelector<HTMLElement>(
          "dialog.easyResultSheet",
        )!;
        if (!el || !dialog.contains(el)) return null;
        const row = dialog.querySelector(".easyStickyActions")!;
        const r = el.getBoundingClientRect();
        const d = dialog.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        const style = getComputedStyle(el);
        return {
          name:
            el.getAttribute("aria-label") ??
            (el.textContent ?? "").trim().slice(0, 30),
          inRow: row.contains(el),
          // Inside the sheet's box, and the thing on top at its middle.
          visible:
            r.top >= d.top - 0.5 &&
            r.bottom <= d.bottom + 0.5 &&
            (hit === el || el.contains(hit)),
          ring: style.outlineStyle,
          ringWidth: parseFloat(style.outlineWidth),
        };
      });
      if (!stop || stops.some((s) => s.name === stop.name)) break;
      stops.push(stop);
    }
    console.log(
      `focus order: ${stops.map((s) => `${s.name}${s.inRow ? " [row]" : ""}`).join(" > ")}`,
    );
    const names = stops.map((s) => s.name);
    // Grip chips, then Retake photo, then See my matches: the DOM's order.
    expect(names.slice(0, 4)).toEqual([
      "Palm",
      "Claw",
      "Fingertip",
      "Not sure",
    ]);
    expect(names[4]).toBe("Retake photo");
    expect(stops.length).toBeGreaterThanOrEqual(6);
    expect(stops[5].inRow).toBe(true);
    for (const stop of stops) {
      expect(stop.visible, `${stop.name} is visible and not covered`).toBe(
        true,
      );
      expect(stop.ring, `${stop.name} has a focus ring`).toBe("solid");
      expect(stop.ringWidth).toBeGreaterThanOrEqual(2);
    }
  });

  test("dark mode: the pinned row wears the dark sheet's background, not the light one", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const l = await pinnedLayout(
      page,
      { width: 360, height: 640 },
      200,
      "measured",
    );
    // --scan-bg in dark mode is #161617 (src/app/scan/scan.css).
    expect(l.sheetBackground).toBe("rgb(22, 22, 23)");
    expect(l.row.background).toBe("rgb(22, 22, 23)");
    expect(l.main.onTopIsIt).toBe(true);
    expect(l.main.rect.bottom).toBeLessThanOrEqual(l.viewport.height);
  });
});
