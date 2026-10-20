import {
  GRIP_STYLES,
  type FitCalibration,
  type FitFeel,
  type FitReference,
  type GripStyle,
} from "../../lib/contracts/fit";
import {
  CALIBRATION_CONFLICT_FIT_BELOW,
  CALIBRATION_CONFLICT_MIN_ANSWERS,
  CALIBRATION_FEEL_SOFTNESS,
  CALIBRATION_FINE_FLOOR,
  CALIBRATION_GRID_HALF_RANGE_MM,
  CALIBRATION_GRID_STEP_MM,
  CALIBRATION_PRIOR_SCALE,
  SIGMA_MM,
} from "./coefficients";
import { totalApplies } from "./exclusions";
import { shellKey } from "./shell-groups";
import { scoreGripWidthV1 } from "./subscores-v1";
import type { FitTargets } from "./targets";
import type { CatalogueMouse } from "./types";

/**
 * Personal calibration of the fit-v3.0 candidate (未拍板). Pure functions: the
 * person says, for mice they own, whether each felt too short / just right /
 * too long (and the same for width and height), and each of the three targets
 * (length, grip width, height) gets its own offset from a Bayesian update.
 *
 * Per dimension d the offset delta lives on a grid of -30 to +30 mm in steps
 * of 0.1 mm, with the prior N(0, (1.5 x band_d)^2), band_d = `SIGMA_MM[d]`.
 * A reference mouse of size x, judged against the target t = target_g + delta
 * (w = band_d, s = 0.3 w), gives
 *
 *   P(long)  = sigmoid((x - t - w) / s)
 *   P(short) = sigmoid((t - w - x) / s)
 *   P(right) = max(1e-6, 1 - P(long) - P(short))
 *
 * A reference with several grips averages P over them. The offset is the
 * posterior mean. The fit of a dimension is the maximum of the joint
 * likelihood over the grid divided by the product of each reference's own
 * maximum; with two or more answers and a fit below 0.3 the answers cannot
 * all hold, and the dimension is frozen at a shift of 0.
 *
 * Two rules decide whose answer counts (review round of 2026-10-20):
 * a model the length/width model does not apply to (`totalApplies`: vertical,
 * trackball, height over length above the vertical ratio) never calibrates,
 * and the models of one shell (`shellKey`) are one voice per dimension; see
 * `calibrateV3`.
 *
 * Ported from the browser workbench (v2-debate-2026-10-17/artifact-build),
 * which verified the maths; here it is strictly typed and tested. Candidate
 * numbers, none validated against data.
 */

export type CalibrationDim = "length" | "gripWidth" | "height";
export const CALIBRATION_DIMS: readonly CalibrationDim[] = [
  "length",
  "gripWidth",
  "height",
];

/** "short / right / long" as -1 / 0 / 1. */
export type Feel = -1 | 0 | 1;

const BAND_MM: Record<CalibrationDim, number> = {
  length: SIGMA_MM.length,
  gripWidth: SIGMA_MM.gripWidth,
  height: SIGMA_MM.height,
};

/** The offset grid, built from integer steps so no float drift accumulates. */
export const CALIBRATION_GRID_MM: readonly number[] = (() => {
  const steps = Math.round(
    CALIBRATION_GRID_HALF_RANGE_MM / CALIBRATION_GRID_STEP_MM,
  );
  const grid: number[] = [];
  for (let i = -steps; i <= steps; i++) {
    grid.push(Math.round(i * CALIBRATION_GRID_STEP_MM * 10) / 10);
  }
  return grid;
})();

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/**
 * P(the person gives `feel` | the mouse measures `xMm` in this dimension and
 * their ideal is `targetMm`), for a band of `bandMm`.
 */
export function feelProbability(
  feel: Feel,
  xMm: number,
  targetMm: number,
  bandMm: number,
): number {
  const s = CALIBRATION_FEEL_SOFTNESS * bandMm;
  const pLong = sigmoid((xMm - targetMm - bandMm) / s);
  const pShort = sigmoid((targetMm - bandMm - xMm) / s);
  const pFine = Math.max(CALIBRATION_FINE_FLOOR, 1 - pLong - pShort);
  return feel === 1 ? pLong : feel === -1 ? pShort : pFine;
}

/**
 * A posterior mean smaller than this (mm) is float residue, not an
 * adjustment, and is read as exactly 0. Far below the grid step (0.1 mm).
 */
export const CALIBRATION_NEGLIGIBLE_SHIFT_MM = 1e-9;

/** One answer: how the mouse (size `xMm`) felt, judged against these grip targets (before any offset). */
export interface CalibrationAnswer {
  feel: Feel;
  xMm: number;
  /** One target per grip the person uses this mouse in; P is averaged over them. */
  targetsMm: readonly number[];
}

export interface ShiftPosterior {
  /** Posterior mean of the offset; exactly 0 when frozen or unanswered. */
  shiftMm: number;
  answers: number;
  conflict: boolean;
  /** Joint max / product of single maxima; 1 with fewer than one answer. */
  fit: number;
}

/**
 * The posterior of one dimension's offset given its answers. Pure.
 * `bandMm` is the dimension's band (it sets the prior and the likelihood).
 */
export function posteriorShift(
  allAnswers: readonly CalibrationAnswer[],
  bandMm: number,
  /** The caller already knows the answers contradict (see `calibrateV3`): freeze at 0 whatever the fit. */
  forcedConflict = false,
): ShiftPosterior {
  // An answer with no target to be judged against has no likelihood (its
  // average would divide by zero); it says nothing, so it is left out.
  const answers = allAnswers.filter((a) => a.targetsMm.length > 0);
  if (answers.length === 0) {
    return { shiftMm: 0, answers: 0, conflict: false, fit: 1 };
  }
  const tau = CALIBRATION_PRIOR_SCALE * bandMm;
  const joint = CALIBRATION_GRID_MM.map(() => 1);
  let productOfMaxima = 1;
  for (const answer of answers) {
    let maximum = 0;
    CALIBRATION_GRID_MM.forEach((delta, i) => {
      let p = 0;
      for (const t of answer.targetsMm) {
        p += feelProbability(answer.feel, answer.xMm, t + delta, bandMm);
      }
      const likelihood = p / answer.targetsMm.length;
      joint[i] = joint[i]! * likelihood;
      if (likelihood > maximum) maximum = likelihood;
    });
    productOfMaxima *= maximum;
  }
  const jointMax = Math.max(...joint);
  const fit = productOfMaxima > 0 ? jointMax / productOfMaxima : 1;
  const conflict =
    forcedConflict ||
    (answers.length >= CALIBRATION_CONFLICT_MIN_ANSWERS &&
      fit < CALIBRATION_CONFLICT_FIT_BELOW);
  if (conflict) return { shiftMm: 0, answers: answers.length, conflict, fit };

  let z = 0;
  let weighted = 0;
  CALIBRATION_GRID_MM.forEach((delta, i) => {
    const posterior = Math.exp(-0.5 * (delta / tau) ** 2) * joint[i]!;
    z += posterior;
    weighted += posterior * delta;
  });
  // z is positive for any real input (the prior and the "right" floor are
  // positive); the guard keeps a degenerate input from producing NaN.
  const rawShiftMm = z > 0 ? weighted / z : 0;
  // A symmetric posterior (a mouse exactly on the target, "just right") comes
  // out as float noise around 0 (about 1e-16 mm), which is no adjustment: it
  // must not switch on the "adjusted" notice or the analysis flag (A1-08).
  const shiftMm =
    Math.abs(rawShiftMm) < CALIBRATION_NEGLIGIBLE_SHIFT_MM ? 0 : rawShiftMm;
  return {
    shiftMm: shiftMm + 0, // never -0
    answers: answers.length,
    conflict: false,
    fit,
  };
}

/** The size of `mouse` in a calibration dimension: effective width for grip width. */
function sizeMm(mouse: CatalogueMouse, dim: CalibrationDim): number {
  switch (dim) {
    case "length":
      return mouse.lengthMm;
    case "height":
      return mouse.heightMm;
    case "gripWidth":
      // The same effective width the grip-width score compares to its target
      // (side curvature and an ergonomic thumb rest included).
      return (
        scoreGripWidthV1(mouse, 0).reason.params.effectiveWidthMm ??
        mouse.widthMm
      );
  }
}

/** The feel a reference gave for a dimension (the contract calls grip width "width"). */
function feelOf(reference: FitReference, dim: CalibrationDim): FitFeel {
  switch (dim) {
    case "length":
      return reference.feel.length;
    case "gripWidth":
      return reference.feel.width;
    case "height":
      return reference.feel.height;
  }
}

/**
 * Whether `reference` may calibrate `dim`: answered, and for height not an
 * ergonomic shell (its catalogue height is the top of the shell, not where
 * the palm rests).
 */
function takesPart(
  reference: FitReference,
  mouse: CatalogueMouse,
  dim: CalibrationDim,
): boolean {
  if (feelOf(reference, dim) === null) return false;
  if (dim === "height" && mouse.shape === "ergonomic") return false;
  return true;
}

interface EligibleReference {
  reference: FitReference;
  index: number;
  mouse: CatalogueMouse;
}

/**
 * The references the engine can use at all: the slug is a listed mouse of
 * `catalogue`, the reference is not `specialUse`, and the length/width model
 * applies to its mouse (`totalApplies`). Unknown, unlisted, special-use and
 * not-applicable references are dropped here, before any dimension looks at
 * them. Shared by `calibrateV3` and `adoptedReferences` so the two cannot
 * disagree about who is in.
 */
function eligibleReferences(
  references: readonly FitReference[],
  catalogue: readonly CatalogueMouse[],
): EligibleReference[] {
  const bySlug = new Map<string, CatalogueMouse>();
  for (const mouse of catalogue) {
    if (mouse.listed !== false && !bySlug.has(mouse.slug)) {
      bySlug.set(mouse.slug, mouse);
    }
  }
  const out: EligibleReference[] = [];
  references.forEach((reference, index) => {
    const mouse = bySlug.get(reference.slug);
    if (mouse && !reference.specialUse && totalApplies(mouse)) {
      out.push({ reference, index, mouse });
    }
  });
  return out;
}

/**
 * The references `calibrateV3` would really use: eligible (see above) and
 * taking part in at least one of the three dimensions (an answered one; an
 * ergonomic shell never in height). Input order is kept. Pure.
 */
export function adoptedReferences(
  references: readonly FitReference[],
  catalogue: readonly CatalogueMouse[],
): FitReference[] {
  return eligibleReferences(references, catalogue)
    .filter(({ reference, mouse }) =>
      CALIBRATION_DIMS.some((dim) => takesPart(reference, mouse, dim)),
    )
    .map(({ reference }) => reference);
}

/**
 * How many voices `calibrateV3` would hear: the adopted references counted
 * once per shell (`shellKey`), since the models of one shell are one voice.
 * Two references of the same shell therefore count as one. Pure.
 */
export function adoptedReferenceCount(
  references: readonly FitReference[],
  catalogue: readonly CatalogueMouse[],
): number {
  const shells = new Set<string>();
  for (const { reference, mouse } of eligibleReferences(
    references,
    catalogue,
  )) {
    if (CALIBRATION_DIMS.some((dim) => takesPart(reference, mouse, dim))) {
      shells.add(shellKey(mouse));
    }
  }
  return shells.size;
}

export interface CalibrationResult {
  /** The contract block for the response. */
  calibration: FitCalibration;
  /** The offsets added to every grip's target (0 for a frozen or unanswered dimension). */
  shiftsMm: Record<CalibrationDim, number>;
}

/**
 * Calibrates the three targets from `references`. `baseTargetsByGrip` are the
 * targets before any offset (the thickness answer already in the height);
 * `used` is the grip a reference without grips is judged in.
 *
 * A reference takes part in a dimension when its slug is in `catalogue` and
 * listed, it is not `specialUse`, the length/width model applies to its mouse
 * (`totalApplies`: a vertical device, a trackball or a mouse above the
 * vertical height ratio is ignored like an unlisted one), and it answered
 * that dimension; ergonomic mice never take part in height. A slug that is
 * unknown or unlisted is ignored.
 *
 * Models of the same shell (`shellKey`, the SHELL-1 grouping) are one voice
 * per dimension, since they feel the same in the hand: the same feel from
 * several of them counts once (judged in the union of their grips), and
 * different feels from one shell contradict each other, so the dimension is
 * reported as a conflict and frozen at 0, like any other conflict.
 *
 * `referencesUsed` counts the references that took part in at least one
 * dimension (a reference merged into its shell's answer still took part).
 * Pure: reads its arguments only.
 */
export function calibrateV3(
  references: readonly FitReference[],
  catalogue: readonly CatalogueMouse[],
  baseTargetsByGrip: Record<GripStyle, FitTargets>,
  used: GripStyle,
): CalibrationResult {
  const targetKey: Record<CalibrationDim, keyof FitTargets> = {
    length: "lengthMm",
    gripWidth: "gripWidthMm",
    height: "heightMm",
  };

  const participated = new Set<number>();
  const eligible = eligibleReferences(references, catalogue);

  const dims = {} as Record<CalibrationDim, ShiftPosterior>;
  for (const dim of CALIBRATION_DIMS) {
    // One entry per (shell, feel): the grips are the union over the
    // references that gave that feel for a model of the shell.
    const byShell = new Map<
      string,
      Map<Feel, { xMm: number; grips: Set<GripStyle> }>
    >();
    for (const { reference, index, mouse } of eligible) {
      const feel = feelOf(reference, dim);
      if (feel === null || !takesPart(reference, mouse, dim)) continue;
      const grips: readonly GripStyle[] =
        reference.grips.length > 0 ? reference.grips : [used];
      const key = shellKey(mouse);
      const feels = byShell.get(key) ?? new Map();
      const entry = feels.get(feel) ?? {
        xMm: sizeMm(mouse, dim),
        grips: new Set<GripStyle>(),
      };
      for (const g of grips) entry.grips.add(g);
      feels.set(feel, entry);
      byShell.set(key, feels);
      participated.add(index);
    }
    const answers: CalibrationAnswer[] = [];
    let shellConflict = false;
    for (const feels of byShell.values()) {
      if (feels.size > 1) shellConflict = true;
      for (const [feel, { xMm, grips }] of feels) {
        answers.push({
          feel,
          xMm,
          targetsMm: GRIP_STYLES.filter((g) => grips.has(g)).map(
            (g) => baseTargetsByGrip[g][targetKey[dim]],
          ),
        });
      }
    }
    dims[dim] = posteriorShift(answers, BAND_MM[dim], shellConflict);
  }

  const dimBlock = (d: ShiftPosterior) => ({
    shiftMm: d.shiftMm,
    answers: d.answers,
    conflict: d.conflict,
  });
  return {
    calibration: {
      referencesUsed: participated.size,
      dims: {
        length: dimBlock(dims.length),
        gripWidth: dimBlock(dims.gripWidth),
        height: dimBlock(dims.height),
      },
    },
    shiftsMm: {
      length: dims.length.shiftMm,
      gripWidth: dims.gripWidth.shiftMm,
      height: dims.height.shiftMm,
    },
  };
}
