/**
 * Scaling the template hand (`public/models/hand.glb`) to a person's measured
 * hand, for the results page's size illustration.
 *
 * What the model is. `hand.glb` is an authored neutral template, not a
 * population measurement (`manifest.json` -> `hand.restPose`: "flat palm
 * down; authored template"). Its 21 bones follow the MediaPipe landmark
 * indices. It is a RIGHT hand: palm down, fingers toward Blender +Y (glTF -Z),
 * and the thumb at -X, which is the left side seen from above with the fingers
 * up. Blender's axes are the file's authoring frame; glTF's are what three.js
 * sees (`manifest.orientationConvention`): Blender (x, y, z) is glTF
 * (x, z, -y). Units are metres.
 *
 * What is scaled, and what is not. The two measurements the caption names are
 * made exact, with one scale factor per axis of the hand:
 *   along     the hand's length axis (wrist to fingertips), so that
 *             landmark 0 -> landmark 12 is `handLengthMm` (MEASUREMENT_
 *             DEFINITIONS in the measurement contract);
 *   across    the width axis, so that landmark 5 -> landmark 17 is
 *             `palmWidthMm`;
 *   thickness the geometric mean of the two, because nothing measured
 *             constrains it (`palmThicknessMm` is optional and the template's
 *             own palm thickness is not recorded, so it is not used).
 * The five finger lengths are NOT used. docs/PLAN.md M4b says to scale each
 * bone to the measured lengths, as part of the full simulation (posing by grip
 * style and collision). This illustration has neither, its caption promises only
 * the two lengths above, and bone-by-bone scaling would shear the skin and
 * break the exactness of the hand length for any finger that is not scaled
 * with it. Adding it later changes this file and the rig adapter only.
 *
 * Pure, no I/O: the template numbers below are copies of
 * `manifest.json` (`hand.landmarksMetres`) and of hand.glb's POSITION
 * accessor bounds, and a unit test reads both files and compares.
 */

export type Vec3 = readonly [number, number, number];

/** Axis-aligned box in metres. */
export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * The template's 21 landmark positions, metres, in the file's authoring frame
 * (Blender: x across, y toward the fingertips, z up; the hand is flat so z is
 * 0). Index = MediaPipe landmark index. Same numbers as `manifest.json`.
 */
export const TEMPLATE_LANDMARKS_M: readonly Vec3[] = [
  [0, 0, 0],
  [-0.02, 0.028, 0],
  [-0.039, 0.048, 0],
  [-0.053, 0.065, 0],
  [-0.064, 0.081, 0],
  [-0.025, 0.075, 0],
  [-0.026, 0.113, 0],
  [-0.026, 0.137, 0],
  [-0.026, 0.158, 0],
  [-0.006, 0.081, 0],
  [-0.006, 0.124, 0],
  [-0.006, 0.152, 0],
  [-0.006, 0.176, 0],
  [0.014, 0.077, 0],
  [0.016, 0.117, 0],
  [0.017, 0.143, 0],
  [0.018, 0.165, 0],
  [0.032, 0.068, 0],
  [0.037, 0.099, 0],
  [0.04, 0.12, 0],
  [0.042, 0.138, 0],
];

/**
 * The template mesh's bounds in glTF axes (x across, y up, z toward the
 * viewer; the fingers point to -z), metres: hand.glb's POSITION accessor min
 * and max. The skin lies from 5 mm behind the wrist landmark to 175 mm in
 * front of it, and is about 24 mm thick.
 */
export const TEMPLATE_BOUNDS_GLTF_M: Bounds = {
  min: [-0.06487654149532318, -0.011934052221477032, -0.17502790689468384],
  max: [0.044878896325826645, 0.011940502561628819, 0.004999999888241291],
};

const distance2d = (a: Vec3, b: Vec3): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The template's own `handLengthMm` (landmark 0 to 12) and `palmWidthMm` (5 to 17). */
export const TEMPLATE_HAND_LENGTH_MM =
  distance2d(TEMPLATE_LANDMARKS_M[0]!, TEMPLATE_LANDMARKS_M[12]!) * 1000;
export const TEMPLATE_PALM_WIDTH_MM =
  distance2d(TEMPLATE_LANDMARKS_M[5]!, TEMPLATE_LANDMARKS_M[17]!) * 1000;

/** Per-axis scale of the hand, named by what the axis is on the hand. */
export interface HandScale {
  /** Along the hand: wrist toward fingertips (glTF z). */
  readonly along: number;
  /** Across the palm (glTF x). */
  readonly across: number;
  /** Through the palm (glTF y). */
  readonly thickness: number;
}

/** What `handScale` reads of a scan: the two measurements the caption names. */
export interface ScaleMeasurements {
  readonly handLengthMm: number;
  readonly palmWidthMm: number;
}

/**
 * The scale that makes the template's landmark 0 -> 12 distance equal
 * `handLengthMm` and its landmark 5 -> 17 distance equal `palmWidthMm`.
 *
 * Both distances have a small component on the other axis (landmark 12 is
 * 6 mm off the wrist's line, landmark 17 is 7 mm lower than 5), so a plain
 * ratio per axis would miss by a fraction of a millimetre. The two equations
 *   (across * ax)^2 + (along * ay)^2 = length^2
 *   (across * bx)^2 + (along * by)^2 = width^2
 * are linear in the squares and are solved exactly. If the solution is not a
 * pair of positive finite numbers (a template this function was not written
 * for) it falls back to the plain per-axis ratios.
 */
export function handScale(
  measurements: ScaleMeasurements,
  landmarks: readonly Vec3[] = TEMPLATE_LANDMARKS_M,
): HandScale {
  const length = measurements.handLengthMm / 1000;
  const width = measurements.palmWidthMm / 1000;
  const [ax, ay] = [
    landmarks[12]![0] - landmarks[0]![0],
    landmarks[12]![1] - landmarks[0]![1],
  ];
  const [bx, by] = [
    landmarks[17]![0] - landmarks[5]![0],
    landmarks[17]![1] - landmarks[5]![1],
  ];

  const det = ax * ax * (by * by) - ay * ay * (bx * bx);
  const acrossSquared =
    (length * length * (by * by) - ay * ay * width * width) / det;
  const alongSquared =
    (ax * ax * width * width - bx * bx * length * length) / det;

  let across: number;
  let along: number;
  if (
    Number.isFinite(acrossSquared) &&
    Number.isFinite(alongSquared) &&
    acrossSquared > 0 &&
    alongSquared > 0
  ) {
    across = Math.sqrt(acrossSquared);
    along = Math.sqrt(alongSquared);
  } else {
    across = width / Math.hypot(bx, by);
    along = length / Math.hypot(ax, ay);
  }
  return { along, across, thickness: Math.sqrt(across * along) };
}

/** The scaled, unmirrored template hand, in the hand's own glTF frame. */
export interface ScaledHand {
  /** Bounds of the skin after scaling, metres. */
  readonly bounds: Bounds;
  /**
   * The middle of the palm: the centroid of the wrist and the four finger
   * knuckles (landmarks 0, 5, 9, 13, 17), on the palm's mid-plane (y = 0).
   */
  readonly palmCentre: Vec3;
}

const PALM_LANDMARKS = [0, 5, 9, 13, 17] as const;

/** Applies `scale` to the template's bounds and palm centre. */
export function scaleHand(
  scale: HandScale,
  bounds: Bounds = TEMPLATE_BOUNDS_GLTF_M,
  landmarks: readonly Vec3[] = TEMPLATE_LANDMARKS_M,
): ScaledHand {
  const s: Vec3 = [scale.across, scale.thickness, scale.along];
  const scaleBox = (v: Vec3): Vec3 => [v[0] * s[0], v[1] * s[1], v[2] * s[2]];

  // Authoring frame (x, y, z) -> glTF (x, z, -y).
  let cx = 0;
  let cz = 0;
  for (const index of PALM_LANDMARKS) {
    const p = landmarks[index]!;
    cx += p[0];
    cz += -p[1];
  }
  const palmCentre = scaleBox([
    cx / PALM_LANDMARKS.length,
    0,
    cz / PALM_LANDMARKS.length,
  ]);

  return {
    bounds: { min: scaleBox(bounds.min), max: scaleBox(bounds.max) },
    palmCentre,
  };
}

/** The scales as three.js wants them on the hand's root object: (x, y, z) = (across, thickness, along). */
export function scaleAsVector(scale: HandScale): Vec3 {
  return [scale.across, scale.thickness, scale.along];
}
