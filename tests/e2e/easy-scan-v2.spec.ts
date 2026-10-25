import { expect, test, type Page } from "@playwright/test";
import { contrast, overWhite } from "./fixtures/contrast";
import { installLoopFreeze, loopFrozen } from "./fixtures/freeze-loop";
import { bestRowOff, decodePng } from "./fixtures/png";
import {
  confirmAutoFrame,
  expectNothingMeasuredShown,
} from "./fixtures/confirm-frame";
import { uploadGreyPhoto } from "./fixtures/slow-model";
import {
  expectSettled,
  leavingRecords,
  leftWith,
  recordLeaving,
} from "./fixtures/leaving";

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
    await confirmAutoFrame(page);
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

  test("the frozen photo is drawn exactly where the live picture was: it is the part of the video that was on screen, so it fills the stage", async ({
    page,
  }) => {
    await holdPipeline(page);
    // The video element is on screen before its first frame, and it is gone
    // again once the auto-shutter has fired, which on a busy machine can be
    // before a test gets to look (this read 0 x 0 once in a full run and
    // null under load). So its size is taken by a listener in the page, at the
    // moment the stream is playing.
    await page.addInitScript(() => {
      document.addEventListener(
        "playing",
        (event) => {
          const v = event.target as HTMLVideoElement;
          (window as Window & { __liveVideoSize?: unknown }).__liveVideoSize = {
            width: v.videoWidth,
            height: v.videoHeight,
          };
        },
        true,
      );
    });
    await openLive(page);
    await page.waitForFunction(
      () =>
        (window as Window & { __liveVideoSize?: { width: number } })
          .__liveVideoSize?.width,
      undefined,
      { polling: 100, timeout: 20_000 },
    );
    const video = (await page.evaluate(
      () => (window as Window & { __liveVideoSize?: unknown }).__liveVideoSize,
    )) as { width: number; height: number };
    expect(video.width).toBeGreaterThan(0);
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "processing",
      { timeout: 20_000 },
    );
    const photo = await box(page, "svg.easyFrozenSvg");
    // The shutter takes the part of the stream the stage showed (object-fit:
    // cover), so the frozen photo has the stage's own shape and covers it to
    // the pixel: no jump between the live picture and the frozen one. (Before
    // frame capture the photo was the whole stream and was drawn wider or
    // taller than the stage.)
    expect(Math.abs(photo.width - 390)).toBeLessThanOrEqual(1);
    expect(Math.abs(photo.height - 844)).toBeLessThanOrEqual(1);
    expect(photo.x + photo.width / 2).toBeCloseTo(195, 0);
    expect(photo.y + photo.height / 2).toBeCloseTo(422, 0);
    // ...while the stream behind it is not that shape.
    expect(video.width / video.height).not.toBeCloseTo(390 / 844, 1);
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
      "attempts",
      "capabilities",
      "capture",
      "focusApplied",
      "live",
      "preview",
      "track",
      "userAgent",
    ]);
    expect(Array.isArray(json.attempts)).toBe(true);
    expect(json.userAgent).toMatch(/Chrome/);
    expect(json.track).toMatchObject({ width: 800, height: 1300 });
    expect(json.capabilities.focusMode).toEqual([]);
    expect(json.live.laplacianFloor).toBe(15);
    expect(json.live.samplesPerSecond).toBeGreaterThan(3);
    expect(json.live.samplesPerSecond).toBeLessThan(9);
    expect(json.live.detectionMsAverage).toBeGreaterThan(0);
    expect(json.live.detectionMsP95).toBeGreaterThanOrEqual(
      json.live.detectionMsAverage * 0.5,
    );
    expect(json.live.cornersSeen).toBe(4);
    // A frame of the video cut to the part on screen, not the camera's photo.
    expect(json.capture.method).toBe("canvas");
    expect(json.capture.source).toBe("frame");
    expect(json.capture.stillWidth).toBeGreaterThan(0);
    expect(json.capture.stillKb).toBeGreaterThan(0);
    expect(json.capture.ringCompleteToFrozenMs).toBeGreaterThan(0);

    await release(page);
    await confirmAutoFrame(page);
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
    // The live loop takes the photo by itself about a second after the camera
    // starts, and on /scan/easy the fake camera has no hand, so the result
    // sheet opens within a second more. The debug panel then moves into that
    // sheet as a new copy of itself, and the box this test waits for is gone
    // with the old one: a window of about a second, which a slow runner (CI)
    // can spend before the first check. So the pipeline is held, as in the
    // test above, and the capture is waited for: the panel is where it will
    // stay for as long as the test takes.
    await holdPipeline(page);
    await openLive(page, `${LIVE_DEMO}?debug=1`);
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "processing",
      { timeout: 20_000 },
    );
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
  await confirmAutoFrame(page);
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
  test("every property the scan flow animates or transitions is one of those two (two named exceptions)", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as Window & { __animated?: string[] };
      w.__animated = [];
      addEventListener(
        "transitionrun",
        (event) => {
          const property = (event as TransitionEvent).propertyName;
          // The cue's colour is allowed on the cue alone (V3.2 motion pass
          // #20): anywhere else a background-color transition still fails.
          const onCue =
            property === "background-color" &&
            (event.target as Element).classList?.contains("cameraCue");
          w.__animated!.push(
            `transition:${onCue ? "cue-background-color" : property}`,
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
    // The deliberate exceptions: the shutter ring's fill, a 96 px SVG circle
    // (camera.css, unchanged from before this slice), and the cue's colour
    // turning green (V3.2 motion pass #20: a colour, nothing moves).
    const allowed = new Set([
      "transform",
      "opacity",
      "stroke-dashoffset",
      "cue-background-color",
    ]);
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
 *
 * `constraintsSeen` returns the FOCUS constraints only (the ones with an
 * `advanced` list). Since the preview is asked for in the photo's shape
 * (previewConstraints.ts) the running track is also asked for a size now and
 * then (a photo that is not 4:3, or the one swapped retry on a mismatch; the
 * fake camera's 800x1300 is far from 4:3, so it gets that retry). Those
 * are size requests, not focus ones, and their timing is not what these focus
 * tests are about; scan-fov.spec.ts covers them.
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
  page.evaluate(() =>
    (
      (window as Window & { __constraints?: object[] }).__constraints ?? []
    ).filter((constraints) => "advanced" in constraints),
  );

/**
 * Holds the live loop where it is, so the auto-shutter cannot fire mid-test:
 * `armLoopFreeze` BEFORE the page loads, `freezeLoop` after it to wait for the
 * hold.
 *
 * The loop is stopped in the page, in the same tick as the fourth corner is
 * marked found (fixtures/freeze-loop.ts: a wrapped requestAnimationFrame and a
 * MutationObserver). It used to be polled for from here and stubbed afterwards,
 * and on a busy machine the gap was long enough for the ring to fill and the
 * auto-shutter to replace the viewfinder: 11 of 60 runs failed that way under
 * load. The fixture's four corners found means the loop has SAMPLED; the cue
 * line is on screen from the start, long before, and holding then would leave
 * a screen with no camera behind it.
 */
const armLoopFreeze = (page: Page) =>
  installLoopFreeze(page, {
    selector: ".easyCorner[data-found=true]",
    count: 4,
  });
async function freezeLoop(page: Page) {
  await expect(page.locator(".easyStage video.cameraVideo.ready")).toBeVisible({
    timeout: 20_000,
  });
  await loopFrozen(page);
}

test.describe("AC3 and AC4: focus", () => {
  test("a camera that reports focusMode is put in continuous focus; a tap focuses once at that point and shows the reticle", async ({
    page,
  }) => {
    await fakeFocusSupport(page, true);
    await armLoopFreeze(page);
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
    await armLoopFreeze(page);
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
        return { width: 800, height: 1300, pointsOfInterest: [] };
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
    await confirmAutoFrame(page);
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
    // A frame of the video cut to the part on screen, not the camera's photo.
    expect(json.capture.method).toBe("canvas");
    expect(json.capture.source).toBe("frame");
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
    // F15: the measured layer appears once the frame is confirmed.
    await confirmAutoFrame(page);
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
    await armLoopFreeze(page);
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

  test("88 px, the accent fill (--accent, #1F6BF0), 2 px, 12 px radius, a centre dot, and a thin white halo", async ({
    page,
  }) => {
    const reticle = await tapAndReadReticle(page);
    expect(reticle.width).toBeCloseTo(88, 0);
    expect(reticle.height).toBeCloseTo(88, 0);
    expect(reticle.borderWidth).toBe("2px");
    expect(reticle.borderStyle).toBe("solid");
    expect(reticle.borderColor).toBe("rgb(31, 107, 240)");
    expect(reticle.radius).toBe("12px");
    expect(reticle.dotColor).toBe("rgb(31, 107, 240)");
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
    expect(reticle.borderColor).toBe("rgb(31, 107, 240)");
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
    expect(reticle.borderColor).toBe("rgb(31, 107, 240)");
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
    await confirmAutoFrame(page);
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
      await confirmAutoFrame(page);
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
  /** Things in the sheet whose text does not fit inside their own box (cut off or spilling out). */
  spilling: string[];
  /** The dimension labels that are not wholly inside the photo they are drawn on. */
  labelsOutsidePhoto: number;
  /** How tall the scrolling part of the sheet is above the pinned row. */
  contentAboveRow: number;
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
  if (kind === "measured") await confirmAutoFrame(page);
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
    // Text that does not fit its box: the label of a button that has been
    // given a fixed height, a chip that cuts its own word short.
    const spilling = [
      ...dialog.querySelectorAll<HTMLElement>(
        ".easyRetakeButton, .easySeeMatches .primaryButton, .easyTryAgainButton, .easyEditLengthButton",
      ),
    ]
      .filter(
        (el) =>
          el.scrollWidth > el.clientWidth + 1 ||
          el.scrollHeight > el.clientHeight + 1,
      )
      .map(
        (el) =>
          `${el.className.split(" ")[0]} "${(el.textContent ?? "").trim()}" (content ${el.scrollWidth}x${el.scrollHeight} in a ${el.clientWidth}x${el.clientHeight} box)`,
      );
    const photo = document
      .querySelector(".easyStageContent.moved .easyFrozenSvg")
      ?.getBoundingClientRect();
    const labelsOutsidePhoto = photo
      ? [...document.querySelectorAll(".easyDimLabelBg")].filter((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.left < photo.left - 1 ||
            r.right > photo.right + 1 ||
            r.top < photo.top - 1 ||
            r.bottom > photo.bottom + 1
          );
        }).length
      : -1;
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
      spilling,
      labelsOutsidePhoto,
      contentAboveRow: rect(row).top - sheetRect.top,
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
        test(`${phone.width}x${phone.height} at ${percent}% text: the ${kind === "retake" ? "Try again" : "Continue"} button is fully on screen and in front`, async ({
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
          // Its text fits in it: at large text the label wraps and the button
          // grows, it does not spill out of a fixed height.
          expect(l.spilling, "text that does not fit its box").toEqual([]);
          // The row does not eat the sheet: the part that scrolls keeps at
          // least 100 px above it.
          expect(l.contentAboveRow).toBeGreaterThanOrEqual(100);
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
        // The labels are fixed-size pills; on a photo at its smallest scale
        // they are kept inside it, not cut off by its edge.
        expect(l.labelsOutsidePhoto, "labels not wholly on the photo").toBe(0);
      });
    }
  }

  const KEYBOARD_SCREENS = [
    { width: 360, height: 640, percent: 200 },
    { width: 390, height: 844, percent: 150 },
    { width: 390, height: 844, percent: 200 },
    { width: 360, height: 568, percent: 100 },
    { width: 360, height: 568, percent: 200 },
  ] as const;
  for (const screen of KEYBOARD_SCREENS) {
    test(`${screen.width}x${screen.height} at ${screen.percent}% text: the keyboard reaches every control in reading order, each one visible, its lowest pixels and its focus ring too, none under the pinned row or its fade`, async ({
      page,
    }) => {
      await pinnedLayout(page, screen, screen.percent, "measured");
      // The sheet focuses its heading when it opens; Tab goes on from there.
      const stops = [] as {
        name: string;
        inRow: boolean;
        visible: boolean;
        lowestVisible: boolean;
        ring: string;
        ringWidth: number;
        /** How far the fade above the pinned row reaches, and how far clear of it the ring's lowest edge is. */
        fadeReach: number;
        clearOfFade: number;
        ringBottom: { x: number; y: number; width: number; height: number };
        ringColour: string;
        dpr: number;
      }[];
      const seen = [] as string[];
      for (let press = 0; press < 12; press++) {
        await page.keyboard.press("Tab");
        const stop = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          const dialog = document.querySelector<HTMLElement>(
            "dialog.easyResultSheet",
          )!;
          if (!el || !dialog.contains(el) || el === dialog) return null;
          const row = dialog.querySelector(".easyStickyActions")!;
          const r = el.getBoundingClientRect();
          const d = dialog.getBoundingClientRect();
          const onTopAt = (x: number, y: number) => {
            const hit = document.elementFromPoint(x, y);
            return hit === el || el.contains(hit);
          };
          const style = getComputedStyle(el);
          const ringWidth = parseFloat(style.outlineWidth);
          const ringOffset = parseFloat(style.outlineOffset);
          // The fade is the row's box-shadow: its reach above the row is the
          // vertical offset (upwards) plus the blur.
          const shadow = getComputedStyle(row).boxShadow.match(
            /(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/,
          );
          const fadeReach = shadow
            ? Math.max(0, -parseFloat(shadow[2])) + parseFloat(shadow[3])
            : 0;
          const rowTop = row.getBoundingClientRect().top;
          const ringLowest = r.bottom + ringOffset + ringWidth;
          const inRow = row.contains(el);
          return {
            name:
              el.getAttribute("aria-label") ??
              (el.textContent ?? "").trim().slice(0, 30),
            inRow,
            // Inside the sheet's box, and the thing on top at its middle...
            visible:
              r.top >= d.top - 0.5 &&
              r.bottom <= d.bottom + 0.5 &&
              onTopAt(r.left + r.width / 2, r.top + r.height / 2),
            // ...and at its lowest pixels, not only the middle.
            lowestVisible:
              onTopAt(r.left + r.width * 0.4, r.bottom - 2) &&
              onTopAt(r.left + r.width * 0.5, r.bottom - 2) &&
              onTopAt(r.left + r.width * 0.6, r.bottom - 2),
            ring: style.outlineStyle,
            ringWidth,
            fadeReach,
            clearOfFade: inRow ? Infinity : rowTop - ringLowest,
            // Where the ring's lowest edge is painted, to look at its pixels:
            // the middle sixth of the control's width (a round button is only
            // that low there), the ring's whole thickness, and a pixel more
            // on every side, so that at any sub-pixel position the band holds
            // the ring's full rows (and the blended rows at its edges, which
            // the row-by-row look below sets aside).
            ringBottom: {
              x: r.left + r.width * 0.425 - 1,
              y: r.bottom + ringOffset - 1,
              width: r.width * 0.15 + 2,
              height: ringWidth + 2,
            },
            ringColour: style.outlineColor,
            // The page behind the ring, from the token and not typed in here.
            pageColour: getComputedStyle(document.documentElement)
              .getPropertyValue("--bg")
              .trim(),
            dpr: window.devicePixelRatio,
          };
        });
        if (!stop) break;
        seen.push(stop.name);
        if (stops.some((s) => s.name === stop.name)) break;
        // Let the scroll that the focus caused settle before looking.
        await page.waitForTimeout(120);
        stops.push(stop);
        const png = decodePng(
          await page.screenshot({ clip: stop.ringBottom, type: "png" }),
        );
        const want = (stop.ringColour.match(/[\d.]+/g) ?? []).map(Number);
        // The ring's colour, row by row: the best row of the band. A ring
        // painted in full has rows of exactly its colour; the rows at its
        // edges are blended with what is behind them, and at a fractional
        // layout position (a wider font moves everything by a fraction of a
        // pixel) the band's own average is too. A ring covered by the pinned
        // row's fade has no such row.
        const behind = (stop.pageColour.match(/[\da-f]{2}/gi) ?? []).map((h) =>
          parseInt(h, 16),
        );
        Object.assign(stop, {
          ringPixelOff: bestRowOff(png, want),
          // The check can tell the ring from the page behind it, or it would
          // pass on anything.
          ringToPage: Math.max(
            Math.abs(want[0]! - behind[0]!),
            Math.abs(want[1]! - behind[1]!),
            Math.abs(want[2]! - behind[2]!),
          ),
        });
      }
      console.log(
        `${screen.width}x${screen.height} ${screen.percent}%: focus order ${stops.map((s) => `${s.name}${s.inRow ? " [row]" : ""}`).join(" > ")}; fade reaches ${stops[0]?.fadeReach.toFixed(0)} px; ring clear of it by ${stops
          .filter((s) => s.clearOfFade !== Infinity)
          .map((s) => s.clearOfFade.toFixed(1))
          .join(", ")} px`,
      );
      console.log(
        `${screen.width}x${screen.height} ${screen.percent}%: best-row ring offsets (limit 12): ${(
          stops as { ringPixelOff?: number }[]
        )
          .map((s) => s.ringPixelOff?.toFixed(1))
          .join(", ")}`,
      );
      const names = stops.map((s) => s.name);
      // Retake photo, then Continue: the DOM's order. The sheet no longer has
      // grip options (they are the first question page).
      expect(names.slice(0, 2)).toEqual(["Retake photo", "Continue"]);
      expect(stops.length).toBeGreaterThanOrEqual(2);
      expect(stops[1].inRow).toBe(true);
      for (const stop of stops as ((typeof stops)[number] & {
        ringPixelOff: number;
        ringToPage: number;
      })[]) {
        expect(stop.visible, `${stop.name} is visible and not covered`).toBe(
          true,
        );
        expect(
          stop.lowestVisible,
          `${stop.name} is on top at its lowest pixels`,
        ).toBe(true);
        expect(stop.ring, `${stop.name} has a focus ring`).toBe("solid");
        expect(stop.ringWidth).toBeGreaterThanOrEqual(2);
        // The ring clears the pinned row and the whole reach of its fade...
        expect(
          stop.clearOfFade,
          `${stop.name}: the ring's lowest edge is clear of the fade`,
        ).toBeGreaterThanOrEqual(stop.fadeReach - 1); // a device pixel of rounding
        // ...and what was painted at the ring's lowest edge is the ring's
        // colour, not the sheet's background laid over it: the best row of
        // the band is within 12 of the ring's colour (about 5 % of the 246
        // between the ring and the page), where a ring with a fade over it
        // is off by that share of the whole distance or more (a fade that
        // lets 8 % of the page through at its edge already fails).
        expect(
          stop.ringToPage,
          `${stop.name}: the ring is far enough from the page for the check to mean something`,
        ).toBeGreaterThan(120);
        expect(
          stop.ringPixelOff,
          `${stop.name}: the best row at the ring's lowest edge is the ring colour (largest channel difference)`,
        ).toBeLessThanOrEqual(12);
      }
    });
  }

  for (const percent of [100, 200]) {
    test(`at ${percent}% text, after the last button Tab never lands on the dialog itself, and comes round to the first option`, async ({
      page,
    }) => {
      await pinnedLayout(
        page,
        { width: 390, height: 844 },
        percent,
        "measured",
      );
      const walked = [] as string[];
      for (let press = 0; press < 12; press++) {
        await page.keyboard.press("Tab");
        walked.push(
          await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el) return "none";
            return `${el.tagName} ${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 20)}`;
          }),
        );
      }
      console.log(`${percent}%: ${walked.join(" > ")}`);
      expect(
        walked.filter((stop) => stop.startsWith("DIALOG")),
        "the walk never stops on the dialog",
      ).toEqual([]);
      // Round the end and back to the first option.
      const last = walked.indexOf("BUTTON Continue");
      expect(last).toBeGreaterThan(-1);
      expect(walked.slice(last + 1)).toContain("BUTTON Retake photo");
    });
  }

  test("the pinned row wears the sheet's own background (--bg), so nothing shows through it", async ({
    page,
  }) => {
    const l = await pinnedLayout(
      page,
      { width: 360, height: 640 },
      200,
      "measured",
    );
    // --bg is #060709 (src/app/tokens.css): the one dark theme.
    expect(l.sheetBackground).toBe("rgb(6, 7, 9)");
    expect(l.row.background).toBe("rgb(6, 7, 9)");
    expect(l.main.onTopIsIt).toBe(true);
    expect(l.main.rect.bottom).toBeLessThanOrEqual(l.viewport.height);
  });
});

test.describe("fix round 3: a retake on the upload path starts clean", () => {
  test("a photo is picked, the camera cannot be reopened, and the polite live region is empty after the retake", async ({
    page,
  }) => {
    await holdPipeline(page);
    // The loop is held where it is: no auto-shutter, and it cannot start again
    // after the retake and announce something new.
    await armLoopFreeze(page);
    await openLive(page);
    await freezeLoop(page);
    const live = page.locator(".cameraCueWrap + .visuallyHiddenLive");
    // The loop has told a screen reader something by now (so the check below
    // is not vacuous).
    await expect(live).not.toHaveText("");
    const told = await live.textContent();

    // The upload path: pick a file, reach the result.
    await uploadGreyPhoto(page);
    await release(page);
    await confirmAutoFrame(page);
    const sheet = page.getByRole("dialog", { name: "Hand measured" });
    await expect(sheet).toBeVisible({ timeout: 20_000 });

    // The camera cannot be opened again (revoked, unplugged: what an
    // upload-only screen is for), so `startCamera` and the `resetLoopState`
    // inside it never run and `retake()` has to clear the announcement itself.
    await page.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: undefined,
        configurable: true,
      });
    });
    await page.getByRole("button", { name: "Retake photo" }).click();
    await expect(sheet).toBeHidden();
    await expect(live, `it still said "${told}"`).toHaveText("");
  });
});

test.describe("the measured sheet after the grip chips moved to their own page", () => {
  for (const [width, height] of [
    [390, 844],
    [360, 780],
    [360, 640],
  ] as const) {
    test(`${width}x${height} at 100% text: the sheet has no grip options, one Continue button, and does not need to scroll`, async ({
      page,
    }) => {
      await pinnedLayout(page, { width, height }, 100, "measured");
      const sheet = page.getByRole("dialog", { name: "Hand measured" });
      await expect(sheet.locator(".easyGripChip")).toHaveCount(0);
      await expect(sheet.getByText("How do you hold a mouse")).toHaveCount(0);
      await expect(sheet.getByRole("button", { name: "Continue" })).toHaveCount(
        1,
      );
      const m = await page.evaluate(() => {
        const d = document.querySelector<HTMLElement>(
          "dialog.easyResultSheet",
        )!;
        return {
          height: d.offsetHeight,
          scrollHeight: d.scrollHeight,
          clientHeight: d.clientHeight,
          cap: parseFloat(getComputedStyle(d).maxHeight),
        };
      });
      console.log(
        `${width}x${height} 100%: sheet ${m.height} px (content ${m.scrollHeight} px, cap ${m.cap} px)`,
      );
      // Shorter than the 333 px it was with the four grip options in it, and
      // nothing scrolls inside it.
      expect(m.height).toBeLessThan(333);
      expect(m.scrollHeight).toBeLessThanOrEqual(m.clientHeight + 1);
    });
  }
});

/**
 * The two question pages (grip, palm thickness) belong to the photo they
 * followed: a retake, then a new measurement, starts them empty, and a failed
 * send's banner is gone.
 */
test.describe("a retake clears the answers and the error", () => {
  test("select both answers, fail a send, go back to the sheet, retake: the new photo's pages are empty and its POST has neither field", async ({
    page,
  }) => {
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/api/scans", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      bodies.push(JSON.parse(route.request().postData() ?? "{}"));
      const failed = bodies.length === 1;
      await route.fulfill({
        status: failed ? 500 : 201,
        contentType: "application/json",
        body: JSON.stringify(
          failed
            ? { error: "boom" }
            : { scanId: "623e4567-e89b-12d3-a456-426614174010" },
        ),
      });
    });
    await openLive(page);
    const sheet = page.getByRole("dialog", { name: "Hand measured" });
    const grip = page.getByRole("dialog", { name: "How you hold a mouse" });
    const thickness = page.getByRole("dialog", { name: "Palm thickness" });
    await confirmAutoFrame(page);
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    await sheet.getByRole("button", { name: "Continue" }).click();
    await grip.getByRole("radio", { name: /^Claw/ }).check();
    await grip.getByRole("button", { name: "Confirm" }).click();
    await thickness.getByRole("radio", { name: /^Thin/ }).check();
    await thickness
      .getByRole("button", { name: "See results", exact: true })
      .click();
    await expect(thickness.getByRole("alert")).toBeVisible();
    // Back to the sheet, and a new photo.
    await thickness.getByRole("button", { name: "Back" }).click();
    await grip.getByRole("button", { name: "Back" }).click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Retake photo" }).click();
    await expect(sheet).toBeHidden();
    // The fake camera's auto-shutter takes the next photo by itself.
    await confirmAutoFrame(page, 30_000);
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    await sheet.getByRole("button", { name: "Continue" }).click();
    for (const radio of await grip.getByRole("radio").all())
      await expect(radio).not.toBeChecked();
    await expect(grip.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await expect(grip.getByTestId("grip-art-neutral")).toHaveAttribute(
      "data-active",
      "true",
    );
    await grip.getByRole("button", { name: "Skip" }).click();
    for (const radio of await thickness.getByRole("radio").all())
      await expect(radio).not.toBeChecked();
    await expect(thickness.getByRole("alert")).toHaveCount(0);
    await expect(
      thickness.getByRole("button", { name: "See results", exact: true }),
    ).toBeDisabled();
    await thickness
      .getByRole("button", { name: "Skip and see results" })
      .click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).not.toHaveProperty("gripStyleStated");
    expect(bodies[1]).not.toHaveProperty("palmThicknessStated");
    // The first attempt did carry what was chosen.
    expect(bodies[0].gripStyleStated).toBe("claw");
    expect(bodies[0].palmThicknessStated).toBe("thin");
  });
});

test.describe("F15: the adjustment that opens by itself on a measured photo", () => {
  type LiveWindow = Window & {
    __easyScanLiveCalls?: {
      manualPaperCorners?: { corners: unknown; source: string };
    }[];
    __easyScanLiveResult?: "retake";
  };
  const calls = (page: Page) =>
    page.evaluate(() =>
      ((window as LiveWindow).__easyScanLiveCalls ?? []).map((c) => ({
        manual: c.manualPaperCorners?.source ?? null,
      })),
    );

  test("AC2: confirmed with no corner moved, the pipeline does not run again", async ({
    page,
  }) => {
    await openLive(page);
    await confirmAutoFrame(page);
    await expect(
      page.getByRole("dialog", { name: "Hand measured" }),
    ).toBeVisible({ timeout: 20_000 });
    // Time for a second run to start, were one sent.
    await page.waitForTimeout(500);
    expect(await calls(page)).toEqual([{ manual: null }]);
  });

  test("AC2: a corner nudged with the keys measures again, once, from the moved frame", async ({
    page,
  }) => {
    await openLive(page);
    const adjust = page.getByTestId("paper-adjust");
    await expect(adjust).toBeVisible({ timeout: 20_000 });
    await expect(adjust).toHaveAttribute("data-entry", "review");
    await expectNothingMeasuredShown(page);
    await page.getByTestId("paper-adjust-handle-0").focus();
    await page.keyboard.press("Shift+ArrowRight");
    await page.getByTestId("paper-adjust-confirm").click();
    await expect(adjust).toBeHidden();
    await expect(
      page.getByRole("dialog", { name: "Hand measured" }),
    ).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => calls(page))
      .toEqual([{ manual: null }, { manual: "adjusted" }]);
  });

  test("AC3 + review fix: 重拍 goes back to the camera, and the next (failure) sheet slides in with focus on its heading", async ({
    page,
  }) => {
    await openLive(page);
    const adjust = page.getByTestId("paper-adjust");
    await expect(adjust).toBeVisible({ timeout: 20_000 });
    await expect(adjust).toHaveAttribute("data-entry", "review");
    // The next photo: a problem with the hand (no adjustment opens by itself).
    await page.evaluate(() => {
      (window as LiveWindow).__easyScanLiveResult = "retake";
    });
    await page.getByTestId("paper-adjust-cancel").click();
    await expect(adjust).toBeHidden();
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "none",
    );
    await expect(page.locator(".easyStage video.cameraVideo")).toBeVisible();
    // The fake camera's auto-shutter takes the next photo by itself.
    const sheet = page.getByRole("dialog", { name: "Retake needed" });
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    await expect(adjust).toBeHidden();
    // A new result rises as any arrival does (V3.2 motion pass #1: every
    // arrival of the sheet slides in now; `data-resumed` is gone).
    expect(
      await page
        .locator("dialog.easyResultSheet")
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe("easySheetSlideIn");
    await expect(sheet.locator(".easySheetTitle")).toBeFocused();
  });
});

/**
 * Kirby's PC screenshots 2026-10-26: on a wide screen the adjustment's title
 * sat left of the photo, its buttons right of it, and the measured sheet ran
 * the whole width of the screen. Now both line up with the photo's centre,
 * and the sheet is a 28rem column.
 */
test.describe("a wide screen: the adjustment and the measured sheet are centred on the photo", () => {
  test("1440x800", async ({ page }) => {
    // The fake camera finds the paper only in the phone-shaped picture, so
    // the photo is taken at the phone size and the window then widened, as
    // a PC window would be.
    await openLive(page);
    const adjust = page.getByTestId("paper-adjust");
    await expect(adjust).toBeVisible({ timeout: 20_000 });
    await page.setViewportSize({ width: 1440, height: 800 });
    // The photo is fitted again to the new stage (a resize observer).
    await page.waitForTimeout(300);
    const a = await page.evaluate(() => {
      const box = (el: Element) => el.getBoundingClientRect();
      const centre = (r: DOMRect) => r.left + r.width / 2;
      const photo = box(document.querySelector(".paperAdjustPhoto")!);
      const title = document.querySelector(".paperAdjustHeader h2")!;
      const range = document.createRange();
      range.selectNodeContents(title);
      const words = range.getBoundingClientRect();
      const confirm = box(
        document.querySelector('[data-testid="paper-adjust-confirm"]')!,
      );
      const cancel = box(
        document.querySelector('[data-testid="paper-adjust-cancel"]')!,
      );
      const buttons =
        (Math.min(confirm.left, cancel.left) +
          Math.max(confirm.right, cancel.right)) /
        2;
      return {
        photo: centre(photo),
        title: centre(words),
        buttons,
      };
    });
    expect(Math.abs(a.title - a.photo), JSON.stringify(a)).toBeLessThan(4);
    expect(Math.abs(a.buttons - a.photo), JSON.stringify(a)).toBeLessThan(4);

    await page.getByTestId("paper-adjust-confirm").click();
    const sheet = page.locator("dialog.easyResultSheet[open]");
    await expect(sheet).toBeVisible({ timeout: 20_000 });
    const s = (await sheet.boundingBox())!;
    const rem = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    expect(s.width).toBeLessThanOrEqual(28 * rem + 1);
    expect(Math.abs(s.x + s.width / 2 - 720)).toBeLessThan(2);
    const button = (await sheet
      .getByRole("button", { name: "Continue" })
      .boundingBox())!;
    expect(button.x).toBeGreaterThanOrEqual(s.x);
    expect(button.x + button.width).toBeLessThanOrEqual(s.x + s.width);
  });
});

/**
 * V3.2 motion pass (Kirby 2026-10-26 "閃現", candidate): nothing in the scan
 * flow pops in or out. Each piece is recorded the moment it starts to leave
 * (fixtures/leaving.ts), so the checks do not race the animations: how it
 * goes (the token's duration, the way it came), that a native dialog is
 * already closed, and that what leaves is inert.
 */
test.describe("V3.2 motion pass: the scan flow leaves the way it came", () => {
  for (const motion of ["no-preference", "reduce"] as const) {
    test(`with motion set to ${motion}: tip, cue, dock, adjustment, pill, sheet and the retaken photo all leave with their tokens`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: motion });
      const reduced = motion === "reduce";
      const expectLeft = (
        records: Awaited<ReturnType<typeof leavingRecords>>,
        cls: string,
        name: string,
        duration: string,
        open: boolean | null = null,
      ) => {
        const record = leftWith(records, cls);
        expect(record, `${cls} left`).toBeDefined();
        expect(
          [record!.animationName, record!.animationDuration, record!.open],
          cls,
        ).toEqual(
          reduced ? ["easyFadeOut", "0.12s", open] : [name, duration, open],
        );
      };
      await recordLeaving(page);
      await captureAndMeasure(page);
      const before = await leavingRecords(page);
      // #21: the first-run tip slides down, closed at once, over a fading scrim.
      expectLeft(before, "easyTipSheet", "easySheetSlideOut", "0.24s", false);
      expect(leftWith(before, "easyTipSheet")!.inert).toBe(true);
      expectLeft(before, "easyTipScrim", "easyFadeOut", "0.24s");
      // #3: the cue goes up and the dock down when the photo is taken.
      expectLeft(before, "cameraCueWrap", "easyLiftOut", "0.15s");
      expectLeft(before, "easyBottomDock", "easySinkOut", "0.15s");
      expect(leftWith(before, "easyBottomDock")!.inert).toBe(true);
      // #22: the adjustment that opened by itself (F15) fades out.
      expectLeft(before, "paperAdjust", "easyFadeOut", "0.16s", false);
      // #19: the 測量中… pill fades out once the measurement is in.
      expectLeft(before, "easyProcessingPill", "easyFadeOut", "0.15s");

      await page.getByRole("button", { name: "Retake photo" }).click();
      await expect
        .poll(async () =>
          Boolean(leftWith(await leavingRecords(page), "easyPhotoLeaving")),
        )
        .toBe(true);
      const after = await leavingRecords(page);
      // #1: the sheet slides down instead of being unmounted.
      expectLeft(after, "easyResultSheet", "easySheetSlideOut", "0.24s", false);
      // #2: the photo stays where it was and fades out over the live picture.
      expectLeft(after, "easyPhotoLeaving", "easyFadeOut", "0.22s");
      // Both are gone once they have left.
      await expect(page.locator(".easyPhotoLeaving")).toHaveCount(0);
      await expect(page.locator("dialog.easyResultSheet")).toHaveCount(0);
      // #3 and #2: the dock rises back in, and the live picture fades in.
      expect(
        await page.locator(".easyBottomDock").evaluate((el) => {
          const style = getComputedStyle(el);
          return [style.animationName, style.animationDuration];
        }),
      ).toEqual(reduced ? ["easyFadeIn", "0.12s"] : ["easyRiseIn", "0.22s"]);
      expect(
        await page
          .locator(".easyStage video.cameraVideo")
          .evaluate((el) => getComputedStyle(el).transitionDuration),
      ).toBe(reduced ? "0.12s" : "0.22s");
    });
  }

  test("#5: the hand-length step fades in and out, and the camera under it is usable at once", async ({
    page,
  }) => {
    await recordLeaving(page);
    await openLive(page);
    await page
      .locator(".easyBottomDock")
      .getByRole("button", { name: "No paper? Use a ruler instead" })
      .click();
    const step = page.locator("section.easyLengthStep");
    await expect(
      page.getByRole("heading", { name: "Hand length" }),
    ).toBeVisible();
    expect(
      await step.evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.animationName, style.animationDuration];
      }),
    ).toEqual(["easyFadeIn", "0.22s"]);
    await page.getByRole("button", { name: "Back to camera" }).click();
    await expect
      .poll(async () =>
        Boolean(leftWith(await leavingRecords(page), "easyLengthStep")),
      )
      .toBe(true);
    const record = leftWith(await leavingRecords(page), "easyLengthStep")!;
    expect([
      record.animationName,
      record.animationDuration,
      record.inert,
    ]).toEqual(["easyFadeOut", "0.22s", true]);
    await expect(step).toHaveCount(0);
    // Focus went back to the entry that opened it, as before.
    await expect(
      page
        .locator(".easyBottomDock")
        .getByRole("button", { name: "No paper? Use a ruler instead" }),
    ).toBeFocused();
  });

  test("#20: the cue turns green over --motion-fast (a colour, the one named exception); at once under reduced motion", async ({
    page,
  }) => {
    await openLive(page);
    const cue = page.getByTestId("camera-cue");
    const transition = () =>
      cue.evaluate((el) => {
        const style = getComputedStyle(el);
        return [style.transitionProperty, style.transitionDuration];
      });
    expect(await transition()).toEqual(["background-color", "0.15s"]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect((await transition())[1]).toBe("0s");
  });
});

/**
 * Fix round (review item 8): transitions interrupted part-way. Each ends with
 * nothing left marked leaving, nothing stray inert, and the next control
 * usable.
 */
test.describe("V3.2 motion pass: interrupted transitions end usable", () => {
  // The frame wrapper of fixtures/freeze-loop.ts, armed on nothing: the test
  // stops the loop itself right after the retake, so the auto-shutter cannot
  // take a new photo while the end state is read. (Nothing checked here runs
  // on frames: the leaves are CSS animations timed by setTimeout.)
  const armManualFreeze = (page: Page) =>
    installLoopFreeze(page, { selector: "[data-never-matches]", count: 1 });
  const freezeNow = (page: Page) =>
    page.evaluate(() => {
      (window as Window & { __loopFrozen?: boolean }).__loopFrozen = true;
    });

  /** The camera is back and its shutter can be pressed. */
  async function cameraUsable(page: Page) {
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "none",
    );
    await expect(page.locator("dialog.easyResultSheet")).toHaveCount(0);
    await expect(page.locator(".easyPhotoLeaving")).toHaveCount(0);
    await expectSettled(page);
    await page
      .getByRole("button", { name: "Take photo" })
      .click({ trial: true });
  }

  test("retake tapped twice fast: the second tap falls through the leaving sheet, and the camera comes back once", async ({
    page,
  }) => {
    // Fix round 2: the second tap lands where the sheet was, after the sheet
    // has let go of the pointer. On the dev server that spot can be the
    // Next.js dev tools button (bottom left, `nextjs-portal`, not part of the
    // product); a tap there opened its panel, which then covered the shutter
    // (the first run's 30 s timeout). It is hidden here, and an error the page
    // throws fails the test by name.
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await armManualFreeze(page);
    const { sheet } = await captureAndMeasure(page);
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await page.waitForTimeout(400); // the sheet has risen
    const retake = sheet.getByRole("button", { name: "Retake photo" });
    const b = (await retake.boundingBox())!;
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await page.mouse.click(x, y);
    await freezeNow(page); // no new photo is taken by itself meanwhile
    // Still inside the 240 ms slide-out: the leaving sheet is inert and takes
    // no pointer, so the tap reaches what is under it (the camera screen
    // coming back), never a second retake.
    const under = await page.evaluate(
      ([px, py]) =>
        Boolean(
          document.elementFromPoint(px, py)?.closest("dialog.easyResultSheet"),
        ),
      [x, y] as const,
    );
    expect(under, "the leaving sheet takes the second tap").toBe(false);
    await page.mouse.click(x, y);
    await expect(
      page.locator(".easyStage video.cameraVideo.ready"),
    ).toBeVisible({ timeout: 20_000 });
    // The tap may have landed on the dock's paper-size pill or the
    // manual-entry strip coming back; close what it opened, if anything.
    if (await page.getByTestId("manual-entry-sheet").isVisible())
      await page.keyboard.press("Escape");
    await expect(page.getByTestId("manual-entry-sheet")).toHaveCount(0);
    await cameraUsable(page);
    expect(errors).toEqual([]);
  });

  test("retake during the result sheet's rise: it slides back down from where it was, and the camera comes back", async ({
    page,
  }) => {
    await holdPipeline(page);
    await armManualFreeze(page);
    await openLive(page);
    await expect(page.locator(".easyStage")).toHaveAttribute(
      "data-phase",
      "processing",
      { timeout: 20_000 },
    );
    await release(page);
    await confirmAutoFrame(page);
    // The moment the sheet is open (polled every frame), while it still rises.
    const handle = await page.waitForFunction(() => {
      const sheet = document.querySelector<HTMLDialogElement>(
        "dialog.easyResultSheet[open]",
      );
      if (!sheet) return false;
      const rising = sheet
        .getAnimations()
        .some((a) => a.playState === "running");
      sheet.querySelector<HTMLButtonElement>(".easyRetakeButton")!.click();
      (window as Window & { __loopFrozen?: boolean }).__loopFrozen = true;
      return { rising };
    });
    expect(await handle.jsonValue()).toEqual({ rising: true });
    await expect(
      page.locator(".easyStage video.cameraVideo.ready"),
    ).toBeVisible({
      timeout: 20_000,
    });
    await cameraUsable(page);
  });

  test("the adjustment cancelled and opened again within its 160 ms fade-out ends open and usable (review item 1)", async ({
    page,
  }) => {
    await openLive(page);
    // A frame placed by hand that is then turned back on the hand: the failure
    // sheet offers the adjustment (rescue) with no adjustment open by itself.
    const adjust = page.getByTestId("paper-adjust");
    await expect(adjust).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => {
      (
        window as Window & { __easyScanLiveResult?: string }
      ).__easyScanLiveResult = "retake";
    });
    await page.getByTestId("paper-adjust-handle-0").focus();
    await page.keyboard.press("Shift+ArrowRight");
    await page.getByTestId("paper-adjust-confirm").click();
    const failure = page.getByRole("dialog", { name: "Retake needed" });
    await expect(failure).toBeVisible({ timeout: 20_000 });
    await failure.getByTestId("adjust-frame-entry").click();
    await expect(adjust).toBeVisible();
    await expect(adjust).toHaveAttribute("data-entry", "rescue");
    // Cancel, and 60 ms later (inside the fade) open it again from the sheet.
    await page.evaluate(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '[data-testid="paper-adjust-cancel"]',
        )!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 60));
      document
        .querySelector<HTMLButtonElement>('[data-testid="adjust-frame-entry"]')!
        .click();
    });
    await expectSettled(page);
    await expect(page.locator("dialog.paperAdjust")).toHaveCount(1);
    expect(
      await page
        .locator("dialog.paperAdjust")
        .evaluate((el) => (el as HTMLDialogElement).open),
    ).toBe(true);
    await expect(adjust).toBeVisible();
    await expect(page.locator("#paper-adjust-title")).toBeFocused();
    // Usable: a corner moves with the keys, and confirm can be pressed.
    await page.getByTestId("paper-adjust-handle-0").focus();
    await page.keyboard.press("Shift+ArrowRight");
    await page.getByTestId("paper-adjust-confirm").click({ trial: true });
  });
});
