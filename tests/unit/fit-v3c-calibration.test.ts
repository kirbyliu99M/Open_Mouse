/**
 * fit-v3.0 candidate (未拍板): the personal calibration. Pure functions, no
 * catalogue beyond a few synthetic mice. Sign convention under test: a mouse
 * the person calls "long" pulls the length target DOWN (their ideal is
 * shorter than the mouse), "short" pulls it UP, "just right" pulls it toward
 * the mouse.
 */
import { describe, expect, it } from "vitest";
import {
  fitCalibrationSchema,
  fitPreferencesSchema,
  type FitReference,
  type GripStyle,
} from "../../src/lib/contracts/fit";
import {
  CALIBRATION_GRID_MM,
  calibrateV3,
  feelProbability,
  posteriorShift,
} from "../../src/server/fit/calibration-v3-candidate";
import { SIGMA_MM } from "../../src/server/fit/coefficients";
import { scoreFitV3 } from "../../src/server/fit/score-v3-candidate";
import { shellKey } from "../../src/server/fit/shell-groups";
import type { FitTargets } from "../../src/server/fit/targets";
import { hand, mouseRow, seedCatalogue, seedPriors } from "./fit-v2c-fixtures";

const TARGET: FitTargets = { lengthMm: 120, gripWidthMm: 64, heightMm: 38 };
const BASE: Record<GripStyle, FitTargets> = {
  palm: { ...TARGET },
  claw: { ...TARGET },
  fingertip: { ...TARGET },
};

/** A mouse exactly on the targets. */
const onTarget = mouseRow({
  slug: "acme-on-target",
  lengthMm: 120,
  widthMm: 64,
  heightMm: 38,
});

function ref(
  slug: string,
  feel: Partial<FitReference["feel"]> = {},
  extra: Partial<FitReference> = {},
): FitReference {
  return {
    slug,
    grips: [],
    feel: { length: null, width: null, height: null, ...feel },
    specialUse: false,
    ...extra,
  };
}

describe("feelProbability", () => {
  it("is a probability", () => {
    for (const x of [90, 110, 120, 130, 150]) {
      for (const t of [110, 120, 130]) {
        for (const f of [-1, 0, 1] as const) {
          const p = feelProbability(f, x, t, SIGMA_MM.length);
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("a far longer mouse is 'long', a far shorter one 'short', one on target 'right'", () => {
    const w = SIGMA_MM.length;
    expect(feelProbability(1, 150, 120, w)).toBeGreaterThan(0.99);
    expect(feelProbability(-1, 90, 120, w)).toBeGreaterThan(0.99);
    expect(feelProbability(0, 120, 120, w)).toBeGreaterThan(0.9);
    expect(feelProbability(1, 120, 120, w)).toBeLessThan(0.05);
  });

  it("'right' never falls below its floor", () => {
    expect(
      feelProbability(0, 200, 120, SIGMA_MM.length),
    ).toBeGreaterThanOrEqual(1e-6);
  });
});

describe("posteriorShift", () => {
  it("no answers: shift exactly 0, no conflict", () => {
    const p = posteriorShift([], SIGMA_MM.length);
    expect(p).toEqual({ shiftMm: 0, answers: 0, conflict: false, fit: 1 });
    expect(Object.is(p.shiftMm, 0)).toBe(true);
  });

  it("one 'just right' answer on a mouse at the target: shift close to 0", () => {
    const p = posteriorShift(
      [{ feel: 0, xMm: 120, targetsMm: [120] }],
      SIGMA_MM.length,
    );
    expect(Math.abs(p.shiftMm)).toBeLessThan(0.1);
    expect(p.conflict).toBe(false);
  });

  it("'just right' on a longer mouse pulls the target up, on a shorter one down", () => {
    const up = posteriorShift(
      [{ feel: 0, xMm: 128, targetsMm: [120] }],
      SIGMA_MM.length,
    );
    const down = posteriorShift(
      [{ feel: 0, xMm: 112, targetsMm: [120] }],
      SIGMA_MM.length,
    );
    expect(up.shiftMm).toBeGreaterThan(1);
    expect(down.shiftMm).toBeLessThan(-1);
    // mirror images of each other
    expect(up.shiftMm).toBeCloseTo(-down.shiftMm, 6);
  });

  it("'long' on a mouse at the target pulls the target down; 'short' pulls it up", () => {
    const long = posteriorShift(
      [{ feel: 1, xMm: 120, targetsMm: [120] }],
      SIGMA_MM.length,
    );
    const short = posteriorShift(
      [{ feel: -1, xMm: 120, targetsMm: [120] }],
      SIGMA_MM.length,
    );
    expect(long.shiftMm).toBeLessThan(-1);
    expect(short.shiftMm).toBeGreaterThan(1);
  });

  it("all answers 'long': the shift has one sign (down) and more answers push further", () => {
    const one = posteriorShift(
      [{ feel: 1, xMm: 125, targetsMm: [120] }],
      SIGMA_MM.length,
    );
    const three = posteriorShift(
      [
        { feel: 1, xMm: 125, targetsMm: [120] },
        { feel: 1, xMm: 126, targetsMm: [120] },
        { feel: 1, xMm: 127, targetsMm: [120] },
      ],
      SIGMA_MM.length,
    );
    expect(one.shiftMm).toBeLessThan(0);
    expect(three.shiftMm).toBeLessThan(one.shiftMm);
    expect(three.conflict).toBe(false);
  });

  it("two answers that cannot both hold: conflict, frozen at exactly 0", () => {
    // 110 mm is "long" (ideal below 104) and 140 mm is "short" (ideal above 146).
    const p = posteriorShift(
      [
        { feel: 1, xMm: 110, targetsMm: [120] },
        { feel: -1, xMm: 140, targetsMm: [120] },
      ],
      SIGMA_MM.length,
    );
    expect(p.conflict).toBe(true);
    expect(p.fit).toBeLessThan(0.3);
    expect(p.answers).toBe(2);
    expect(Object.is(p.shiftMm, 0)).toBe(true);
  });

  it("a single answer is never a conflict, however odd", () => {
    const p = posteriorShift(
      [{ feel: 1, xMm: 80, targetsMm: [120] }],
      SIGMA_MM.length,
    );
    expect(p.conflict).toBe(false);
  });

  it("several grips average the probability: a mouse judged in two grips sits between them", () => {
    const both = posteriorShift(
      [{ feel: 0, xMm: 130, targetsMm: [120, 130] }],
      SIGMA_MM.length,
    );
    const first = posteriorShift(
      [{ feel: 0, xMm: 130, targetsMm: [120] }],
      SIGMA_MM.length,
    );
    const second = posteriorShift(
      [{ feel: 0, xMm: 130, targetsMm: [130] }],
      SIGMA_MM.length,
    );
    expect(both.shiftMm).toBeLessThan(first.shiftMm);
    expect(both.shiftMm).toBeGreaterThan(second.shiftMm);
  });

  it("stays on the grid: a hopeless answer cannot move the target beyond 30 mm", () => {
    const p = posteriorShift(
      [{ feel: 1, xMm: 300, targetsMm: [120] }],
      SIGMA_MM.length,
    );
    expect(Math.abs(p.shiftMm)).toBeLessThanOrEqual(30);
  });
});

describe("the offset grid", () => {
  it("is 601 points from -30 to +30 mm in steps of 0.1, symmetric around 0", () => {
    expect(CALIBRATION_GRID_MM).toHaveLength(601);
    expect(CALIBRATION_GRID_MM[0]).toBe(-30);
    expect(CALIBRATION_GRID_MM[600]).toBe(30);
    expect(CALIBRATION_GRID_MM[300]).toBe(0);
    for (let i = 1; i < CALIBRATION_GRID_MM.length; i++) {
      expect(CALIBRATION_GRID_MM[i]! - CALIBRATION_GRID_MM[i - 1]!).toBeCloseTo(
        0.1,
        9,
      );
    }
    for (let i = 0; i <= 600; i++) {
      expect(CALIBRATION_GRID_MM[i]! + CALIBRATION_GRID_MM[600 - i]!).toBe(0);
    }
  });
});

describe("conflict threshold and minimum answers", () => {
  const long110 = { feel: 1, xMm: 110, targetsMm: [120] } as const;
  const shortAt = (xMm: number) =>
    ({ feel: -1, xMm, targetsMm: [120] }) as const;

  it("a single answer has a fit of exactly 1 and is never a conflict", () => {
    for (const feel of [-1, 0, 1] as const) {
      const p = posteriorShift(
        [{ feel, xMm: 60, targetsMm: [120] }],
        SIGMA_MM.length,
      );
      expect(p.fit).toBe(1);
      expect(p.conflict).toBe(false);
    }
  });

  it("two answers just above the 0.3 boundary are not a conflict (fit about 0.32)", () => {
    // "long" at 110 mm and "short" at 97 mm: the two ideals they allow
    // (below 104, above 103) barely overlap.
    const p = posteriorShift([long110, shortAt(97)], SIGMA_MM.length);
    expect(p.fit).toBeGreaterThanOrEqual(0.3);
    expect(p.fit).toBeLessThan(0.35);
    expect(p.conflict).toBe(false);
    expect(p.shiftMm).not.toBe(0);
  });

  it("two answers just below the 0.3 boundary are a conflict (fit about 0.29)", () => {
    const p = posteriorShift([long110, shortAt(97.5)], SIGMA_MM.length);
    expect(p.fit).toBeLessThan(0.3);
    expect(p.fit).toBeGreaterThan(0.25);
    expect(p.conflict).toBe(true);
    expect(Object.is(p.shiftMm, 0)).toBe(true);
  });

  it("three answers where two contradict: conflict, frozen at 0, counted as 3", () => {
    const p = posteriorShift(
      [long110, shortAt(140), { feel: 0, xMm: 125, targetsMm: [120] }],
      SIGMA_MM.length,
    );
    expect(p.answers).toBe(3);
    expect(p.conflict).toBe(true);
    expect(p.fit).toBeLessThan(0.3);
    expect(Object.is(p.shiftMm, 0)).toBe(true);
  });

  it("three consistent answers are not a conflict", () => {
    const p = posteriorShift(
      [
        { feel: 0, xMm: 118, targetsMm: [120] },
        { feel: 0, xMm: 122, targetsMm: [120] },
        { feel: 0, xMm: 120, targetsMm: [120] },
      ],
      SIGMA_MM.length,
    );
    expect(p.conflict).toBe(false);
    expect(p.fit).toBeGreaterThan(0.9);
  });
});

describe("calibrateV3", () => {
  it("a single 'just right' mouse on the targets: all three shifts near 0", () => {
    const out = calibrateV3(
      [ref("acme-on-target", { length: 0, width: 0, height: 0 })],
      [onTarget],
      BASE,
      "claw",
    );
    for (const d of ["length", "gripWidth", "height"] as const) {
      expect(Math.abs(out.shiftsMm[d])).toBeLessThan(0.1);
      expect(out.calibration.dims[d].answers).toBe(1);
      expect(out.calibration.dims[d].conflict).toBe(false);
    }
    expect(out.calibration.referencesUsed).toBe(1);
  });

  it("a mouse called too long on every dimension lowers all three targets", () => {
    const out = calibrateV3(
      [ref("acme-on-target", { length: 1, width: 1, height: 1 })],
      [onTarget],
      BASE,
      "claw",
    );
    expect(out.shiftsMm.length).toBeLessThan(-1);
    expect(out.shiftsMm.gripWidth).toBeLessThan(-1);
    expect(out.shiftsMm.height).toBeLessThan(-0.5);
  });

  it("two contradicting references freeze the dimension at 0 and flag it", () => {
    const low = mouseRow({ slug: "acme-low", lengthMm: 110 });
    const high = mouseRow({ slug: "acme-high", lengthMm: 140 });
    const out = calibrateV3(
      [ref("acme-low", { length: 1 }), ref("acme-high", { length: -1 })],
      [low, high],
      BASE,
      "claw",
    );
    expect(out.calibration.dims.length).toEqual({
      shiftMm: 0,
      answers: 2,
      conflict: true,
    });
    expect(out.shiftsMm.length).toBe(0);
    expect(fitCalibrationSchema.safeParse(out.calibration).success).toBe(true);
  });

  it("a conflict in one dimension leaves the others calibrated", () => {
    const low = mouseRow({ slug: "acme-low", lengthMm: 110, widthMm: 70 });
    const high = mouseRow({ slug: "acme-high", lengthMm: 140, widthMm: 70 });
    const out = calibrateV3(
      [
        ref("acme-low", { length: 1, width: 0 }),
        ref("acme-high", { length: -1, width: 0 }),
      ],
      [low, high],
      BASE,
      "claw",
    );
    expect(out.calibration.dims.length.conflict).toBe(true);
    expect(out.calibration.dims.gripWidth.conflict).toBe(false);
    expect(out.shiftsMm.gripWidth).toBeGreaterThan(1);
  });

  it("specialUse, unknown and unlisted references are ignored", () => {
    const hidden = mouseRow({
      slug: "acme-hidden",
      lengthMm: 150,
      listed: false,
    });
    const special = mouseRow({ slug: "acme-special", lengthMm: 150 });
    const catalogue = [onTarget, hidden, special];
    const clean = calibrateV3(
      [ref("acme-on-target", { length: 1 })],
      catalogue,
      BASE,
      "claw",
    );
    const noisy = calibrateV3(
      [
        ref("acme-on-target", { length: 1 }),
        ref("acme-special", { length: -1 }, { specialUse: true }),
        ref("acme-hidden", { length: -1 }),
        ref("acme-nowhere", { length: -1 }),
      ],
      catalogue,
      BASE,
      "claw",
    );
    expect(noisy).toEqual(clean);
    expect(noisy.calibration.referencesUsed).toBe(1);
    expect(noisy.calibration.dims.length.answers).toBe(1);
  });

  it("only ignored references: referencesUsed 0 and no shift at all", () => {
    const out = calibrateV3(
      [ref("acme-nowhere", { length: 1, width: 1, height: 1 })],
      [onTarget],
      BASE,
      "claw",
    );
    expect(out.calibration.referencesUsed).toBe(0);
    expect(out.shiftsMm).toEqual({ length: 0, gripWidth: 0, height: 0 });
    expect(fitCalibrationSchema.safeParse(out.calibration).success).toBe(true);
  });

  it("an ergonomic reference calibrates length and width but never height", () => {
    const ergo = mouseRow({
      slug: "acme-ergo",
      shape: "ergonomic",
      lengthMm: 130,
      widthMm: 72,
      heightMm: 48,
    });
    const out = calibrateV3(
      [ref("acme-ergo", { length: 1, width: 1, height: 1 })],
      [ergo],
      BASE,
      "claw",
    );
    expect(out.calibration.dims.height).toEqual({
      shiftMm: 0,
      answers: 0,
      conflict: false,
    });
    expect(out.calibration.dims.length.answers).toBe(1);
    expect(out.calibration.dims.gripWidth.answers).toBe(1);
    expect(out.shiftsMm.length).not.toBe(0);
    expect(out.shiftsMm.gripWidth).not.toBe(0);
    expect(out.calibration.referencesUsed).toBe(1);
  });

  it("an ergonomic reference does not change the height shift a flat mouse gives", () => {
    const ergo = mouseRow({
      slug: "acme-ergo",
      shape: "ergonomic",
      heightMm: 52,
    });
    const flat = mouseRow({ slug: "acme-flat", heightMm: 36 });
    const withErgo = calibrateV3(
      [ref("acme-flat", { height: 0 }), ref("acme-ergo", { height: 1 })],
      [flat, ergo],
      BASE,
      "claw",
    );
    const without = calibrateV3(
      [ref("acme-flat", { height: 0 })],
      [flat, ergo],
      BASE,
      "claw",
    );
    expect(withErgo.shiftsMm.height).toBe(without.shiftsMm.height);
    expect(withErgo.calibration.dims.height.answers).toBe(1);
  });

  it("a reference that answered only height counts once, for height only", () => {
    const out = calibrateV3(
      [ref("acme-on-target", { height: 0 })],
      [onTarget],
      BASE,
      "claw",
    );
    expect(out.calibration.referencesUsed).toBe(1);
    expect(out.calibration.dims.length.answers).toBe(0);
    expect(out.calibration.dims.gripWidth.answers).toBe(0);
    expect(out.calibration.dims.height.answers).toBe(1);
  });

  it("a reference with no grips is judged in the grip used", () => {
    const grips: Record<GripStyle, FitTargets> = {
      palm: { lengthMm: 120, gripWidthMm: 64, heightMm: 38 },
      claw: { lengthMm: 112, gripWidthMm: 64, heightMm: 38 },
      fingertip: { lengthMm: 104, gripWidthMm: 64, heightMm: 38 },
    };
    const m = mouseRow({ slug: "acme-m", lengthMm: 120 });
    const noGrips = calibrateV3(
      [ref("acme-m", { length: 0 })],
      [m],
      grips,
      "claw",
    );
    const clawOnly = calibrateV3(
      [ref("acme-m", { length: 0 }, { grips: ["claw"] })],
      [m],
      grips,
      "claw",
    );
    const palmOnly = calibrateV3(
      [ref("acme-m", { length: 0 }, { grips: ["palm"] })],
      [m],
      grips,
      "claw",
    );
    expect(noGrips).toEqual(clawOnly);
    expect(noGrips.shiftsMm.length).toBeGreaterThan(palmOnly.shiftsMm.length);
  });

  it("the grip-width answer is judged on the effective width, curvature included", () => {
    const flat = mouseRow({ slug: "acme-flat", widthMm: 64 });
    const wingy = mouseRow({
      slug: "acme-wingy",
      widthMm: 64,
      sideCurvature: "outward_aggressive", // +4 mm effective
    });
    const a = calibrateV3(
      [ref("acme-flat", { width: 0 })],
      [flat],
      BASE,
      "claw",
    );
    const b = calibrateV3(
      [ref("acme-wingy", { width: 0 })],
      [wingy],
      BASE,
      "claw",
    );
    expect(b.shiftsMm.gripWidth).toBeGreaterThan(a.shiftsMm.gripWidth + 1);
  });

  it("does not change its arguments, and is deterministic", () => {
    const refs = [ref("acme-on-target", { length: 1, width: 0, height: -1 })];
    const frozen = JSON.stringify([refs, [onTarget], BASE]);
    const a = calibrateV3(refs, [onTarget], BASE, "palm");
    const b = calibrateV3(refs, [onTarget], BASE, "palm");
    expect(a).toEqual(b);
    expect(JSON.stringify([refs, [onTarget], BASE])).toBe(frozen);
  });
});

describe("review round 2026-10-20: who calibrates", () => {
  it("a reference the model does not apply to is ignored like an unlisted one", () => {
    // Height over length 0.62 > the vertical ratio: no length/width meaning.
    const tall = mouseRow({
      slug: "acme-tall",
      model: "Tall",
      lengthMm: 100,
      heightMm: 62,
    });
    const clean = calibrateV3(
      [ref("acme-on-target", { length: 1 })],
      [onTarget, tall],
      BASE,
      "claw",
    );
    const noisy = calibrateV3(
      [
        ref("acme-on-target", { length: 1 }),
        ref("acme-tall", { length: -1, width: -1, height: -1 }),
      ],
      [onTarget, tall],
      BASE,
      "claw",
    );
    expect(noisy).toEqual(clean);
    expect(noisy.calibration.referencesUsed).toBe(1);
    expect(noisy.calibration.dims.length.answers).toBe(1);
  });

  it("only a tall reference: nothing moves, nothing is used", () => {
    const tall = mouseRow({ slug: "acme-tall", lengthMm: 100, heightMm: 62 });
    const out = calibrateV3(
      [ref("acme-tall", { length: 1, width: 1, height: 1 })],
      [tall],
      BASE,
      "claw",
    );
    expect(out.calibration.referencesUsed).toBe(0);
    expect(out.shiftsMm).toEqual({ length: 0, gripWidth: 0, height: 0 });
    for (const d of Object.values(out.calibration.dims)) {
      expect(d).toEqual({ shiftMm: 0, answers: 0, conflict: false });
    }
  });

  it("vertical and trackball devices do not calibrate either", () => {
    const vertical = mouseRow({
      slug: "acme-vert",
      model: "Vert",
      formFactor: "vertical",
    });
    const ball = mouseRow({
      slug: "acme-ball",
      model: "Ball",
      formFactor: "trackball",
    });
    const out = calibrateV3(
      [ref("acme-vert", { length: 1 }), ref("acme-ball", { length: 1 })],
      [vertical, ball],
      BASE,
      "claw",
    );
    expect(out.calibration.referencesUsed).toBe(0);
    expect(out.shiftsMm.length).toBe(0);
  });
});

describe("review round 2026-10-20: an empty target list", () => {
  it("an answer with no targets gives shift 0, not NaN", () => {
    const out = posteriorShift(
      [{ feel: 1, xMm: 130, targetsMm: [] }],
      SIGMA_MM.length,
    );
    expect(out.shiftMm).toBe(0);
    expect(Number.isNaN(out.fit)).toBe(false);
    expect(out).toEqual({ shiftMm: 0, answers: 0, conflict: false, fit: 1 });
  });

  it("it is left out, the other answers still calibrate", () => {
    const real = { feel: 1 as const, xMm: 130, targetsMm: [120] };
    const alone = posteriorShift([real], SIGMA_MM.length);
    const mixed = posteriorShift(
      [{ feel: -1, xMm: 100, targetsMm: [] }, real],
      SIGMA_MM.length,
    );
    expect(mixed).toEqual(alone);
    expect(Number.isNaN(mixed.shiftMm)).toBe(false);
  });
});

describe("review round 2026-10-20: models of one shell are one voice", () => {
  // Same brand, dimensions, descriptors and model family: one shell.
  const wired = mouseRow({ slug: "acme-m1", model: "M1", lengthMm: 130 });
  const wireless = mouseRow({
    slug: "acme-m1-wireless",
    model: "M1 Wireless",
    lengthMm: 130,
    weightG: 70,
  });
  const other = mouseRow({ slug: "acme-other", model: "Other", lengthMm: 112 });

  it("the fixture really is one shell", () => {
    expect(shellKey(wired)).toBe(shellKey(wireless));
    expect(shellKey(wired)).not.toBe(shellKey(other));
  });

  it("the same answer on two models of a shell counts once", () => {
    const one = calibrateV3(
      [ref("acme-m1", { length: 1 })],
      [wired, wireless],
      BASE,
      "claw",
    );
    const two = calibrateV3(
      [ref("acme-m1", { length: 1 }), ref("acme-m1-wireless", { length: 1 })],
      [wired, wireless],
      BASE,
      "claw",
    );
    expect(two.shiftsMm).toEqual(one.shiftsMm);
    expect(two.calibration.dims).toEqual(one.calibration.dims);
    expect(two.calibration.dims.length.answers).toBe(1);
    // Both references took part (as one shell answer).
    expect(two.calibration.referencesUsed).toBe(2);
  });

  it("two different shells of the same size are two voices and pull further", () => {
    const single = calibrateV3(
      [ref("acme-m1", { length: 1 })],
      [wired, wireless],
      BASE,
      "claw",
    );
    const twin = mouseRow({ slug: "acme-twin", model: "Twin", lengthMm: 130 });
    const doubled = calibrateV3(
      [ref("acme-m1", { length: 1 }), ref("acme-twin", { length: 1 })],
      [wired, twin],
      BASE,
      "claw",
    );
    expect(doubled.shiftsMm.length).toBeLessThan(single.shiftsMm.length);
    expect(doubled.calibration.dims.length.answers).toBe(2);
  });

  it("different answers on one shell are a conflict in that dimension", () => {
    const out = calibrateV3(
      [
        ref("acme-m1", { length: 1, width: 0 }),
        ref("acme-m1-wireless", { length: 0, width: 0 }),
      ],
      [wired, wireless],
      BASE,
      "claw",
    );
    expect(out.calibration.dims.length.conflict).toBe(true);
    expect(out.shiftsMm.length).toBe(0);
    // The agreeing width answer is one voice and still calibrates.
    expect(out.calibration.dims.gripWidth.conflict).toBe(false);
    expect(out.calibration.dims.gripWidth.answers).toBe(1);
    expect(fitCalibrationSchema.safeParse(out.calibration).success).toBe(true);
  });

  it("the grips of merged answers are pooled; reference order does not matter", () => {
    const a = calibrateV3(
      [
        ref("acme-m1", { length: 1 }, { grips: ["palm"] }),
        ref("acme-m1-wireless", { length: 1 }, { grips: ["claw"] }),
      ],
      [wired, wireless],
      BASE,
      "fingertip",
    );
    const b = calibrateV3(
      [
        ref("acme-m1-wireless", { length: 1 }, { grips: ["claw"] }),
        ref("acme-m1", { length: 1 }, { grips: ["palm"] }),
      ],
      [wired, wireless],
      BASE,
      "fingertip",
    );
    expect(a).toEqual(b);
    expect(a.calibration.dims.length.answers).toBe(1);
  });

  it("models of different shells still count separately", () => {
    const out = calibrateV3(
      [ref("acme-m1", { length: 1 }), ref("acme-other", { length: 1 })],
      [wired, other],
      BASE,
      "claw",
    );
    expect(out.calibration.dims.length.answers).toBe(2);
  });
});

describe("review round 2026-10-20: a dimension left out reads as null", () => {
  it("omitting a feel and sending null calibrate identically, end to end", () => {
    const base = { slug: "logitech-g903-hero", grips: [] };
    const omitted = fitPreferencesSchema.parse({
      includeVertical: false,
      references: [{ ...base, feel: { length: 1 } }],
    });
    const explicit = fitPreferencesSchema.parse({
      includeVertical: false,
      references: [{ ...base, feel: { length: 1, width: null, height: null } }],
    });
    expect(omitted).toEqual(explicit);
    const m = hand(190, 65.7);
    const run = (prefs: typeof omitted) =>
      scoreFitV3(m, seedCatalogue, prefs, "right", seedPriors);
    const a = run(omitted);
    expect(a).toEqual(run(explicit));
    expect(a.calibration?.referencesUsed).toBe(1);
    expect(a.calibration?.dims.gripWidth.answers).toBe(0);
    expect(a.calibration?.dims.height.answers).toBe(0);
  });
});
