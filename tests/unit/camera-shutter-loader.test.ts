/**
 * F7 (Kirby's phone test 2026-10-21, candidate): "the loading should be the
 * calculation after taking the photo". The easy-scan camera shows its
 * calculation loader as soon as the shutter has a photo (the frame made or
 * the camera's photo taken), before it is decoded, with the press as its
 * start; the analysis carries the same loader on (same start, same steps).
 * A frame that could not be made shows nothing (review of F7: the loader
 * flashed over the running camera on each failed try). The repo has no DOM test library, so where the
 * camera does this is read from its source; the timing is the tested
 * `loaderTimeline`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LOADING_TIMING,
  PHOTO_STAGES,
  calculationLoaderShown,
  loaderTimeline,
  photoStagesFor,
  photoStepCount,
} from "../../src/lib/particles/loading";

const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8")
  .split("\r\n")
  .join("\n");
const capture = source.slice(
  source.indexOf("const captureNow = useCallback("),
  source.indexOf("const onFilePicked = useCallback("),
);
const runPipeline = source.slice(
  source.indexOf("const runPipeline = useCallback("),
  source.indexOf("const captureNow = useCallback("),
);

describe("the shutter's loader", () => {
  it("is put up once there is a photo: after every way a frame can fail, before the decode and before the camera stops", () => {
    // The only place it is put up.
    expect(source.split("setShutterLoader(true);").length - 1).toBe(1);
    const define = capture.indexOf("const showCalculationLoader = () => {");
    expect(define).toBeGreaterThan(0);
    expect(capture.indexOf("setShutterLoader(true);")).toBeGreaterThan(define);
    // Called once, after the frame (and the camera's photo, and its frame
    // fallback) exists, and before anything is decoded or stopped.
    expect(capture.split("showCalculationLoader();").length - 1).toBe(1);
    const show = capture.indexOf("showCalculationLoader();");
    expect(show).toBeGreaterThan(capture.lastIndexOf("frameFile("));
    expect(show).toBeGreaterThan(capture.indexOf("capture.takePhoto()"));
    expect(show).toBeGreaterThan(
      capture.lastIndexOf('noteCaptureOutcome("failure");'),
    );
    expect(show).toBeLessThan(
      capture.indexOf('noteCaptureOutcome("success");'),
    );
    expect(show).toBeLessThan(capture.indexOf("loadStillSize("));
    expect(show).toBeLessThan(capture.indexOf("stopStream();"));
    // Its start is the press itself.
    expect(capture).toMatch(/startedAt: firedAt,/);
    expect(capture.indexOf("const firedAt = performance.now();")).toBeLessThan(
      define,
    );
  });

  it("a frame that is not made shows nothing: its way out never puts the loader up", () => {
    // Each `if (!frame) { ... return; }` in the capture.
    let from = 0;
    let seen = 0;
    for (;;) {
      const at = capture.indexOf("if (!frame) {", from);
      if (at < 0) break;
      const block = capture.slice(at, capture.indexOf("return;", at));
      expect(block).toContain('noteCaptureOutcome("failure");');
      expect(block).not.toContain("setShutterLoader(true)");
      expect(block).not.toContain("showCalculationLoader");
      expect(block).not.toContain("setPhotoLoader(");
      seen += 1;
      from = at + 1;
    }
    // The live frame, and the frame after a camera photo that failed.
    expect(seen).toBe(2);
    // Nothing between the press and the first failure put it up either (the
    // one `setShutterLoader(true)` is inside the helper, test above).
    const firstFailure = capture.indexOf("if (!frame) {");
    expect(capture.slice(0, firstFailure)).not.toContain(
      "showCalculationLoader();",
    );
  });

  it("is handed to the analysis with the press as its start, so the minimum counts from the press", () => {
    expect(capture).toContain(
      "void runPipeline(file, previewUrl, undefined, firedAt);",
    );
    expect(runPipeline).toContain(
      "const loaderStartedAt = loaderStartedAtGiven ?? performance.now();",
    );
    // The same render shows it while the photo is made and while it is analysed.
    expect(source).toContain(
      "calculationLoaderShown(result.kind, shutterLoader, photoLoaderInput) && (",
    );
  });

  it("the analysis takes it on: the shutter's flag is cleared once the result is processing, before its own loader is set", () => {
    const processing = runPipeline.indexOf('setResult({ kind: "processing"');
    expect(processing).toBeGreaterThan(0);
    const cleared = runPipeline.indexOf("setShutterLoader(false);", processing);
    expect(cleared).toBeGreaterThan(processing);
    expect(cleared).toBeLessThan(
      runPipeline.indexOf("setPhotoLoader({", processing),
    );
  });

  it("a photo that arrives while the typed-size form is open clears the loader", () => {
    const at = runPipeline.indexOf("if (manualActiveRef.current) {");
    expect(at).toBeGreaterThan(0);
    const block = runPipeline.slice(at, runPipeline.indexOf("return;", at));
    expect(block).toContain("setShutterLoader(false);");
    expect(block).toContain("setPhotoLoader(null);");
  });

  it("goes again when no photo was made (the camera is still there)", () => {
    const end = capture.slice(capture.lastIndexOf("} finally {"));
    expect(end).toContain("if (!handedOff) {");
    expect(end).toContain("setShutterLoader(false);");
  });

  it("has the analysis' own steps: decode, the sheet, the hand, then mm", () => {
    expect(PHOTO_STAGES).toEqual(["decoded", "paper", "hand"]);
    expect(photoStepCount(photoStagesFor("paper-edge"))).toBe(4);
    expect(photoStepCount(photoStagesFor("user-length"))).toBe(3);
  });

  it("an analysis answered 0.4 s after the press is still shown for 1.5 s from the press", () => {
    const pressedAt = 10_000;
    const t = loaderTimeline(
      pressedAt,
      pressedAt + 400,
      LOADING_TIMING.MIN_DISPLAY_PHOTO_MS,
      true,
    );
    expect(t.doneAt - pressedAt).toBe(1500);
    // A long analysis adds nothing: fill and fade after the answer.
    const long = loaderTimeline(
      pressedAt,
      pressedAt + 4000,
      LOADING_TIMING.MIN_DISPLAY_PHOTO_MS,
      true,
    );
    expect(long.doneAt - pressedAt).toBe(4000 + 450);
  });
});

describe("calculationLoaderShown (F7)", () => {
  const input = {
    startedAt: 0,
    minMs: LOADING_TIMING.MIN_DISPLAY_PHOTO_MS,
    steps: { total: 4, done: 4, lastAt: 900 },
    arrival: { at: 900, ok: true },
  };
  it("shows while the photo is analysed, and while the shutter has a photo not yet analysed", () => {
    expect(calculationLoaderShown("processing", false, input)).toBe(true);
    expect(calculationLoaderShown("none", true, input)).toBe(true);
    expect(calculationLoaderShown("processing", true, input)).toBe(true);
  });
  it("never stays over the answer: a measured hand or a failure with the shutter's flag cleared shows nothing, though the input is kept", () => {
    expect(calculationLoaderShown("measured", false, input)).toBe(false);
    expect(calculationLoaderShown("gateFailure", false, input)).toBe(false);
    expect(calculationLoaderShown("none", false, input)).toBe(false);
  });
  it("shows nothing without a loader", () => {
    expect(calculationLoaderShown("processing", true, null)).toBe(false);
  });
});
