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
import {
  INITIAL_AUTO_CAPTURE_STATE,
  advanceAutoCapture,
} from "../../src/client/camera/autoCapture";
import { CAMERA_CONSTANTS } from "../../src/client/camera/constants";
import {
  pickCue,
  type CueCode,
  type CueInput,
} from "../../src/client/camera/cues";
import {
  EMPTY_HAND_READINGS,
  INITIAL_NO_SHEET_CAPTURE_STATE,
  advanceNoSheetCapture,
  liveHandSignal,
  maxLandmarkMovement,
  recordHandReading,
  sheetFoundByCue,
  shouldSampleHand,
  type HandReadings,
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
    // One hand reading that jumps spoils the comparison on both sides of it
    // (two readings' worth of samples): still fewer than empty the wait.
    expect(C.maxConsecutiveMisses).toBe(9);
    expect((2 * C.handSampleIntervalMs) / STEP_MS).toBeLessThan(
      C.maxConsecutiveMisses,
    );
    // It is longer than the paper ring (2.5 s since 2026-10-26; 4x the old
    // 800 ms): the sheet gets its chance first.
    expect(C.waitMs).toBeGreaterThan(CAMERA_CONSTANTS.autoCapture.durationMs);
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

  it("a sample with the sheet found pauses it (the live checks and the ring count then); it neither counts nor misses", () => {
    const half = feed(times(needed - 2));
    const paused = feed(times(50, { ...PASS, sheetFound: true }), half);
    expect(paused).toEqual(half);
    expect(
      feed(times(50, { ...PASS, handSeen: false, sheetFound: true }), half),
    ).toEqual(half);
    expect(feed(times(2), paused).fired).toBe(true);
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

  it("is read once the detector is loaded, at most every handSampleIntervalMs, found sheet or not (F17 review)", () => {
    const base = {
      detectorReady: true,
      nowMs: 10_000,
    };
    expect(shouldSampleHand({ ...base, lastReadingAtMs: null })).toBe(true);
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

  it("recordHandReading keeps the last reading that found a hand as the one to compare with", () => {
    const a = { atMs: 0, points: hand() };
    const miss = { atMs: 500, points: null };
    const b = { atMs: 1000, points: hand(1) };
    // A miss right after a hand: the hand becomes the one to compare with.
    const afterMiss = recordHandReading(
      recordHandReading(EMPTY_HAND_READINGS, a),
      miss,
    );
    expect(afterMiss).toEqual({ previous: a, latest: miss });
    // The next hand is compared with `a`, not with the miss...
    const next = recordHandReading(afterMiss, b);
    expect(next).toEqual({ previous: a, latest: b });
    expect(
      liveHandSignal({ ...next, nowMs: 1000, frameDiagonal: diagonal }),
    ).toEqual({ seen: true, steady: true });
    // ...and a second miss in a row keeps `a` too (it goes stale then).
    const twoMisses = recordHandReading(afterMiss, {
      atMs: 1000,
      points: null,
    });
    expect(twoMisses.previous).toEqual(a);
  });

  /**
   * The whole chain of one live sample, SIMULATED (模擬): the real paper ring
   * (advanceAutoCapture), the real hand reading rules and the real wait, at
   * 8 samples a second. `cueAt(i)` is the live cue on sample i: the ring
   * fills on "perfect" (the live loop's `nextCue.allPass && settled`), the
   * wait goes by `sheetFoundByCue`; `handAt(t)` is what one
   * hand reading at t ms finds (landmark x offset in px, or null for none).
   * Returns which way fired first and when, or null by 20 s.
   */
  const chain = (
    cueAt: (i: number) => CueCode,
    handAt: (t: number) => number | null,
  ): { by: "paper" | "no-sheet"; atMs: number } | null => {
    let ring = INITIAL_AUTO_CAPTURE_STATE;
    let wait = INITIAL_NO_SHEET_CAPTURE_STATE;
    let readings: HandReadings = EMPTY_HAND_READINGS;
    for (let i = 1; i * STEP_MS <= 20_000; i++) {
      const t = i * STEP_MS;
      const code = cueAt(i);
      ring = advanceAutoCapture(ring, code === "perfect", STEP_MS);
      const sheetFound = sheetFoundByCue(code);
      if (
        shouldSampleHand({
          detectorReady: true,
          lastReadingAtMs: readings.latest?.atMs ?? null,
          nowMs: t,
        })
      ) {
        const dx = handAt(t);
        const reading: LiveHandReading = {
          atMs: t,
          points: dx === null ? null : hand(dx),
        };
        readings = recordHandReading(readings, reading);
      }
      const h = liveHandSignal({
        ...readings,
        nowMs: t,
        frameDiagonal: diagonal,
      });
      wait = advanceNoSheetCapture(
        wait,
        {
          sheetFound,
          handSeen: h.seen,
          handSteady: h.steady,
          sharp: true,
          settled: true,
        },
        STEP_MS,
      );
      if (ring.fired) return { by: "paper", atMs: t };
      if (wait.fired) return { by: "no-sheet", atMs: t };
    }
    return null;
  };
  const never = (): CueCode => "no-corners";
  const passingWhen =
    (pass: (i: number) => boolean) =>
    (i: number): CueCode =>
      pass(i) ? "perfect" : "no-corners";
  const still = () => 0;
  // The first reading has nothing to compare with: the wait starts with the
  // second, half a second later.
  const onTime = (r: ReturnType<typeof chain>) => {
    expect(r?.by).toBe("no-sheet");
    expect(r!.atMs).toBeGreaterThanOrEqual(C.waitMs);
    expect(r!.atMs).toBeLessThanOrEqual(
      C.waitMs + C.handSampleIntervalMs + STEP_MS,
    );
  };

  it("a hand held still on a light table: about 4 s of readings fire it; a hand that keeps moving, or none, never does (simulated)", () => {
    onTime(
      chain(never, (t) => (Math.round(t / C.handSampleIntervalMs) % 2) * 2),
    );
    expect(
      chain(never, (t) => (Math.round(t / C.handSampleIntervalMs) % 2) * 40),
    ).toBeNull();
    expect(chain(never, () => null)).toBeNull();
  });

  it("one reading that missed the hand, or saw it jump and come back, only pauses the wait (simulated)", () => {
    // The first reading is on the first sample, then every
    // handSampleIntervalMs; the 5th one (t = 2125 ms) finds no hand.
    const missAt = STEP_MS + 4 * C.handSampleIntervalMs;
    const missed = chain(never, (t) => (t === missAt ? null : 0));
    expect(missed?.by).toBe("no-sheet");
    // Paused for one reading's worth of samples, not started again.
    expect(missed!.atMs).toBeLessThanOrEqual(
      C.waitMs + 2 * C.handSampleIntervalMs + STEP_MS,
    );
    // The same reading sees the hand 40 px off (more than 3 % of 800 px)
    // and the next one back: both comparisons fail, still only a pause.
    const jumped = chain(never, (t) => (t === missAt ? 40 : 0));
    expect(jumped?.by).toBe("no-sheet");
    expect(jumped!.atMs).toBeLessThanOrEqual(
      C.waitMs + 3 * C.handSampleIntervalMs + STEP_MS,
    );
    // Two readings in a row without the hand empty it: it starts again.
    const twice = chain(never, (t) =>
      t === missAt || t === missAt + C.handSampleIntervalMs ? null : 0,
    );
    expect(twice?.by).toBe("no-sheet");
    expect(twice!.atMs).toBeGreaterThan(missAt + C.waitMs);
  });

  it("a sheet found only now and then, or a quad the paper gate turns back, still ends in a photo (simulated)", () => {
    // Found every other sample: a found sample has no steady quad to compare
    // with, so the ring's input is false on every sample. A quad found on
    // every sample that never passes the gate: the same input.
    onTime(chain(never, still));
    onTime(chain((i) => (i % 2 ? "some-corners" : "no-corners"), still));
    for (const code of [
      "edge-covered",
      "edge-covered-top",
      "paper-curled",
      "stage-no-bright-region",
      "place-paper",
    ] as const)
      onTime(chain(() => code, still));
    // Passing now and then: every 4th sample, once a second, once every
    // 2.5 s. Each passing sample pauses the wait, but the ring empties again
    // before it fills; the wait still ends, a little later.
    for (const every of [4, 8, 20]) {
      const r = chain(
        passingWhen((i) => i % every === 0),
        still,
      );
      expect(r?.by).toBe("no-sheet");
      expect(r!.atMs).toBeLessThan(2 * C.waitMs);
    }
  });

  it("a sheet that passes keeps the paper ring first: it fires in 800 ms and the wait never does (simulated)", () => {
    const ringMs = CAMERA_CONSTANTS.autoCapture.durationMs;
    expect(
      chain(
        passingWhen(() => true),
        still,
      ),
    ).toEqual({
      by: "paper",
      atMs: Math.ceil(ringMs / STEP_MS) * STEP_MS,
    });
    // Passing two samples in three still fills the ring first.
    expect(
      chain(
        passingWhen((i) => i % 3 !== 0),
        still,
      )?.by,
    ).toBe("paper");
  });

  it("a sheet found that only needs the phone moved or held never fires the wait: the live checks keep guarding that shot (F14 review, simulated)", () => {
    for (const code of [
      "tilted",
      "too-far",
      "too-close",
      "dark",
      "bright",
      "hold-still",
      "out-of-focus",
    ] as const) {
      expect(sheetFoundByCue(code)).toBe(true);
      expect(chain(() => code, still)).toBeNull();
    }
    // A found sheet between no-sheet samples only pauses the wait: half the
    // wait without the sheet, then 10 s too far, then no sheet again fires it
    // about half a wait later.
    const half = Math.round(C.waitMs / 2 / STEP_MS);
    const r = chain(
      (i) => (i > half && i <= half + 80 ? "too-far" : "no-corners"),
      still,
    );
    expect(r?.by).toBe("no-sheet");
    expect(r!.atMs).toBeGreaterThan((half + 80) * STEP_MS);
    expect(r!.atMs).toBeLessThanOrEqual(
      (half + 80) * STEP_MS + C.waitMs / 2 + 2 * C.handSampleIntervalMs,
    );
  });

  it("the cue the live loop really picks: a whole sheet too far, too dark or not still pauses it; no sheet runs it", () => {
    const quad = (widthFraction: number) => {
      const w = 480 * widthFraction;
      const h = w * Math.SQRT2;
      return {
        topLeft: { x: 10, y: 10 },
        topRight: { x: 10 + w, y: 10 },
        bottomRight: { x: 10 + w, y: 10 + h },
        bottomLeft: { x: 10, y: 10 + h },
      };
    };
    const base: CueInput = {
      cornersSeen: 4,
      quad: quad(0.75),
      frameWidth: 480,
      meanLuma: 140,
      clippedFraction: 0,
      steady: true,
      sharpEnough: true,
      msSinceLastDetection: 0,
    };
    const code = (over: Partial<CueInput>) =>
      pickCue({ ...base, ...over }, "paper-edge", "en").code;
    expect(code({})).toBe("perfect");
    expect(code({ quad: quad(0.3) })).toBe("too-far");
    expect(code({ meanLuma: 30 })).toBe("dark");
    expect(code({ steady: false })).toBe("hold-still");
    for (const over of [
      { quad: quad(0.3) },
      { meanLuma: 30 },
      { steady: false },
    ])
      expect(sheetFoundByCue(code(over))).toBe(true);
    const none = code({ cornersSeen: 0, quad: null });
    expect(sheetFoundByCue(none)).toBe(false);
    const some = code({ cornersSeen: 3, quad: null });
    expect(some).toBe("some-corners");
    expect(sheetFoundByCue(some)).toBe(false);
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
      /noSheetCaptureRef\.current = advanceNoSheetCapture\(\s*noSheetCaptureRef\.current,\s*\{[^}]*?sheetFound:\s*sheetFound \|\|\s*\(shownCandidate\.code !== nextCue\.code &&\s*\(isPlacementCueCode\(shownCandidate\.code\) \|\|\s*shownCandidate\.code === "too-far" \|\|\s*shownCandidate\.code === "too-close"\)\),\s*handSeen: hand\.seen,\s*handSteady: hand\.steady,\s*sharp: sharpEnough,\s*settled: previewSettledRef\.current,\s*\},\s*dtMs,\s*\);/,
    );
    // The ring fills on the cue's allPass (and, with the hints on, no hand
    // hint on screen: Kirby 2026-10-27); the wait goes by the same cue,
    // paused while the sheet is found (sheetFoundByCue), a hand hint is on
    // screen (Kirby 2026-10-27) or a distance cue from the hand's side is
    // (Kirby 2026-10-28).
    expect(tick).toMatch(
      /const paperPassing =\s*nextCue\.allPass && previewSettledRef\.current && handHint === null;\s*autoCaptureRef\.current = advanceAutoCapture\(\s*autoCaptureRef\.current,\s*paperPassing,\s*dtMs,\s*\);/,
    );
    expect(tick).toContain("const sheetFound = sheetFoundByCue(nextCue.code);");
    expect(tick).toMatch(
      /shouldSampleHand\(\{\s*detectorReady: isHandLandmarkerReady\(\),/,
    );
    // A found quad no longer throws the hand readings away; each reading
    // goes through recordHandReading.
    expect(tick).not.toContain("handReadingsRef.current = EMPTY_HAND_READINGS");
    expect(tick).toMatch(
      /handReadingsRef\.current = recordHandReading\(\s*handReadingsRef\.current,\s*\{\s*atMs: now,\s*points,?\s*\},?\s*\);/,
    );
    // V3.3 WP1b: the same one detect(), read through readLiveHand (which also
    // returns z and the world landmarks); its points are what is recorded.
    expect(tick).toContain("readLiveHand(canvas, width, height)");
    expect(tick).toMatch(
      /const points =\s*reading === undefined \? undefined : \(reading\?\.points \?\? null\);/,
    );
    expect(tick).toMatch(/liveHandSignal\(\{[\s\S]*?frameDiagonal,\s*\}\)/);
  });

  it("either way of firing takes the photo through the one captureNow, once the preview has settled", () => {
    expect(tick).toMatch(
      // V3.3 WP1b: the block also names the shutter for the attempt log first.
      /if \(\s*\(autoCaptureRef\.current\.fired \|\| noSheetCaptureRef\.current\.fired\) &&\s*previewSettledRef\.current\s*\)\s*\{[^}]*pendingShutterRef\.current = shutterKindOf\(\{[^}]*\}\);\s*void captureNow\(\);\s*\}/,
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
    expect(reset).toContain("handReadingsRef.current = EMPTY_HAND_READINGS;");
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
    // Only two places open it by itself: a paper failure (F14) and a photo
    // measured from the detector's own corners (F15).
    expect(source.split("adjustOpensDirectly(").length - 1).toBe(2);
    expect(source.split("adjustOpensDirectly(failure)").length - 1).toBe(1);
    expect(source.split("adjustOpensDirectly(measured)").length - 1).toBe(1);
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
