/**
 * landmark-raw-v3 (V3.2 F12, candidate): where the camera wires the nominal
 * prior's long-edge reference and the engine-scale display (D1 = B). The rules
 * are the tested pure functions (`frameFocalReferenceLongEdgePx`,
 * `shownScanMeasurements`, nominal-focal-v3.test.ts, engine-scale.test.ts);
 * this pins that the screens call them. The repo has no DOM test library, so
 * the wiring is read from the source, as camera-reused-focal-wiring.test.ts
 * does.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(path, "utf8").split("\r\n").join("\n");
const camera = read("src/client/camera/EasyScanCamera.tsx");
const run = camera.slice(
  camera.indexOf("const runPipeline = useCallback("),
  camera.indexOf("const captureNow = useCallback("),
);
const callStart = run.indexOf("await runPhotoPipelineImpl({");
const call = run.slice(callStart, run.indexOf("void logAttempt(", callStart));

describe("the camera's pipeline call", () => {
  it("passes the stream's long edge for a frame of the video, scaled like the width reference", () => {
    expect(callStart).toBeGreaterThan(0);
    expect(call).toMatch(
      /focalReferenceLongEdgePx:\s*info\?\.captureSource === "frame" && info\.frame\s*\?\s*frameFocalReferenceLongEdgePx\(\s*info\.frame\.stream,/,
    );
  });
});

describe("every screen that shows a scanned hand length or palm width shows the engine scale", () => {
  it("the easy camera's dimension lines", () => {
    const dims = camera.slice(
      camera.indexOf("const dimensions: readonly DimensionSpec[] | null ="),
      camera.indexOf("const problem ="),
    );
    expect(dims).toMatch(
      /easy\.dimHand\(\s*shownScanMeasurements\(\s*result\.measurements,\s*result\.submission\.calibration,\s*\)\.handLengthMm\.toFixed\(0\)/,
    );
    expect(dims).toMatch(
      /easy\.dimPalm\(\s*shownScanMeasurements\(\s*result\.measurements,\s*result\.submission\.calibration,\s*\)\.palmWidthMm\.toFixed\(0\)/,
    );
    expect(dims).not.toMatch(
      /result\.measurements\.(handLengthMm|palmWidthMm)/,
    );
  });

  it("the scan page (printed sheet and paper edge)", () => {
    const page = read("src/app/scan/ScanClient.tsx");
    expect(page).not.toMatch(
      /state\.measurements\.(handLengthMm|palmWidthMm)\.toFixed/,
    );
    expect(page.split("shownScanMeasurements(").length - 1).toBe(3);
  });

  it("the account page", () => {
    const view = read("src/app/account/AccountView.tsx");
    expect(view).not.toMatch(/scan\.measurements\.(handLengthMm|palmWidthMm)/);
    expect(view).toContain("shownAccountMeasurements(scan).handLengthMm");
    expect(view).toContain("shownAccountMeasurements(scan).palmWidthMm");
  });
});
