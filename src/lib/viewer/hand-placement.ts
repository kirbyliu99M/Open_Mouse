/**
 * Where the scaled hand sits relative to a mouse shell, for the results
 * page's size illustration.
 *
 * This is a CANDIDATE rule (未拍板), deliberately simple, and it solves no
 * contact: the hand never touches or bends around the mouse, it is only held
 * where a person's hand roughly would be, so the two sizes can be compared.
 *
 *   1. Orientation. Nothing rotates. Both files are authored with the nose and
 *      the fingertips toward glTF -z, up toward +y, so the fingers point to the
 *      nose and the palm faces down onto the mouse.
 *   2. Handedness. The template is a right hand. A left hand is the template
 *      mirrored across its own x = 0 plane (`mirrorX`).
 *   3. Across. The middle of the palm is over the shell's centre line.
 *   4. Along. The middle of the palm is over the middle of the shell's REAR
 *      half (halfway between the shell's centre and its back edge).
 *   5. Height. The underside of the hand rests `HAND_CLEARANCE_M` above the
 *      highest point of the shell, so the two never intersect.
 *
 * Pure, no I/O. glTF axes, metres.
 */
import type { Bounds, ScaledHand, Vec3 } from "./hand-scale";

/** Gap between the highest point of the shell and the underside of the hand. */
export const HAND_CLEARANCE_M = 0.004;

export type Handedness = "left" | "right";

export interface HandPlacement {
  /** Translation of the hand's root object, metres. */
  readonly position: Vec3;
  /** True for a left hand: negate the root object's x scale. */
  readonly mirrorX: boolean;
}

/**
 * Where to put `hand` (scaled, unmirrored, in its own frame) over a shell
 * whose bounds are `shellBounds`. `handedness` is the hand the scan was taken
 * of (`ScanMeasurementsResponse.hand`).
 */
export function handPlacement(
  shellBounds: Bounds,
  hand: ScaledHand,
  handedness: Handedness,
): HandPlacement {
  const mirrorX = handedness === "left";

  // The shell's centre line, and the middle of its rear half. The nose is -z,
  // so the rear is the larger z.
  const centreX = (shellBounds.min[0] + shellBounds.max[0]) / 2;
  const centreZ = (shellBounds.min[2] + shellBounds.max[2]) / 2;
  const rearHalfCentreZ = (centreZ + shellBounds.max[2]) / 2;

  // Mirroring flips the hand's x about its own origin, and the palm centre with it.
  const palmCentreX = mirrorX ? -hand.palmCentre[0] : hand.palmCentre[0];

  return {
    position: [
      centreX - palmCentreX,
      shellBounds.max[1] + HAND_CLEARANCE_M - hand.bounds.min[1],
      rearHalfCentreZ - hand.palmCentre[2],
    ],
    mirrorX,
  };
}

/** The hand's bounds once it has been mirrored and moved by `placement`. */
export function placedHandBounds(
  hand: ScaledHand,
  placement: HandPlacement,
): Bounds {
  const [x0, x1] = placement.mirrorX
    ? [-hand.bounds.max[0], -hand.bounds.min[0]]
    : [hand.bounds.min[0], hand.bounds.max[0]];
  const [px, py, pz] = placement.position;
  return {
    min: [x0 + px, hand.bounds.min[1] + py, hand.bounds.min[2] + pz],
    max: [x1 + px, hand.bounds.max[1] + py, hand.bounds.max[2] + pz],
  };
}

/** The smallest box holding both. */
export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    min: [
      Math.min(a.min[0], b.min[0]),
      Math.min(a.min[1], b.min[1]),
      Math.min(a.min[2], b.min[2]),
    ],
    max: [
      Math.max(a.max[0], b.max[0]),
      Math.max(a.max[1], b.max[1]),
      Math.max(a.max[2], b.max[2]),
    ],
  };
}
