/**
 * V3.2 F14 (Kirby's phone test of preview 5, 2026-10-22, candidate): on a
 * light table the sheet is never found, so the photo is taken anyway once a
 * hand has been held still for `noSheetCapture.waitMs`
 * (src/client/camera/noSheetCapture.ts), and its analysis opens the
 * adjustment by itself (adjustOpensDirectly, paper-adjust-state.test.ts).
 * Samples are SIMULATED (模擬): no camera, no MediaPipe.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CAMERA_CONSTANTS } from "../../src/client/camera/constants";
import {
  INITIAL_NO_SHEET_CAPTURE_STATE,
  advanceNoSheetCapture,
  liveHandSignal,
  maxLandmarkMovement,
  shouldSampleHand,
  type LiveHandReading,
  type NoSheetCaptureState,
  type NoSheetSample,
} from "../../src/client/camera/noSheetCapture";

const C = CAMERA_CONSTANTS.noSheetCapture;
const STEP_MS = 1000 / CAMERA_CONSTANTS.liveLoop.maxSamplesPerSecond; // 125
const PASS: NoSheetSample = {
  sheetFound: false,
  handSeen: true,
  handSteady: true,
  sharp: true,
  settled: true,
};
const feed = (
  samples: readonly NoSheetSample[],
  from: NoSheetCaptureState = INITIAL_NO_SHEET_CAPTURE_STATE,
) => samples.reduce((s, x) => advanceNoSheetCapture(s, x, STEP_MS), from);
const times = (n: number, sample: NoSheetSample = PASS) =>
  Array.from({ length: n }, () => sample);

describe("the named wait (candidates)", () => {
  it("about 4 s, a hand read twice a second, a stale reading after 1.2 s, 3 % of the diagonal", () => {
    expect(C.waitMs).toBe(4000);
    expect(C.handSampleIntervalMs).toBe(500);
    expect(C.handStaleMs).toBe(1200);
    expect(C.maxHandMovementFraction).toBe(0.03);
    // One hand reading that misses spans fewer live samples than empty the wait.
    expect(C.handSampleIntervalMs / STEP_MS).toBeLessThan(
      C.maxConsecutiveMisses,
    );
    // It is much longer than the paper ring: the sheet gets its chance first.
    expect(C.waitMs).toBeGreaterThan(
      4 * CAMERA_CONSTANTS.autoCapture.durationMs,
    );
  });
});

describe("advanceNoSheetCapture", () => {
  const needed = Math.ceil(C.waitMs / STEP_MS); // 32 samples

  it("fires after the wait of passing samples, not one sample before", () => {
    expect(feed(times(needed - 1)).fired).toBe(false);
    const done = feed(times(needed));
    expect(done.fired).toBe(true);
    expect(done.waitedMs).toBe(C.waitMs);
  });

  it("stays fired (a no-op) until reset", () => {
    const done = feed(times(needed));
    expect(
      advanceNoSheetCapture(done, { ...PASS, sheetFound: true }, STEP_MS),
    ).toBe(done);
  });

  it("needs a hand: with none, or a hand that moves, it never fires", () => {
    expect(feed(times(200, { ...PASS, handSeen: false })).fired).toBe(false);
    expect(feed(times(200, { ...PASS, handSteady: false })).fired).toBe(false);
    expect(feed(times(200, { ...PASS, sharp: false })).fired).toBe(false);
  });

  it("a found sheet empties it at once (the paper ring counts then)", () => {
    const half = feed(times(needed - 2));
    const reset = advanceNoSheetCapture(
      half,
      { ...PASS, sheetFound: true },
      STEP_MS,
    );
    expect(reset).toEqual(INITIAL_NO_SHEET_CAPTURE_STATE);
  });

  it("a short miss only pauses it; maxConsecutiveMisses in a row empty it", () => {
    const half = feed(times(10));
    const paused = feed(
      times(C.maxConsecutiveMisses - 1, { ...PASS, handSteady: false }),
      half,
    );
    expect(paused.waitedMs).toBe(half.waitedMs);
    expect(paused.missStreak).toBe(C.maxConsecutiveMisses - 1);
    // ...and then it goes on from where it was.
    expect(advanceNoSheetCapture(paused, PASS, STEP_MS)).toEqual({
      waitedMs: half.waitedMs + STEP_MS,
      missStreak: 0,
      fired: false,
    });
    const emptied = feed(
      times(C.maxConsecutiveMisses, { ...PASS, handSeen: false }),
      half,
    );
    expect(emptied).toEqual(INITIAL_NO_SHEET_CAPTURE_STATE);
  });

  it("counts nothing before the preview has settled, and keeps what it had", () => {
    const half = feed(times(10));
    expect(feed(times(50, { ...PASS, settled: false }), half)).toEqual(half);
    expect(feed(times(200, { ...PASS, settled: false })).fired).toBe(false);
  });

  it("refuses a negative elapsed time", () => {
    expect(() =>
      advanceNoSheetCapture(INITIAL_NO_SHEET_CAPTURE_STATE, PASS, -1),
    ).toThrow(RangeError);
  });
});

describe("the hand in the live picture", () => {
  const hand = (dx = 0) =>
    Array.from({ length: 21 }, (_, i) => ({ x: 100 + i * 5 + dx, y: 200 + i }));
  const diagonal = Math.hypot(480, 640); // 800

  it("is read only while no sheet is found, once the detector is loaded, at most every handSampleIntervalMs", () => {
    const base = { sheetFound: false, detectorReady: true, nowMs: 10_000 };
    expect(shouldSampleHand({ ...base, lastReadingAtMs: null })).toBe(true);
    expect(
      shouldSampleHand({ ...base, sheetFound: true, lastReadingAtMs: null }),
    ).toBe(false);
    expect(
      shouldSampleHand({
        ...base,
        detectorReady: false,
        lastReadingAtMs: null,
      }),
    ).toBe(false);
    expect(
      shouldSampleHand({
        ...base,
        lastReadingAtMs: base.nowMs - C.handSampleIntervalMs + 1,
      }),
    ).toBe(false);
    expect(
      shouldSampleHand({
        ...base,
        lastReadingAtMs: base.nowMs - C.handSampleIntervalMs,
      }),
    ).toBe(true);
  });

  it("maxLandmarkMovement: the largest single landmark move; different hands are never still", () => {
    expect(maxLandmarkMovement(hand(), hand())).toBe(0);
    const moved = hand();
    moved[8] = { x: moved[8].x + 3, y: moved[8].y + 4 };
    expect(maxLandmarkMovement(hand(), moved)).toBe(5);
    expect(maxLandmarkMovement(hand(), hand().slice(1))).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(maxLandmarkMovement([], [])).toBe(Number.POSITIVE_INFINITY);
  });

  it("seen when the latest reading found a hand recently; steady when the one before found it too and it barely moved", () => {
    const limit = C.maxHandMovementFraction * diagonal; // 24 px
    const at = (atMs: number, dx: number | null) => ({
      atMs,
      points: dx === null ? null : hand(dx),
    });
    const signal = (
      previous: ReturnType<typeof at> | null,
      latest: ReturnType<typeof at> | null,
      nowMs = 1000,
    ) => liveHandSignal({ previous, latest, nowMs, frameDiagonal: diagonal });

    expect(signal(null, null)).toEqual({ seen: false, steady: false });
    expect(signal(null, at(900, 0))).toEqual({ seen: true, steady: false });
    expect(signal(at(400, 0), at(900, limit - 1))).toEqual({
      seen: true,
      steady: true,
    });
    expect(signal(at(400, 0), at(900, limit + 1))).toEqual({
      seen: true,
      steady: false,
    });
    // No hand in the latest reading, or a reading gone stale.
    expect(signal(at(400, 0), at(900, null))).toEqual({
      seen: false,
      steady: false,
    });
    expect(signal(at(400, 0), at(900, 0), 900 + C.handStaleMs + 1)).toEqual({
      seen: false,
      steady: false,
    });
    // The reading before was too long before, or found no hand.
    expect(signal(at(900 - C.handStaleMs - 1, 0), at(900, 0))).toEqual({
      seen: true,
      steady: false,
    });
    expect(signal(at(400, null), at(900, 0))).toEqual({
      seen: true,
      steady: false,
    });
  });

  it("a hand held still on a light table: about 4 s of readings fire it; a hand that keeps moving never does (simulated)", () => {
    const run = (jitterPx: number) => {
      let state = INITIAL_NO_SHEET_CAPTURE_STATE;
      let previous: LiveHandReading | null = null;
      let latest: LiveHandReading | null = null;
      for (let t = STEP_MS; t <= 10_000; t += STEP_MS) {
        if (
          shouldSampleHand({
            sheetFound: false,
            detectorReady: true,
            lastReadingAtMs: latest?.atMs ?? null,
            nowMs: t,
          })
        ) {
          previous = latest;
          latest = {
            atMs: t,
            points: hand(
              (Math.round(t / C.handSampleIntervalMs) % 2) * jitterPx,
            ),
          };
        }
        const h = liveHandSignal({
          previous,
          latest,
          nowMs: t,
          frameDiagonal: diagonal,
        });
        state = advanceNoSheetCapture(
          state,
          {
            sheetFound: false,
            handSeen: h.seen,
            handSteady: h.steady,
            sharp: true,
            settled: true,
          },
          STEP_MS,
        );
        if (state.fired) return t;
      }
      return null;
    };
    const still = run(2);
    expect(still).not.toBeNull();
    // The first reading has nothing to compare with: the wait starts with the
    // second, half a second later.
    expect(still!).toBeGreaterThanOrEqual(C.waitMs);
    expect(still!).toBeLessThanOrEqual(
      C.waitMs + C.handSampleIntervalMs + STEP_MS,
    );
    expect(run(40)).toBeNull();
  });
});

describe("EasyScanCamera wires it (read from the source: the repo has no DOM test library)", () => {
  const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8")
    .split("\r\n")
    .join("\n");
  const tick = source.slice(
    source.indexOf("function tick(now: number)"),
    source.indexOf(
      "rafRef.current = requestAnimationFrame(tick);\n    return () =>",
    ),
  );

  it("each live sample advances the wait with the sheet, the hand, sharpness and the settled preview", () => {
    expect(tick).toMatch(
      /noSheetCaptureRef\.current = advanceNoSheetCapture\(\s*noSheetCaptureRef\.current,\s*\{\s*sheetFound,\s*handSeen: hand\.seen,\s*handSteady: hand\.steady,\s*sharp: sharpEnough,\s*settled: previewSettledRef\.current,\s*\},\s*dtMs,\s*\);/,
    );
    expect(tick).toContain("const sheetFound = sampleQuad !== null;");
    expect(tick).toMatch(
      /shouldSampleHand\(\{\s*sheetFound,\s*detectorReady: isHandLandmarkerReady\(\),/,
    );
    expect(tick).toContain("readLiveHandPoints(canvas, width, height)");
    expect(tick).toMatch(/liveHandSignal\(\{[\s\S]*?frameDiagonal,\s*\}\)/);
  });

  it("either way of firing takes the photo through the one captureNow, once the preview has settled", () => {
    expect(tick).toMatch(
      /if \(\s*\(autoCaptureRef\.current\.fired \|\| noSheetCaptureRef\.current\.fired\) &&\s*previewSettledRef\.current\s*\)\s*void captureNow\(\);/,
    );
    expect(tick.split("captureNow()").length - 1).toBe(1);
  });

  it("the wait and the hand readings start fresh with the loop, and after a frame that could not be made", () => {
    const reset = source.slice(
      source.indexOf("const resetLoopState = useCallback("),
      source.indexOf("}, [noteCaptureOutcome]);"),
    );
    expect(reset).toContain(
      "noSheetCaptureRef.current = INITIAL_NO_SHEET_CAPTURE_STATE;",
    );
    expect(reset).toContain(
      "handReadingsRef.current = { previous: null, latest: null };",
    );
    expect(source).toMatch(
      /autoCaptureRef\.current = resetAutoCapture\(\);\s*noSheetCaptureRef\.current = INITIAL_NO_SHEET_CAPTURE_STATE;/,
    );
  });

  it("a paper failure on the detector's frame opens the adjustment by itself; its way out goes back to the camera", () => {
    const run = source.slice(
      source.indexOf("const runPipeline = useCallback("),
      source.indexOf("const captureNow = useCallback("),
    );
    expect(run).toMatch(
      /setResult\(failure\);[\s\S]*?if \(adjustOpensDirectly\(failure\)\) \{[\s\S]*?setAdjustDirect\(true\);\s*setAdjustOpen\("rescue"\);/,
    );
    // Only one place opens it by itself.
    expect(source.split("adjustOpensDirectly(").length - 1).toBe(1);
    const cancel = source.slice(
      source.indexOf("const cancelAdjust = useCallback("),
      source.indexOf("const confirmAdjust = useCallback("),
    );
    expect(cancel).toMatch(
      /if \(adjustDirect\) retake\(\);\s*else setAdjustOpen\(null\);/,
    );
    // Confirming measures through the manual-frame path (the rescue's rerun)
    // and ends the direct opening; a retake ends it too.
    const confirm = source.slice(
      source.indexOf("const confirmAdjust = useCallback("),
      source.indexOf("const changePaperSize = useCallback("),
    );
    expect(confirm).toContain("setAdjustDirect(false);");
    const retake = source.slice(
      source.indexOf("const retake = useCallback("),
      source.indexOf("const adjustEntry = adjustEntryFor("),
    );
    expect(retake).toContain("setAdjustDirect(false);");
  });

  it("the shutter itself is untouched: a press still calls captureNow", () => {
    expect(source).toMatch(/onClick=\{[^}]*captureNow/);
  });
});
