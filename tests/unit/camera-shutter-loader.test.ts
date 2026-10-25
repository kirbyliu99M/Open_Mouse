/**
 * F10 (Kirby's second phone test of the V3.2 preview, 2026-10-21/22,
 * candidate): "拍照掃描不需要 loading 畫面". This file replaces F7's
 * shutter-loader tests (F7 put the full-screen particle loader up at the
 * shutter and held the answer for at least 1.5 s; both are gone by Kirby's
 * decision). Now: once the shutter has a photo, one small 測量中… line
 * (`role="status"`) sits on the frozen photo, the analysis keeps it there,
 * and the answer replaces it the moment it is here. A frame that could not be
 * made shows nothing (review of F7: a cue flashed over the running camera on
 * each failed try). The worker (F8) and the yields (F7) are the pipeline's
 * and stay. The repo has no DOM test library, so where the camera does this
 * is read from its source; the rule is the tested `measuringShown`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { measuringShown } from "../../src/client/camera/measuringIndicator";
import { LOADING_TIMING } from "../../src/lib/particles/loading";
import { easyScanCopy } from "../../src/lib/copy/easy-scan";

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
const pipelineSource = readFileSync("src/client/photo/pipeline.ts", "utf8");

describe("after the shutter: no loading screen, only 測量中… (Kirby 2026-10-21/22, F10)", () => {
  it("the camera draws no particle loader at all, and holds no answer back", () => {
    expect(source).not.toContain("ParticleLoader");
    expect(source).not.toContain("easyProcessingLoader");
    expect(source).not.toContain("easyFailedLoader");
    expect(source).not.toContain("loaderTimeline");
    expect(source).not.toContain("holdLoader");
    expect(source).not.toContain("MIN_DISPLAY_PHOTO_MS");
    // The photo-analysis minimum itself is gone from the named timings.
    expect("MIN_DISPLAY_PHOTO_MS" in LOADING_TIMING).toBe(false);
  });

  it("draws one small role=status line, by measuringShown, with the copy's words", () => {
    expect(source.split("measuringShown(").length - 1).toBe(1);
    // V3.2 motion pass #19: the line is kept for its fade-out (useLeaving),
    // still decided by measuringShown alone.
    expect(source).toContain(
      "measuringShown(result.kind, shutterMeasuring) ? true : null,",
    );
    const at = source.indexOf("{measuringLeave.shown && (");
    expect(at).toBeGreaterThan(0);
    const block = source.slice(at, source.indexOf("</p>", at));
    expect(block).toContain('className="easyProcessingPill"');
    expect(block).toContain('role="status"');
    expect(block).toContain("{easy.measuring}");
  });

  it("its words are short and say only that it is measuring (candidate, both languages)", () => {
    expect(easyScanCopy("zh-TW").measuring).toBe("測量中…");
    expect(easyScanCopy("en").measuring).toBe("Measuring…");
  });

  it("is put up once there is a photo: after every way a frame can fail, before the decode and before the camera stops", () => {
    expect(source.split("setShutterMeasuring(true);").length - 1).toBe(1);
    const define = capture.indexOf("const showMeasuring = () => {");
    expect(define).toBeGreaterThan(0);
    expect(capture.indexOf("setShutterMeasuring(true);")).toBeGreaterThan(
      define,
    );
    expect(capture.split("showMeasuring();").length - 1).toBe(1);
    const show = capture.indexOf("showMeasuring();");
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
  });

  it("a frame that is not made shows nothing: its way out never puts the line up", () => {
    let from = 0;
    let seen = 0;
    for (;;) {
      const at = capture.indexOf("if (!frame) {", from);
      if (at < 0) break;
      const block = capture.slice(at, capture.indexOf("return;", at));
      expect(block).toContain('noteCaptureOutcome("failure");');
      expect(block).not.toContain("setShutterMeasuring(true)");
      expect(block).not.toContain("showMeasuring");
      seen += 1;
      from = at + 1;
    }
    expect(seen).toBe(2);
    const firstFailure = capture.indexOf("if (!frame) {");
    expect(capture.slice(0, firstFailure)).not.toContain("showMeasuring();");
  });

  it("the analysis takes it on: the shutter's flag is cleared once the result is processing", () => {
    expect(capture).toContain("void runPipeline(file, previewUrl);");
    const processing = runPipeline.indexOf('setResult({ kind: "processing"');
    expect(processing).toBeGreaterThan(0);
    const cleared = runPipeline.indexOf(
      "setShutterMeasuring(false);",
      processing,
    );
    expect(cleared).toBeGreaterThan(processing);
  });

  it("the answer is shown as soon as it is here: nothing waits between the pipeline's answer and the result", () => {
    const answer = runPipeline.indexOf(
      "const pipelineResult = await runPhotoPipelineImpl({",
    );
    const measured = runPipeline.indexOf('kind: "measured",', answer);
    expect(answer).toBeGreaterThan(0);
    expect(measured).toBeGreaterThan(answer);
    const between = runPipeline.slice(answer, measured);
    // The only await is the pipeline itself.
    expect(between.split("await ").length - 1).toBe(1);
    expect(between).not.toContain("setTimeout");
  });

  it("a photo that arrives while the typed-size form is open clears the line", () => {
    const at = runPipeline.indexOf("if (manualActiveRef.current) {");
    expect(at).toBeGreaterThan(0);
    const block = runPipeline.slice(at, runPipeline.indexOf("return;", at));
    expect(block).toContain("setShutterMeasuring(false);");
  });

  it("goes again when no photo was made (the camera is still there)", () => {
    const end = capture.slice(capture.lastIndexOf("} finally {"));
    expect(end).toContain("if (!handedOff) {");
    expect(end).toContain("setShutterMeasuring(false);");
  });

  it("the F8 worker and the F7 yields stay in the pipeline", () => {
    expect(pipelineSource).toContain("getAnalysisRunner()");
    expect(pipelineSource).toContain("await yieldToBrowser();");
  });
});

describe("measuringShown (F10, pure)", () => {
  it("shows while the photo is analysed, and while the shutter has a photo not yet analysed", () => {
    expect(measuringShown("processing", false)).toBe(true);
    expect(measuringShown("none", true)).toBe(true);
    expect(measuringShown("processing", true)).toBe(true);
  });
  it("never stays over the answer", () => {
    expect(measuringShown("measured", false)).toBe(false);
    expect(measuringShown("gateFailure", false)).toBe(false);
    expect(measuringShown("none", false)).toBe(false);
  });
});
