/**
 * V3.3 WP1b: how EasyScanCamera wires the live placement readings, the
 * shutter kind and the debug panel's experiment tag (read from the source:
 * the repo has no DOM test library), and what the debug panel draws.
 * Log only: nothing here may reach a cue, a gate or an analytics event.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScanDebugPanel } from "../../src/client/camera/ScanDebugPanel";
import type { ScanDebugSnapshot } from "../../src/client/camera/debugStats";
import { EXPERIMENT_TAGS } from "../../src/client/camera/livePlacement";

const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8")
  .split("\r\n")
  .join("\n");
const tick = source.slice(
  source.indexOf("function tick(now: number)"),
  source.indexOf(
    "rafRef.current = requestAnimationFrame(tick);\n    return () =>",
  ),
);

const logAttemptBlock = source.slice(
  source.indexOf("const logAttempt = useCallback("),
  source.indexOf("const runPipeline = useCallback("),
);
const snapshotStart = source.indexOf("placement: debugPlacement({");
const snapshotBuild =
  snapshotStart < 0
    ? ""
    : source.slice(snapshotStart, source.indexOf("}),", snapshotStart));

describe("EasyScanCamera wires WP1b (log only)", () => {
  it("reads the live placement only with a hand reading and four corners, and keeps the last three", () => {
    expect(tick).toMatch(
      /if \(reading && detection\.corners\) \{[\s\S]*?readLivePlacement\(\{[\s\S]*?livePlacementRef\.current = pushLivePlacement\(/,
    );
    // Its result is read by nothing in the tick but the log ref and the debug numbers.
    const after = tick.slice(tick.indexOf("readLivePlacement("));
    expect(after).not.toMatch(/pickCue\([^)]*placed/);
    expect(tick.match(/readLivePlacement\(/g)).toHaveLength(1);
  });

  it("the loop names its shutter just before the one captureNow; any other call is manual", () => {
    expect(source).toContain(
      'const shutter: ShutterKind = pendingShutterRef.current ?? "manual";',
    );
    expect(source).toMatch(
      /pendingShutterRef\.current = shutterKindOf\(\{\s*autoCapture: autoCaptureRef\.current\.fired,\s*noSheet: noSheetCaptureRef\.current\.fired,\s*\}\);/,
    );
  });

  it("the capture carries the guidance and the tag, and the tag is for one scan only", () => {
    expect(source).toMatch(
      /guidance: \{\s*shutter,[\s\S]{0,120}?live: liveReadingsAtShutter\(livePlacementRef\.current, firedAt\),/,
    );
    expect(source).toContain("experimentTag: experimentTagRef.current,");
    expect(source).toContain(
      "if (experimentTagRef.current !== null) setExperimentTag(null);",
    );
    expect(source).toContain("livePlacementRef.current = [];");
  });

  it("logAttempt carries the capture's guidance and tag into the attempt record", () => {
    expect(source.indexOf("const logAttempt = useCallback(")).toBeGreaterThan(
      0,
    );
    expect(source.indexOf("const runPipeline = useCallback(")).toBeGreaterThan(
      source.indexOf("const logAttempt = useCallback("),
    );
    expect(logAttemptBlock).toMatch(
      /const capture: AttemptCapture = \{[\s\S]*?\.\.\.\(info\?\.guidance \? \{ guidance: info\.guidance \} : \{\}\),[\s\S]*?\};/,
    );
    expect(logAttemptBlock).toMatch(
      /const capture: AttemptCapture = \{[\s\S]*?\.\.\.\(info\?\.experimentTag \? \{ experimentTag: info\.experimentTag \} : \{\}\),[\s\S]*?\};/,
    );
    // The record is built from that capture.
    expect(logAttemptBlock).toMatch(
      /buildAttemptRecord\(\{[\s\S]*?\bcapture,[\s\S]*?\}\)/,
    );
  });

  it("logAttempt hands the kept attempts to the soft-hint throttle", () => {
    expect(logAttemptBlock).toMatch(
      /buildAttemptRecord\(\{[\s\S]*?softHintHistory: softHintHistoryOf\(attemptsRef\.current\),[\s\S]*?\}\)/,
    );
  });

  it("each sample records its sheet fill, and the debug snapshot builds its placement row from it", () => {
    expect(tick).toMatch(
      /live\.fill = sampleQuad\s*\?\s*computeQuadWidthFraction\(sampleQuad, width\)\s*:\s*null;/,
    );
    expect(snapshotBuild.length).toBeGreaterThan(0);
    expect(snapshotBuild).toContain("fill: live.fill,");
    expect(snapshotBuild).toContain("readings: livePlacementRef.current,");
    expect(snapshotBuild).toContain("costMs: live.placementMs,");
    expect(snapshotBuild).toContain("nowMs: performance.now(),");
    // The cost window is filled where the reading is taken.
    expect(tick).toMatch(
      /debugLiveRef\.current\.placementMs = pushWindow\(\s*debugLiveRef\.current\.placementMs \?\? \[\],\s*performance\.now\(\) - placementStartedAt,/,
    );
  });

  it("no analytics call carries any WP1b field", () => {
    // V3.3 WP3: a call whose payload is a plain variable
    // (`track("scan_quality", quality);`) ends at its own `);`, not at the
    // next `});` further down the source (that span reached the WP3 banner).
    const calls =
      source.match(/track\("[a-z_]+",\s*(?:[A-Za-z_]+\)|[\s\S]*?\}\));/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls)
      expect(call).not.toMatch(
        /placement|guidance|experimentTag|softHint|shadowRing|wristToEdge/,
      );
  });

  it("the debug panel (and its tag picker) is drawn only with ?debug=1", () => {
    const mounts = source.split("<ScanDebugPanel").length - 1;
    expect(mounts).toBe(2);
    for (const m of source.matchAll(/<ScanDebugPanel/g)) {
      const before = source.slice(Math.max(0, m.index! - 400), m.index!);
      expect(before).toMatch(/debugOn &&/);
    }
    expect(source).toMatch(
      /const on = new URLSearchParams\(window\.location\.search\)\.get\("debug"\) === "1";/,
    );
  });
});

describe("ScanDebugPanel's placement row and tag picker", () => {
  const snapshot: ScanDebugSnapshot = {
    userAgent: "test",
    track: null,
    capabilities: null,
    focusApplied: { continuous: null, lastTap: null },
    live: {
      visibleInStream: null,
      sample: null,
      samplesPerSecond: null,
      detectionMsAverage: null,
      detectionMsP95: null,
      laplacianVariance: null,
      laplacianFloor: 0,
      steady: null,
      maxCornerMovementFractionOfDiagonal: null,
      cornersSeen: null,
      cueCode: null,
      cueShown: null,
      ringFraction: 0,
      consecutiveFailures: 0,
      placement: {
        fill: 0.6543,
        wristToEdgeMm: 7.25,
        handAxisDeg: -2.04,
        ageMs: 300,
        costMsAverage: 0.0421,
        costMsMax: 0.09,
      },
    },
    capture: {
      method: null,
      source: null,
      stillWidth: null,
      stillHeight: null,
      stillKb: null,
      ringCompleteToFrozenMs: null,
    },
    preview: {
      requested: null,
      stillAspect: null,
      stillAspectSource: null,
      photoMax: null,
      previewAspect: null,
      aspectDiff: null,
      fovMismatch: null,
      reapplied: null,
      settleTimedOut: null,
      orientationRetry: null,
    },
    attempts: [],
  };

  it("shows the live fill, wrist distance and hand axis", () => {
    const html = renderToStaticMarkup(
      createElement(ScanDebugPanel, { snapshot }),
    );
    expect(html).toContain("fill 0.654");
    expect(html).toContain("wrist 7.3 mm");
    expect(html).toContain("axis -2.0°");
    // No picker without a setter.
    expect(html).not.toContain("debug-experiment-tag");
  });

  it("draws the picker with every tag when it can set one", () => {
    const html = renderToStaticMarkup(
      createElement(ScanDebugPanel, {
        snapshot,
        experimentTag: "aligned/0.65",
        onExperimentTag: () => {},
      }),
    );
    expect(html).toContain('data-testid="debug-experiment-tag"');
    for (const tag of EXPERIMENT_TAGS) expect(html).toContain(`>${tag}<`);
    expect(html).toMatch(/<option value="aligned\/0\.65" selected="">/);
  });
});
