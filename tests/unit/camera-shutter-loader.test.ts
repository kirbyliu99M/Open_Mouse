/**
 * F7 (Kirby's phone test 2026-10-21, candidate): "the loading should be the
 * calculation after taking the photo". The easy-scan camera shows its
 * calculation loader in the same frame as the shutter press, before the
 * frame is made or decoded, and the analysis carries the same loader on
 * (same start, same steps). The repo has no DOM test library, so where the
 * camera does this is read from its source; the timing is the tested
 * `loaderTimeline`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LOADING_TIMING,
  PHOTO_STAGES,
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
  it("is put up at the press, before anything is awaited (the frame, the decode)", () => {
    const up = capture.indexOf("setShutterLoader(true);");
    expect(up).toBeGreaterThan(0);
    const firstAwait = capture.indexOf("await ");
    expect(firstAwait).toBeGreaterThan(up);
    expect(capture.indexOf("loadStillSize(")).toBeGreaterThan(up);
    expect(capture.indexOf("frameFile(")).toBeGreaterThan(up);
    // Its start is the press itself.
    expect(capture).toMatch(/startedAt: firedAt,/);
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
      '(result.kind === "processing" || shutterLoader) && photoLoaderInput',
    );
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
