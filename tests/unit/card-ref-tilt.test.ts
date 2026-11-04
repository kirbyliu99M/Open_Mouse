import { describe, expect, it } from "vitest";
import {
  deviceDownFromOrientation,
  deviceToCamera,
  motionSampleOf,
  normaliseAzimuth,
  orientationSampleOf,
  requestSensorPermission,
  SensorBuffer,
  snapshotSensors,
  tiltFromGravity,
  tiltFromOrientation,
  type MotionSample,
  type Vec3,
} from "../../src/client/card/tilt";

const G = 9.81;

/** The raw reading the spec gives (it points UP: minus down). */
function specGravity(beta: number, gamma: number): Vec3 {
  const d = deviceDownFromOrientation(beta, gamma)!;
  return [-d[0] * G, -d[1] * G, -d[2] * G];
}

describe("tilt from gravity (scan lab)", () => {
  it("reads 0 for a phone flat on its back, camera straight down, either sign", () => {
    expect(tiltFromGravity([0, 0, G], 0)!.tiltDeg).toBeCloseTo(0, 9);
    expect(tiltFromGravity([0, 0, -G], 0)!.tiltDeg).toBeCloseTo(0, 9);
    expect(tiltFromGravity([0, 0, G], 0)!.azimuthDeg).toBeNull();
    expect(tiltFromGravity([0, 0, G], 0)!.signAssumed).toBe("spec");
    expect(tiltFromGravity([0, 0, -G], 0)!.signAssumed).toBe("flipped");
  });

  it("gives the same tilt AND direction for the spec sign and the iOS (all axes flipped) sign", () => {
    for (const [beta, gamma] of [
      [10, 0],
      [0, 12],
      [-8, 5],
      [15, -15],
    ]) {
      for (const angle of [0, 90, 180, 270]) {
        const raw = specGravity(beta, gamma);
        const flipped: Vec3 = [-raw[0], -raw[1], -raw[2]];
        const a = tiltFromGravity(raw, angle)!;
        const b = tiltFromGravity(flipped, angle)!;
        expect(b.tiltDeg).toBeCloseTo(a.tiltDeg, 9);
        expect(b.azimuthDeg!).toBeCloseTo(a.azimuthDeg!, 9);
      }
    }
  });

  it("a phone whose top tilts up (beta > 0) sees the near table at the image bottom: azimuth +90 in portrait", () => {
    const r = tiltFromGravity(specGravity(10, 0), 0)!;
    expect(r.tiltDeg).toBeCloseTo(10, 9);
    expect(r.azimuthDeg!).toBeCloseTo(90, 9);
  });

  it("a phone rolled right side down (gamma > 0) puts the near side on the image right: azimuth 0 in portrait", () => {
    const r = tiltFromGravity(specGravity(0, 10), 0)!;
    expect(r.tiltDeg).toBeCloseTo(10, 9);
    expect(r.azimuthDeg!).toBeCloseTo(0, 9);
  });

  it("turns the direction with the screen: the same physical tilt reads 90 degrees apart at angle 0 and 90", () => {
    const raw = specGravity(10, 0);
    const portrait = tiltFromGravity(raw, 0)!;
    const landscape = tiltFromGravity(raw, 90)!;
    expect(landscape.tiltDeg).toBeCloseTo(portrait.tiltDeg, 9);
    expect(
      normaliseAzimuth(landscape.azimuthDeg! - portrait.azimuthDeg!),
    ).toBeCloseTo(-90, 9);
  });

  it("agrees with the beta/gamma cross-check for the same pose", () => {
    for (const [beta, gamma, angle] of [
      [7, 3, 0],
      [-12, 9, 90],
      [4, -14, 270],
    ]) {
      const fromMotion = tiltFromGravity(specGravity(beta, gamma), angle)!;
      const fromOrientation = tiltFromOrientation(beta, gamma, angle)!;
      expect(fromOrientation.tiltDeg).toBeCloseTo(fromMotion.tiltDeg, 9);
      expect(fromOrientation.azimuthDeg!).toBeCloseTo(
        fromMotion.azimuthDeg!,
        9,
      );
    }
  });

  it("tilt from beta/gamma is acos(cos beta cos gamma)", () => {
    const r = tiltFromOrientation(10, 10, 0)!;
    const expected =
      (Math.acos(Math.cos(Math.PI / 18) * Math.cos(Math.PI / 18)) * 180) /
      Math.PI;
    expect(r.tiltDeg).toBeCloseTo(expected, 9);
  });

  it("deviceToCamera maps the device's axes as the header says", () => {
    expect(deviceToCamera([1, 0, 0], 0)).toEqual([1, -0, -0]);
    const v = deviceToCamera([0, 1, 0], 90);
    expect(v[0]).toBeCloseTo(-1, 12);
    expect(v[1]).toBeCloseTo(0, 12);
  });

  it("deviceToCamera at 180 and 270: hard-coded, from the phone's physical turn", () => {
    const close = (v: Vec3, e: Vec3) =>
      v.forEach((c, i) => expect(c).toBeCloseTo(e[i], 12));
    // 180: upside down. Device +x points left in the picture, device +y
    // (the phone's top) points down the picture, the screen still faces you.
    close(deviceToCamera([1, 0, 0], 180), [-1, 0, 0]);
    close(deviceToCamera([0, 1, 0], 180), [0, 1, 0]);
    close(deviceToCamera([0, 0, 1], 180), [0, 0, -1]);
    // 270: turned a quarter clockwise, the top to the right. Device +y points
    // right in the picture, device +x points down it.
    close(deviceToCamera([1, 0, 0], 270), [0, 1, 0]);
    close(deviceToCamera([0, 1, 0], 270), [1, 0, 0]);
    close(deviceToCamera([0, 0, 1], 270), [0, 0, -1]);
  });

  it("answers null for a missing or zero vector", () => {
    expect(tiltFromGravity([0, 0, 0], 0)).toBeNull();
    expect(tiltFromGravity([Number.NaN, 0, 1], 0)).toBeNull();
    expect(tiltFromOrientation(Number.NaN, 0, 0)).toBeNull();
  });
});

describe("sensor windows around the shutter", () => {
  const still = (t: number): MotionSample => ({ t, ...xyz(specGravity(5, 0)) });
  function xyz(v: Vec3) {
    return { x: v[0], y: v[1], z: v[2] };
  }

  it("splits the samples 0.5 s before and after the shutter and counts them", () => {
    const motion = [100, 600, 700, 900, 1000, 1100, 1400, 1600, 2000].map(
      still,
    );
    const snap = snapshotSensors({
      motion,
      orientation: [],
      shutterT: 1000,
      screenAngleDeg: 0,
    })!;
    expect(snap.motion.before!.n).toBe(3); // 600, 700, 900
    expect(snap.motion.after!.n).toBe(3); // 1000, 1100, 1400
    expect(snap.motion.around!.n).toBe(
      snap.motion.before!.n + snap.motion.after!.n,
    );
    expect(snap.motion.around!.tiltDeg!).toBeCloseTo(5, 6);
    expect(snap.motion.around!.tiltStdDeg!).toBeCloseTo(0, 6);
    expect(snap.orientation.around).toBeNull();
  });

  it("is null with no sensor at all, so the photo still goes ahead", () => {
    expect(
      snapshotSensors({
        motion: [],
        orientation: [],
        shutterT: 0,
        screenAngleDeg: 0,
      }),
    ).toBeNull();
  });

  it("reports a shaking phone's spread", () => {
    const motion: MotionSample[] = [];
    for (let i = 0; i < 20; i++) {
      motion.push({ t: 600 + i * 40, ...xyz(specGravity(i % 2 ? 2 : 8, 0)) });
    }
    const snap = snapshotSensors({
      motion,
      orientation: [],
      shutterT: 1000,
      screenAngleDeg: 0,
    })!;
    expect(snap.motion.around!.tiltStdDeg!).toBeGreaterThan(2);
  });

  it("the buffer keeps only its last seconds", () => {
    const buffer = new SensorBuffer(1000);
    for (let t = 0; t <= 5000; t += 100) buffer.pushMotion(still(t));
    const snap = buffer.snapshot(4000, 0)!;
    // 3000 ms and older were dropped (kept from 4000), so "before" is empty.
    expect(snap.motion.before).toBeNull();
    expect(snap.motion.after!.n).toBe(6);
  });

  it("turns raw events into samples, refusing missing axes", () => {
    expect(motionSampleOf({ x: 1, y: 2, z: 3 }, 5)).toEqual({
      t: 5,
      x: 1,
      y: 2,
      z: 3,
    });
    expect(motionSampleOf({ x: null, y: 2, z: 3 }, 5)).toBeNull();
    expect(motionSampleOf(null, 5)).toBeNull();
    expect(orientationSampleOf({ alpha: null, beta: 1, gamma: 2 }, 5)).toEqual({
      t: 5,
      beta: 1,
      gamma: 2,
      alpha: null,
    });
    expect(
      orientationSampleOf({ alpha: 1, beta: null, gamma: 2 }, 5),
    ).toBeNull();
  });
});

describe("requestSensorPermission", () => {
  it("is not-required without the iOS method, and maps the answers", async () => {
    expect(await requestSensorPermission(undefined)).toBe("not-required");
    expect(await requestSensorPermission({})).toBe("not-required");
    expect(
      await requestSensorPermission({
        requestPermission: async () => "granted",
      }),
    ).toBe("granted");
    expect(
      await requestSensorPermission({
        requestPermission: async () => "denied",
      }),
    ).toBe("denied");
    expect(
      await requestSensorPermission({
        requestPermission: async () => {
          throw new Error("not from a tap");
        },
      }),
    ).toBe("error");
  });
});
