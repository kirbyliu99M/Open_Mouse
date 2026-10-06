/**
 * Orbit-camera maths for the 3D viewer: pure, no three.js, no DOM.
 *
 * The camera circles a target point. `azimuth` turns it around the vertical
 * axis (0 looks at the model from the rear, along -z toward the nose; positive
 * moves the camera toward +x), `elevation` lifts it above the horizontal
 * plane. Angles are radians. docs/design-guidelines.md, "3D viewer": the orbit
 * tracks the pointer 1:1, a flick carries momentum
 * (`projected = current + (v / 1000) * d / (1 - d)`, d = 0.998 per
 * millisecond), and any motion can be grabbed mid-flight.
 */
import type { Vec3 } from "./hand-scale";

export interface OrbitAngles {
  readonly azimuth: number;
  readonly elevation: number;
}

export interface OrbitVelocity {
  /** Radians per second. */
  readonly azimuth: number;
  readonly elevation: number;
}

const DEG = Math.PI / 180;

/** Never under the desk, never straight down (where azimuth stops meaning anything). */
export const ELEVATION_MIN = 4 * DEG;
export const ELEVATION_MAX = 85 * DEG;

/** 0.5 degree of turn per pixel dragged. */
export const RADIANS_PER_PIXEL = 0.5 * DEG;
/** One arrow-key press. */
export const KEY_STEP = 5 * DEG;
/** The per-millisecond velocity retention of the guideline's momentum formula. */
export const MOMENTUM_DECAY = 0.998;
/** Below this speed (rad/s) a coast is over. */
export const MOMENTUM_STOP_SPEED = 0.02;
/** Pointer samples older than this do not count toward a release velocity. */
export const VELOCITY_WINDOW_MS = 90;

/** The opening view: from the thumb side and behind, a little above. */
export function defaultAngles(hand: "left" | "right"): OrbitAngles {
  return {
    azimuth: (hand === "right" ? -40 : 40) * DEG,
    elevation: 28 * DEG,
  };
}

export function clampElevation(elevation: number): number {
  return Math.min(ELEVATION_MAX, Math.max(ELEVATION_MIN, elevation));
}

/**
 * The angles after the pointer moved `dxPx` right and `dyPx` down: the model
 * follows the pointer. `horizontalOnly` ignores `dyPx` (a touch drag, where
 * vertical movement belongs to the page's scroll).
 */
export function dragAngles(
  angles: OrbitAngles,
  dxPx: number,
  dyPx: number,
  horizontalOnly = false,
): OrbitAngles {
  return {
    azimuth: angles.azimuth - dxPx * RADIANS_PER_PIXEL,
    elevation: horizontalOnly
      ? angles.elevation
      : clampElevation(angles.elevation + dyPx * RADIANS_PER_PIXEL),
  };
}

/** The angles after an arrow key, or null for any other key. Left/right turn the model the way the arrow points. */
export function keyAngles(
  angles: OrbitAngles,
  key: string,
): OrbitAngles | null {
  switch (key) {
    case "ArrowLeft":
      return { ...angles, azimuth: angles.azimuth + KEY_STEP };
    case "ArrowRight":
      return { ...angles, azimuth: angles.azimuth - KEY_STEP };
    case "ArrowUp":
      return {
        ...angles,
        elevation: clampElevation(angles.elevation - KEY_STEP),
      };
    case "ArrowDown":
      return {
        ...angles,
        elevation: clampElevation(angles.elevation + KEY_STEP),
      };
    default:
      return null;
  }
}

/** One recent pointer move, for the release velocity. */
export interface PointerSample {
  readonly t: number;
  readonly dxPx: number;
  readonly dyPx: number;
}

/**
 * The angular velocity at release, from the moves in the last
 * `VELOCITY_WINDOW_MS` before `nowMs`. A pointer that stopped before it was
 * released has no samples in the window and so no velocity.
 */
export function releaseVelocity(
  samples: readonly PointerSample[],
  nowMs: number,
  horizontalOnly = false,
): OrbitVelocity {
  const recent = samples.filter((s) => nowMs - s.t <= VELOCITY_WINDOW_MS);
  if (recent.length === 0) return { azimuth: 0, elevation: 0 };
  const span = Math.max(nowMs - recent[0]!.t, 16);
  const dx = recent.reduce((sum, s) => sum + s.dxPx, 0);
  const dy = recent.reduce((sum, s) => sum + s.dyPx, 0);
  return {
    azimuth: (-dx * RADIANS_PER_PIXEL * 1000) / span,
    elevation: horizontalOnly ? 0 : (dy * RADIANS_PER_PIXEL * 1000) / span,
  };
}

/** Where `velocity` would carry the angles if it coasted to a stop (the guideline's projection). */
export function projectedAngles(
  angles: OrbitAngles,
  velocity: OrbitVelocity,
): OrbitAngles {
  const factor = MOMENTUM_DECAY / (1 - MOMENTUM_DECAY) / 1000;
  return {
    azimuth: angles.azimuth + velocity.azimuth * factor,
    elevation: clampElevation(angles.elevation + velocity.elevation * factor),
  };
}

export interface CoastStep {
  readonly angles: OrbitAngles;
  readonly velocity: OrbitVelocity;
  /** False once the coast has ended (slow enough, or pinned against a limit). */
  readonly moving: boolean;
}

/** Advances a coast by `dtMs`: the same decay as `projectedAngles`, so the two agree. */
export function coastStep(
  angles: OrbitAngles,
  velocity: OrbitVelocity,
  dtMs: number,
): CoastStep {
  const retained = Math.pow(MOMENTUM_DECAY, dtMs);
  const travelled =
    (MOMENTUM_DECAY * (1 - retained)) / (1 - MOMENTUM_DECAY) / 1000;
  const elevation = clampElevation(
    angles.elevation + velocity.elevation * travelled,
  );
  const pinned =
    elevation !== angles.elevation + velocity.elevation * travelled;
  const next: OrbitVelocity = {
    azimuth: velocity.azimuth * retained,
    elevation: pinned ? 0 : velocity.elevation * retained,
  };
  return {
    angles: {
      azimuth: angles.azimuth + velocity.azimuth * travelled,
      elevation,
    },
    velocity: next,
    moving: Math.hypot(next.azimuth, next.elevation) > MOMENTUM_STOP_SPEED,
  };
}

/** The camera's position for `angles`, `distance` from `target`. */
export function cameraPosition(
  target: Vec3,
  distance: number,
  angles: OrbitAngles,
): Vec3 {
  const horizontal = Math.cos(angles.elevation);
  return [
    target[0] + distance * Math.sin(angles.azimuth) * horizontal,
    target[1] + distance * Math.sin(angles.elevation),
    target[2] + distance * Math.cos(angles.azimuth) * horizontal,
  ];
}

/**
 * How far back the camera sits so that a sphere of `radius` fits the frame
 * whatever the azimuth: the narrower of the vertical and horizontal fields of
 * view decides. `margin` is the extra room around it (1.1 = 10 %).
 */
export function fitDistance(
  radius: number,
  verticalFovDeg: number,
  aspect: number,
  margin = 1.1,
): number {
  const vertical = verticalFovDeg * DEG;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  return (radius * margin) / Math.sin(Math.min(vertical, horizontal) / 2);
}

/** Half the diagonal of a box: the radius of the sphere around it. */
export function boundingRadius(min: Vec3, max: Vec3): number {
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
}

/** The opening turn: a gentle sweep that starts by itself and ends by itself (WCAG 2.2.2). */
export const INTRO_DURATION_MS = 3000;
export const INTRO_SPEED = 0.3;
