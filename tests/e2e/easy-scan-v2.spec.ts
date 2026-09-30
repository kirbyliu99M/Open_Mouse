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
      await computed(page, ".easyStageContent", [
        "transition-duration",
        "animation-name",
        "animation-duration",
      ]),
    ).toEqual({
      "transition-duration": "0s",
      "animation-name": "easyFadeIn",
      "animation-duration": "0.12s",
    });
    await expect(page.locator(".easyStageContent")).toHaveClass(/moved/);
    const transform = await page
      .locator(".easyStageContent")
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
      await computed(page, ".easyStageContent", ["transition-duration"]),
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

/** Holds the live loop where it is, so the auto-shutter cannot fire mid-test. */
async function freezeLoop(page: Page) {
  await expect(page.locator(".cameraCue")).toBeVisible();
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
    await expect(page.locator(".easyStageContent")).toHaveClass(/moved/);
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
    const layer = await page.locator(".easyStageContent").evaluate((el) => {
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
    await expect(page.locator(".easyStageContent")).toHaveClass(/moved/);
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
    await expect(page.locator(".easyStageContent")).toHaveClass(/moved/);
    await page.waitForTimeout(400);
    const layerTransform = () =>
      page
        .locator(".easyStageContent")
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
      extra.style.height = "120px";
      el.appendChild(extra);
    });
    await expect
      .poll(async () => (await sheet.boundingBox())!.y, { timeout: 3_000 })
      .toBeLessThan(topBefore - 100);
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
