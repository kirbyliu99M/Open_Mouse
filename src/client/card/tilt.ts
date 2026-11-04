/**
 * The phone's tilt from its motion sensors (ported 2026-11-05 from the scan
 * lab's `src/client/lab/tilt.ts`, candidate 未拍板). On the easy scan's card
 * mode (v3.4) it feeds only the live "phone level" hint (G-M2's tilt check,
 * which never holds the shutter without a reading) and the record of the
 * shutter's window; no measured number depends on it.
 *
 * ── Coordinate conventions (read before changing anything) ──
 *
 * Device frame (W3C DeviceOrientation / DeviceMotion): x to the right of the
 * screen, y up the screen, z out of the screen toward the person, all in the
 * phone's NATURAL (portrait) orientation. The rear camera looks along −z.
 *
 * Camera frame: the OpenCV convention `camera-pose.ts` uses: X right in the
 * image, Y DOWN in the image, Z forward (out of the rear lens). The image is
 * the captured frame as it is shown, upright for the current screen
 * orientation. Browsers deliver the video upright for the screen (a stream
 * that turns from 1080x1920 to 1920x1080 when the phone turns), so the image
 * axes follow the SCREEN's axes, which are the device axes turned by
 * `screen.orientation.angle` (θ):
 *
 *   screen right = cosθ·x − sinθ·y        screen up = sinθ·x + cosθ·y
 *
 *   camera X = screen right, camera Y = −(screen up), camera Z = −z.
 *
 * (θ = 90 is the phone turned a quarter turn counter-clockwise, its top to
 * the left, which is what Android reports for landscape-primary. That the
 * video and `screen.orientation.angle` agree on every phone is 不確定: the raw
 * angle and the raw sensor values are in every record so it can be corrected
 * afterwards.)
 *
 * Tilt and its direction, the two numbers every module of the lab reports:
 *   - `tiltDeg`: the angle between the optical axis (camera +Z) and straight
 *     down. 0 is a camera pointing straight down at the table.
 *   - `azimuthDeg`: the direction of "down" projected into the image,
 *     `atan2(downY, downX)` in image coordinates (x right, y down), in
 *     (−180, 180]. It points toward the side of the picture that is NEARER
 *     the camera (a phone whose top tilts up, looking ahead, sees the near
 *     table at the bottom of the picture: azimuth +90). `null` when the tilt
 *     is too small for a direction to mean anything.
 *
 * Gravity sign: the spec's `accelerationIncludingGravity` points UP at rest
 * (a phone flat on its back reads z ≈ +9.8, Chrome on Android); Safari on iOS
 * has been reported to give the opposite sign on every axis (不確定 for every
 * version). The lab only photographs a table, so the camera always points
 * into the lower half: the sign is chosen so that "down" is in front of the
 * lens (`signAssumed`), which makes the tilt's size independent of the sign
 * and the direction right for both conventions. Raw x/y/z are always kept.
 */

const DEG = 180 / Math.PI;

export type Vec3 = readonly [number, number, number];

/** Below this tilt the direction is noise, so `azimuthDeg` is `null` (candidate). */
export const MIN_TILT_FOR_AZIMUTH_DEG = 0.5;

/** The window either side of the shutter (brief: 0.5 s before and after). */
export const SENSOR_WINDOW_MS = 500;

/** How long the buffer keeps samples. Longer than the two windows together. */
export const SENSOR_BUFFER_MS = 3000;

export interface TiltReading {
  /** Optical axis from straight down, degrees, 0 to 180. */
  readonly tiltDeg: number;
  /** Direction of down in the image (x right, y down), degrees in (−180, 180]; `null` below `MIN_TILT_FOR_AZIMUTH_DEG`. */
  readonly azimuthDeg: number | null;
  /** The unit down vector in the camera frame, for 3D comparisons. */
  readonly downCamera: Vec3;
}

function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function finite3(v: Vec3): boolean {
  return v.every((c) => Number.isFinite(c));
}

/**
 * A device-frame vector in camera coordinates, for screen angle θ degrees
 * (see the header). Pure.
 */
export function deviceToCamera(v: Vec3, screenAngleDeg: number): Vec3 {
  const t =
    ((Number.isFinite(screenAngleDeg) ? screenAngleDeg : 0) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const right = c * v[0] - s * v[1];
  const up = s * v[0] + c * v[1];
  return [right, -up, -v[2]];
}

/**
 * Tilt and direction from a DOWN vector in camera coordinates (any length).
 * `null` for a zero or non-finite vector. Pure.
 */
export function tiltFromCameraDown(down: Vec3): TiltReading | null {
  if (!finite3(down)) return null;
  const n = norm(down);
  if (!(n > 1e-12)) return null;
  const u: Vec3 = [down[0] / n, down[1] / n, down[2] / n];
  const tiltDeg = Math.acos(Math.max(-1, Math.min(1, u[2]))) * DEG;
  const azimuthDeg =
    tiltDeg >= MIN_TILT_FOR_AZIMUTH_DEG
      ? normaliseAzimuth(Math.atan2(u[1], u[0]) * DEG)
      : null;
  return { tiltDeg, azimuthDeg, downCamera: u };
}

/** An angle in (−180, 180]. */
export function normaliseAzimuth(deg: number): number {
  let a = deg % 360;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  return a;
}

export type GravitySign = "spec" | "flipped";

/**
 * Down in the DEVICE frame from a raw `accelerationIncludingGravity`, with the
 * sign chosen so the rear camera faces down (see the header): `spec` when the
 * raw vector pointed up (down = −a, the W3C convention), `flipped` when it
 * pointed down (down = +a, as iOS has been reported to give). `null` for a
 * vector that is missing, not finite or zero.
 */
export function deviceDownFromGravity(
  raw: Vec3,
): { readonly down: Vec3; readonly signAssumed: GravitySign } | null {
  if (!finite3(raw) || !(norm(raw) > 1e-9)) return null;
  // The rear camera looks along device −z, so down in front of the lens means
  // down.z < 0. Raw z > 0 (or exactly 0, a phone held upright) is the spec's up.
  if (raw[2] >= 0)
    return { down: [-raw[0], -raw[1], -raw[2]], signAssumed: "spec" };
  return { down: [raw[0], raw[1], raw[2]], signAssumed: "flipped" };
}

/** Tilt from a raw gravity vector and the screen angle. Pure. */
export function tiltFromGravity(
  raw: Vec3,
  screenAngleDeg: number,
): (TiltReading & { readonly signAssumed: GravitySign }) | null {
  const d = deviceDownFromGravity(raw);
  if (!d) return null;
  const reading = tiltFromCameraDown(deviceToCamera(d.down, screenAngleDeg));
  return reading ? { ...reading, signAssumed: d.signAssumed } : null;
}

/**
 * Down in the device frame from `DeviceOrientationEvent` beta and gamma
 * (degrees; the spec's Z-X'-Y'' angles, alpha does not move "down"):
 * up = (−cosβ·sinγ, sinβ, cosβ·cosγ), the third row of Rz(α)·Rx(β)·Ry(γ).
 */
export function deviceDownFromOrientation(
  betaDeg: number,
  gammaDeg: number,
): Vec3 | null {
  if (!Number.isFinite(betaDeg) || !Number.isFinite(gammaDeg)) return null;
  const b = betaDeg / DEG;
  const g = gammaDeg / DEG;
  return [Math.cos(b) * Math.sin(g), -Math.sin(b), -Math.cos(b) * Math.cos(g)];
}

/** Tilt from beta/gamma and the screen angle (the cross-check). Pure. */
export function tiltFromOrientation(
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg: number,
): TiltReading | null {
  const d = deviceDownFromOrientation(betaDeg, gammaDeg);
  return d ? tiltFromCameraDown(deviceToCamera(d, screenAngleDeg)) : null;
}

// ── The sample buffer ───────────────────────────────────────────────────────

export interface MotionSample {
  /** `performance.now()` when it arrived, ms. */
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface OrientationSample {
  readonly t: number;
  readonly beta: number;
  readonly gamma: number;
  /** Kept raw; alpha (compass heading) does not move the tilt. `null` where the browser gave none. */
  readonly alpha: number | null;
}

export interface AxisStats {
  readonly mean: number;
  readonly std: number;
}

export interface MotionWindowStats {
  readonly n: number;
  readonly x: AxisStats;
  readonly y: AxisStats;
  readonly z: AxisStats;
  /** From the MEAN raw vector. */
  readonly tiltDeg: number | null;
  readonly azimuthDeg: number | null;
  readonly signAssumed: GravitySign | null;
  /** Standard deviation of the per-sample tilts, degrees: how still the phone was. */
  readonly tiltStdDeg: number | null;
  /** |mean raw vector|, m/s²: about 9.8 when the phone is still. */
  readonly magnitude: number;
}

export interface OrientationWindowStats {
  readonly n: number;
  readonly beta: AxisStats;
  readonly gamma: AxisStats;
  readonly tiltDeg: number | null;
  readonly azimuthDeg: number | null;
  readonly tiltStdDeg: number | null;
}

export interface SensorWindows<T> {
  /** [shutter − 500 ms, shutter). */
  readonly before: T | null;
  /** [shutter, shutter + 500 ms]. */
  readonly after: T | null;
  /** Both together: what the page compares with the paper. */
  readonly around: T | null;
}

export interface SensorSnapshot {
  /** `screen.orientation.angle` at the shutter, degrees (raw, for correcting afterwards). */
  readonly screenAngleDeg: number;
  readonly windowMs: number;
  readonly motion: SensorWindows<MotionWindowStats>;
  readonly orientation: SensorWindows<OrientationWindowStats>;
}

function stats(values: readonly number[]): AxisStats {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance =
    n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, std: Math.sqrt(variance) };
}

function tiltStd(readings: readonly (TiltReading | null)[]): number | null {
  const tilts = readings
    .filter((r): r is TiltReading => r !== null)
    .map((r) => r.tiltDeg);
  return tilts.length > 0 ? stats(tilts).std : null;
}

/** Stats of motion samples (screen angle θ), `null` for none. Pure. */
export function motionWindowStats(
  samples: readonly MotionSample[],
  screenAngleDeg: number,
): MotionWindowStats | null {
  const ok = samples.filter((s) => finite3([s.x, s.y, s.z]));
  if (ok.length === 0) return null;
  const x = stats(ok.map((s) => s.x));
  const y = stats(ok.map((s) => s.y));
  const z = stats(ok.map((s) => s.z));
  const meanVec: Vec3 = [x.mean, y.mean, z.mean];
  const reading = tiltFromGravity(meanVec, screenAngleDeg);
  return {
    n: ok.length,
    x,
    y,
    z,
    tiltDeg: reading?.tiltDeg ?? null,
    azimuthDeg: reading?.azimuthDeg ?? null,
    signAssumed: reading?.signAssumed ?? null,
    tiltStdDeg: tiltStd(
      ok.map((s) => tiltFromGravity([s.x, s.y, s.z], screenAngleDeg)),
    ),
    magnitude: norm(meanVec),
  };
}

/** Stats of orientation samples, `null` for none. Pure. */
export function orientationWindowStats(
  samples: readonly OrientationSample[],
  screenAngleDeg: number,
): OrientationWindowStats | null {
  const ok = samples.filter(
    (s) => Number.isFinite(s.beta) && Number.isFinite(s.gamma),
  );
  if (ok.length === 0) return null;
  const beta = stats(ok.map((s) => s.beta));
  const gamma = stats(ok.map((s) => s.gamma));
  // Beta and gamma stay well inside (−90, 90) over a table, so averaging the
  // angles themselves is safe here (no wrap-around).
  const reading = tiltFromOrientation(beta.mean, gamma.mean, screenAngleDeg);
  return {
    n: ok.length,
    beta,
    gamma,
    tiltDeg: reading?.tiltDeg ?? null,
    azimuthDeg: reading?.azimuthDeg ?? null,
    tiltStdDeg: tiltStd(
      ok.map((s) => tiltFromOrientation(s.beta, s.gamma, screenAngleDeg)),
    ),
  };
}

function windows<S extends { readonly t: number }, T>(
  samples: readonly S[],
  shutterT: number,
  windowMs: number,
  summarise: (s: readonly S[]) => T | null,
): SensorWindows<T> {
  const before = samples.filter(
    (s) => s.t >= shutterT - windowMs && s.t < shutterT,
  );
  const after = samples.filter(
    (s) => s.t >= shutterT && s.t <= shutterT + windowMs,
  );
  return {
    before: summarise(before),
    after: summarise(after),
    around: summarise([...before, ...after]),
  };
}

/**
 * The sensor record for a shutter at `shutterT`: stats of the 0.5 s before
 * and after it, from both sensors. `null` when neither sensor gave a single
 * sample in that second (no sensor, permission refused, a desktop): the page
 * still takes the photo. Pure.
 */
export function snapshotSensors(input: {
  readonly motion: readonly MotionSample[];
  readonly orientation: readonly OrientationSample[];
  readonly shutterT: number;
  readonly screenAngleDeg: number;
  readonly windowMs?: number;
}): SensorSnapshot | null {
  const windowMs = input.windowMs ?? SENSOR_WINDOW_MS;
  const angle = Number.isFinite(input.screenAngleDeg)
    ? input.screenAngleDeg
    : 0;
  const motion = windows(input.motion, input.shutterT, windowMs, (s) =>
    motionWindowStats(s, angle),
  );
  const orientation = windows(
    input.orientation,
    input.shutterT,
    windowMs,
    (s) => orientationWindowStats(s, angle),
  );
  if (!motion.around && !orientation.around) return null;
  return { screenAngleDeg: angle, windowMs, motion, orientation };
}

/**
 * A rolling buffer of the last `SENSOR_BUFFER_MS` of samples. The only
 * stateful piece here; it holds plain data and touches no DOM.
 */
export class SensorBuffer {
  private motion: MotionSample[] = [];
  private orientation: OrientationSample[] = [];

  constructor(private readonly keepMs: number = SENSOR_BUFFER_MS) {}

  pushMotion(sample: MotionSample): void {
    this.motion.push(sample);
    this.trim(sample.t);
  }

  pushOrientation(sample: OrientationSample): void {
    this.orientation.push(sample);
    this.trim(sample.t);
  }

  private trim(now: number): void {
    const cut = now - this.keepMs;
    while (this.motion.length > 0 && this.motion[0].t < cut)
      this.motion.shift();
    while (this.orientation.length > 0 && this.orientation[0].t < cut)
      this.orientation.shift();
  }

  latestMotion(): MotionSample | null {
    return this.motion[this.motion.length - 1] ?? null;
  }

  latestOrientation(): OrientationSample | null {
    return this.orientation[this.orientation.length - 1] ?? null;
  }

  snapshot(shutterT: number, screenAngleDeg: number): SensorSnapshot | null {
    return snapshotSensors({
      motion: this.motion,
      orientation: this.orientation,
      shutterT,
      screenAngleDeg,
    });
  }
}

/** A raw `DeviceMotionEvent.accelerationIncludingGravity` as a sample, or `null` when any axis is missing. */
export function motionSampleOf(
  gravity:
    { x: number | null; y: number | null; z: number | null } | null | undefined,
  t: number,
): MotionSample | null {
  if (!gravity) return null;
  const { x, y, z } = gravity;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number")
    return null;
  if (!finite3([x, y, z])) return null;
  return { t, x, y, z };
}

/** A raw `DeviceOrientationEvent` as a sample, or `null` without beta and gamma. */
export function orientationSampleOf(
  event: { alpha: number | null; beta: number | null; gamma: number | null },
  t: number,
): OrientationSample | null {
  const { alpha, beta, gamma } = event;
  if (typeof beta !== "number" || typeof gamma !== "number") return null;
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return null;
  return {
    t,
    beta,
    gamma,
    alpha: typeof alpha === "number" && Number.isFinite(alpha) ? alpha : null,
  };
}

// ── iOS permission ──────────────────────────────────────────────────────────

export type SensorPermission =
  "granted" | "denied" | "not-required" | "error" | "not-asked";

/** The static `requestPermission` iOS Safari adds to the two event constructors. */
interface PermissionCtor {
  requestPermission?: () => Promise<string>;
}

/**
 * Ask for one sensor's permission, as iOS needs from a tap. `not-required`
 * where the constructor has no `requestPermission` (Android, desktop) or
 * does not exist. Never throws.
 */
export async function requestSensorPermission(
  ctor: PermissionCtor | undefined | null,
): Promise<SensorPermission> {
  if (!ctor || typeof ctor.requestPermission !== "function")
    return "not-required";
  try {
    const answer = await ctor.requestPermission();
    return answer === "granted" ? "granted" : "denied";
  } catch {
    return "error";
  }
}
