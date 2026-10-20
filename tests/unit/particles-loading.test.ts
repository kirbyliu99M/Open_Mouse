import { describe, expect, it } from "vitest";
import { PARTICLE_BUDGET_2D, PALETTE } from "../../src/lib/particles/budget";
import {
  approach,
  breathAt,
  breathFor,
  breathLook,
  cloudPoints,
  CLOUD_INNER,
  fadeOutOpacity,
  fillProgress,
  isLit,
  litColor,
  litShare,
  loaderFrameAt,
  loaderParticleCount,
  loaderStep,
  loaderStatusText,
  loaderTimeline,
  LOADING_TIMING,
  mixHex,
  particleLook,
  photoStagesFor,
  photoStepCount,
  ringAngle,
  STILL_BREATH,
  stepProgress,
  stepsDone,
  timeProgress,
  waitingProgress,
  type LoaderDrawState,
  type LoaderInput,
} from "../../src/lib/particles/loading";

const close = (a: number, b: number, eps = 1e-9) =>
  expect(Math.abs(a - b)).toBeLessThan(eps);

describe("the named timings (candidates, Kirby 2026-10-21)", () => {
  it("are the design's numbers", () => {
    expect(LOADING_TIMING.TAU_MS).toBe(1200);
    expect(LOADING_TIMING.WAIT_CAP).toBe(0.9);
    expect(LOADING_TIMING.FILL_MS).toBe(250);
    expect(LOADING_TIMING.FADE_OUT_MS).toBe(200);
    expect(LOADING_TIMING.MIN_DISPLAY_FIT_MS).toBe(1200);
    expect(LOADING_TIMING.MIN_DISPLAY_PHOTO_MS).toBe(1500);
  });
});

describe("timeProgress: 1 - e^(-t / 1.2 s), at most 90 %", () => {
  it("follows the curve", () => {
    expect(timeProgress(0)).toBe(0);
    expect(timeProgress(-50)).toBe(0);
    expect(timeProgress(Number.NaN)).toBe(0);
    close(timeProgress(1200), 1 - Math.exp(-1));
    close(timeProgress(600), 1 - Math.exp(-0.5));
  });

  it("stops at 90 % and never passes it", () => {
    // 1 - e^(-t/1.2) = 0.9 at t = 1.2 s * ln 10, about 2.76 s.
    const t90 = 1200 * Math.log(10);
    expect(timeProgress(t90 - 10)).toBeLessThan(0.9);
    expect(timeProgress(t90 + 10)).toBe(0.9);
    expect(timeProgress(60_000)).toBe(0.9);
    expect(timeProgress(Number.POSITIVE_INFINITY)).toBe(0.9);
  });

  it("only ever grows", () => {
    let last = -1;
    for (let t = 0; t < 5000; t += 37) {
      const p = timeProgress(t);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
  });
});

describe("the photo's steps", () => {
  it("are the real pipeline stages: decode, sheet, hand (and mm with the answer)", () => {
    expect(photoStagesFor("paper-edge")).toEqual(["decoded", "paper", "hand"]);
    expect(photoStepCount(photoStagesFor("paper-edge"))).toBe(4);
    // A typed hand length looks for no sheet.
    expect(photoStagesFor("user-length")).toEqual(["decoded", "hand"]);
    expect(photoStepCount(photoStagesFor("user-length"))).toBe(3);
  });

  it("counts finished steps in order only", () => {
    const stages = photoStagesFor("paper-edge");
    expect(stepsDone(stages, new Set())).toBe(0);
    expect(stepsDone(stages, new Set(["decoded"]))).toBe(1);
    expect(stepsDone(stages, new Set(["decoded", "paper", "hand"]))).toBe(3);
    // A later stage without the earlier one counts nothing past the gap.
    expect(stepsDone(stages, new Set(["paper"]))).toBe(0);
    // The user-length run never reports a sheet.
    expect(
      stepsDone(photoStagesFor("user-length"), new Set(["decoded", "hand"])),
    ).toBe(2);
  });
});

describe("stepProgress", () => {
  it("each finished step starts the next part: 90 % * k / total", () => {
    for (let k = 0; k < 4; k += 1) close(stepProgress(k, 4, 0), (0.9 * k) / 4);
    expect(stepProgress(4, 4, 0)).toBe(0.9);
    expect(stepProgress(9, 4, 0)).toBe(0.9);
  });

  it("between steps it creeps by the time curve and never reaches the next part", () => {
    const from = 0.9 * (1 / 4);
    const to = 0.9 * (2 / 4);
    close(stepProgress(1, 4, 1200), from + (to - from) * (1 - Math.exp(-1)));
    expect(stepProgress(1, 4, 60_000)).toBeLessThanOrEqual(to);
    expect(stepProgress(1, 4, 5_000)).toBeLessThan(to);
    expect(stepProgress(1, 4, -1)).toBe(from);
  });

  it("a step that finishes moves the ring forward, never back", () => {
    // However long the wait inside part 1, part 2's start is at least as far.
    expect(stepProgress(2, 4, 0)).toBeGreaterThanOrEqual(
      stepProgress(1, 4, 1e9),
    );
  });

  it("with no steps at all it is the time curve", () => {
    expect(stepProgress(0, 0, 1200)).toBe(timeProgress(1200));
  });
});

describe("fillProgress, approach and the timeline", () => {
  it("fills from where it was to 100 % in 250 ms", () => {
    expect(fillProgress(0.6, 0)).toBe(0.6);
    expect(fillProgress(0.6, 250)).toBe(1);
    expect(fillProgress(0.6, 1000)).toBe(1);
    const mid = fillProgress(0.6, 125);
    expect(mid).toBeGreaterThan(0.6);
    expect(mid).toBeLessThan(1);
  });

  it("approach catches up smoothly and never goes back", () => {
    expect(approach(0.2, 0.5, 0)).toBe(0.2);
    const next = approach(0.2, 0.5, 16);
    expect(next).toBeGreaterThan(0.2);
    expect(next).toBeLessThan(0.5);
    expect(approach(0.5, 0.3, 16)).toBe(0.5);
    expect(approach(0.2, 0.5, 10_000)).toBeCloseTo(0.5, 9);
  });

  it("an early answer waits: the loader is on screen at least the minimum", () => {
    const t = loaderTimeline(1000, 1100, 1200, true);
    expect(t.doneAt - 1000).toBe(1200);
    expect(t.settleAt).toBe(1000 + 1200 - 250 - 200);
    const photo = loaderTimeline(0, 50, 1500, true);
    expect(photo.doneAt).toBe(1500);
  });

  it("a late answer is shown as it is: fill and fade, nothing added", () => {
    const t = loaderTimeline(0, 3000, 1200, true);
    expect(t.settleAt).toBe(3000);
    expect(t.doneAt).toBe(3000 + 250 + 200);
  });

  it("a failure stops the ring at once and its retry comes after the minimum", () => {
    expect(loaderTimeline(0, 100, 1200, false)).toEqual({
      settleAt: 100,
      doneAt: 1200,
    });
    expect(loaderTimeline(0, 5000, 1200, false)).toEqual({
      settleAt: 5000,
      doneAt: 5000,
    });
  });

  it("fades out over the last 200 ms", () => {
    const t = { settleAt: 1000, doneAt: 1450 };
    expect(fadeOutOpacity(1000, t)).toBe(1);
    expect(fadeOutOpacity(1250, t)).toBe(1);
    close(fadeOutOpacity(1350, t), 0.5);
    expect(fadeOutOpacity(1450, t)).toBe(0);
    expect(fadeOutOpacity(9999, t)).toBe(0);
  });
});

describe("loaderFrameAt", () => {
  const fitLoader = (arrival: LoaderInput["arrival"]): LoaderInput => ({
    startedAt: 1000,
    minMs: LOADING_TIMING.MIN_DISPLAY_FIT_MS,
    steps: null,
    arrival,
  });

  it("waits on the time curve with no answer", () => {
    const f = loaderFrameAt(fitLoader(null), 2200);
    expect(f.phase).toBe("waiting");
    close(f.progress, timeProgress(1200));
    expect(f.opacity).toBe(1);
  });

  it("an ok answer before the minimum keeps waiting, then fills to 100 % and is gone", () => {
    const input = fitLoader({ at: 1300, ok: true });
    // settleAt = 1000 + 1200 - 450 = 1750.
    expect(loaderFrameAt(input, 1500).phase).toBe("waiting");
    const filling = loaderFrameAt(input, 1800);
    expect(filling.phase).toBe("filling");
    expect(filling.progress).toBeGreaterThan(timeProgress(750));
    const full = loaderFrameAt(input, 2000);
    expect(full.progress).toBe(1);
    expect(full.opacity).toBe(1);
    const done = loaderFrameAt(input, 2200);
    expect(done.phase).toBe("done");
    expect(done.opacity).toBe(0);
  });

  it("a failure freezes the ring where the answer found it", () => {
    const input = fitLoader({ at: 1600, ok: false });
    const a = loaderFrameAt(input, 1700);
    const b = loaderFrameAt(input, 9000);
    expect(a.phase).toBe("failed");
    expect(a.progress).toBe(b.progress);
    close(a.progress, timeProgress(600));
    expect(b.opacity).toBe(1);
  });

  it("a photo follows its steps", () => {
    const input: LoaderInput = {
      startedAt: 0,
      minMs: LOADING_TIMING.MIN_DISPLAY_PHOTO_MS,
      steps: { total: 4, done: 2, lastAt: 500 },
      arrival: null,
    };
    close(waitingProgress(input, 500), 0.45);
    const f = loaderFrameAt(input, 800);
    expect(f.progress).toBeGreaterThan(0.45);
    expect(f.progress).toBeLessThan(0.675);
  });
});

describe("breathing: one breath every 4 s, in 1.6 s, out 2.4 s", () => {
  it("starts breathed out, is full at 1.6 s, and out again at 4 s", () => {
    expect(breathAt(0)).toBe(0);
    close(breathAt(1600), 1);
    close(breathAt(4000), 0, 1e-12);
    close(breathAt(800), 0.5);
    close(breathAt(1600 + 1200), 0.5);
    // The next breath is the same.
    close(breathAt(5600), 1);
  });

  it("rises during the in-breath and falls during the out-breath", () => {
    for (let t = 0; t < 1600; t += 40)
      expect(breathAt(t + 40)).toBeGreaterThanOrEqual(breathAt(t));
    for (let t = 1600; t < 3960; t += 40)
      expect(breathAt(t + 40)).toBeLessThanOrEqual(breathAt(t));
  });

  it("maps to brightness 55 %↔100 %, glow 8 %↔22 %, size 98.5 %↔100 %", () => {
    expect(breathLook(0)).toEqual({
      brightness: 0.55,
      glow: 0.08,
      scale: 0.985,
    });
    expect(breathLook(1)).toEqual({ brightness: 1, glow: 0.22, scale: 1 });
    const mid = breathLook(0.5);
    close(mid.brightness, 0.775);
    close(mid.glow, 0.15);
    close(mid.scale, 0.9925);
  });

  it("handles a bad time as breathed out", () => {
    expect(breathAt(Number.NaN)).toBe(0);
    expect(breathAt(-5)).toBe(0);
  });
});

describe("intensity by progress", () => {
  it("lights 25 % of the particles at the start and all of them at 100 %", () => {
    expect(litShare(0)).toBe(0.25);
    expect(litShare(1)).toBe(1);
    close(litShare(0.5), 0.625);
    expect(isLit(0.2, 0)).toBe(true);
    expect(isLit(0.3, 0)).toBe(false);
    expect(isLit(0.99, 1)).toBe(true);
  });

  it("a lit particle is brighter and bigger as the ring fills; an unlit one stays dim", () => {
    const early = particleLook(0.1, 0);
    const late = particleLook(0.1, 0.9);
    expect(early.lit && late.lit).toBe(true);
    expect(late.alpha).toBeGreaterThan(early.alpha);
    expect(late.radius).toBeGreaterThan(early.radius);
    const dark = particleLook(0.95, 0.2);
    expect(dark.lit).toBe(false);
    expect(dark.alpha).toBeLessThan(early.alpha);
  });

  it("colour: #8FB2F8 at the start, #CFE0FF at the cap, white when done", () => {
    expect(litColor(0)).toBe("rgb(143 178 248)");
    expect(litColor(0.9)).toBe("rgb(207 224 255)");
    expect(litColor(1)).toBe("rgb(255 255 255)");
    expect(PALETTE.primary).toBe("#cfe0ff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("rgb(128 128 128)");
  });

  it("the ring's arc is a full turn at 100 %", () => {
    expect(ringAngle(0)).toBe(0);
    close(ringAngle(0.5), Math.PI);
    close(ringAngle(1), Math.PI * 2);
    close(ringAngle(2), Math.PI * 2);
  });
});

describe("the cloud", () => {
  it("is half the home stage's 2D budget, halved again on a low-end device", () => {
    expect(loaderParticleCount(false, 8)).toBe(PARTICLE_BUDGET_2D.mobile / 2);
    expect(loaderParticleCount(true, 8)).toBe(PARTICLE_BUDGET_2D.desktop / 2);
    expect(loaderParticleCount(false, 4)).toBe(
      Math.floor(Math.floor(PARTICLE_BUDGET_2D.mobile / 2) / 2),
    );
  });

  it("is seeded, inside the ring-shaped disc, with thresholds spread over [0, 1)", () => {
    const a = cloudPoints(400);
    expect(a).toEqual(cloudPoints(400));
    expect(a).toHaveLength(400);
    for (const p of a) {
      const r = Math.hypot(p.x, p.y);
      expect(r).toBeGreaterThanOrEqual(CLOUD_INNER - 1e-9);
      expect(r).toBeLessThanOrEqual(1 + 1e-9);
      expect(p.threshold).toBeGreaterThanOrEqual(0);
      expect(p.threshold).toBeLessThan(1);
      expect(p.size).toBeGreaterThanOrEqual(0.6);
      expect(p.size).toBeLessThanOrEqual(1.2);
    }
    // About a quarter are lit at the start (seeded, so exact on every run).
    const lit = a.filter((p) => isLit(p.threshold, 0)).length;
    expect(lit).toBeGreaterThan(70);
    expect(lit).toBeLessThan(130);
  });

  it("any first n points are an even share: a smaller draw count keeps the cloud round", () => {
    const pts = cloudPoints(400).slice(0, 100);
    const right = pts.filter((p) => p.x > 0).length;
    expect(right).toBeGreaterThan(30);
    expect(right).toBeLessThan(70);
  });
});

describe("breathFor: reduced motion holds the breath, a failure breathes out", () => {
  const times = [0, 400, 1600, 2500, 4000, 7321, 60_000];

  it("under reduced motion is STILL_BREATH at any time, while waiting, filling or done", () => {
    for (const phase of ["waiting", "filling", "done"] as const) {
      for (const ms of times)
        expect(breathFor(phase, true, ms)).toBe(STILL_BREATH);
    }
  });

  it("after a failure is 0 (breathed out), with or without reduced motion", () => {
    for (const ms of times) {
      expect(breathFor("failed", false, ms)).toBe(0);
      expect(breathFor("failed", true, ms)).toBe(0);
    }
  });

  it("otherwise follows breathAt", () => {
    for (const phase of ["waiting", "filling", "done"] as const) {
      for (const ms of times)
        expect(breathFor(phase, false, ms)).toBe(breathAt(ms));
    }
    // It does breathe: not held at one value.
    expect(breathFor("waiting", false, 0)).not.toBe(
      breathFor("waiting", false, 1600),
    );
  });

  // The loader's frame loop, one rAF frame (16 ms) at a time, as
  // ParticleLoader draws it (loaderStep is what its frame() calls).
  const run = (input: LoaderInput, still: boolean, untilMs: number) => {
    let state: LoaderDrawState = { shown: 0, lastAt: 0 };
    const frames: { shown: number; breath: number; settled: boolean }[] = [];
    for (let now = input.startedAt; now <= untilMs; now += 16) {
      const step = loaderStep(state, input, now, still);
      state = step.state;
      frames.push({
        shown: state.shown,
        breath: step.breath,
        settled: step.settled,
      });
      if (step.settled) break;
    }
    return frames;
  };

  it("under reduced motion the drawn ring still moves forward, frame after frame, and does not breathe", () => {
    const input: LoaderInput = {
      startedAt: 1000,
      minMs: LOADING_TIMING.MIN_DISPLAY_FIT_MS,
      steps: null,
      arrival: null,
    };
    const frames = run(input, true, 1000 + 3000);
    expect(frames.length).toBeGreaterThan(100);
    // From the second frame on (the first has no time step), every frame is
    // further round than the one before.
    for (let i = 2; i < frames.length; i++)
      expect(frames[i]!.shown).toBeGreaterThan(frames[i - 1]!.shown);
    expect(frames.at(-1)!.shown).toBeGreaterThan(0.1);
    for (const fr of frames) {
      expect(fr.breath).toBe(STILL_BREATH);
      expect(breathLook(fr.breath).scale).toBe(1);
    }
  });

  it("the ring is drawn the same with reduced motion as without it, to a full ring", () => {
    const input: LoaderInput = {
      startedAt: 1000,
      minMs: LOADING_TIMING.MIN_DISPLAY_FIT_MS,
      steps: null,
      arrival: { at: 1800, ok: true },
    };
    const still = run(input, true, 10_000);
    const moving = run(input, false, 10_000);
    expect(still.map((fr) => fr.shown)).toEqual(moving.map((fr) => fr.shown));
    expect(still.at(-1)!.settled).toBe(true);
    expect(still.at(-1)!.shown).toBe(1);
    // Without reduced motion it does breathe.
    expect(new Set(moving.map((fr) => fr.breath)).size).toBeGreaterThan(1);
  });
});

describe("loaderStatusText: the one status region's words", () => {
  const words = { working: "W", done: "D" };
  it("says working while waiting, done after a result, nothing after a failure", () => {
    expect(loaderStatusText({ arrival: null }, words)).toBe("W");
    expect(loaderStatusText({ arrival: { at: 1, ok: true } }, words)).toBe("D");
    expect(loaderStatusText({ arrival: { at: 1, ok: false } }, words)).toBe("");
  });
});
