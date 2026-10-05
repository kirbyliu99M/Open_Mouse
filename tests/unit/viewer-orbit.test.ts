import { describe, expect, it } from "vitest";
import {
  ELEVATION_MAX,
  ELEVATION_MIN,
  KEY_STEP,
  MOMENTUM_DECAY,
  MOMENTUM_STOP_SPEED,
  RADIANS_PER_PIXEL,
  VELOCITY_WINDOW_MS,
  boundingRadius,
  cameraPosition,
  clampElevation,
  coastStep,
  defaultAngles,
  dragAngles,
  fitDistance,
  keyAngles,
  projectedAngles,
  releaseVelocity,
  type OrbitAngles,
  type OrbitVelocity,
} from "../../src/lib/viewer/orbit";

const START: OrbitAngles = { azimuth: 0.2, elevation: 0.5 };

describe("dragAngles: the model follows the pointer", () => {
  it("turns the camera the other way when the pointer moves right, and lifts it when the pointer moves down", () => {
    const next = dragAngles(START, 100, 40);
    expect(next.azimuth).toBeCloseTo(
      START.azimuth - 100 * RADIANS_PER_PIXEL,
      12,
    );
    expect(next.elevation).toBeCloseTo(
      START.elevation + 40 * RADIANS_PER_PIXEL,
      12,
    );
  });

  it("is linear: two half drags equal one whole drag", () => {
    const once = dragAngles(START, 80, 30);
    const twice = dragAngles(dragAngles(START, 40, 15), 40, 15);
    expect(twice.azimuth).toBeCloseTo(once.azimuth, 12);
    expect(twice.elevation).toBeCloseTo(once.elevation, 12);
  });

  it("clamps the elevation: never below the desk, never straight down", () => {
    expect(dragAngles(START, 0, -10000).elevation).toBe(ELEVATION_MIN);
    expect(dragAngles(START, 0, 10000).elevation).toBe(ELEVATION_MAX);
  });

  it("ignores vertical movement for a touch drag (horizontalOnly), so the page can scroll", () => {
    const next = dragAngles(START, 50, 500, true);
    expect(next.elevation).toBe(START.elevation);
    expect(next.azimuth).toBeCloseTo(
      START.azimuth - 50 * RADIANS_PER_PIXEL,
      12,
    );
  });
});

describe("keyAngles", () => {
  it("turns by one step per arrow, left and right opposite", () => {
    expect(keyAngles(START, "ArrowLeft")!.azimuth).toBeCloseTo(
      START.azimuth + KEY_STEP,
      12,
    );
    expect(keyAngles(START, "ArrowRight")!.azimuth).toBeCloseTo(
      START.azimuth - KEY_STEP,
      12,
    );
  });

  it("tilts with up and down, within the limits", () => {
    expect(keyAngles(START, "ArrowUp")!.elevation).toBeCloseTo(
      START.elevation - KEY_STEP,
      12,
    );
    expect(keyAngles(START, "ArrowDown")!.elevation).toBeCloseTo(
      START.elevation + KEY_STEP,
      12,
    );
    let angles = START;
    for (let i = 0; i < 100; i += 1) angles = keyAngles(angles, "ArrowDown")!;
    expect(angles.elevation).toBe(ELEVATION_MAX);
    for (let i = 0; i < 100; i += 1) angles = keyAngles(angles, "ArrowUp")!;
    expect(angles.elevation).toBe(ELEVATION_MIN);
  });

  it("returns null for every other key, so Tab and the rest keep their meaning", () => {
    for (const key of [
      "Tab",
      "Enter",
      " ",
      "a",
      "Escape",
      "PageDown",
      "Home",
    ]) {
      expect(keyAngles(START, key)).toBeNull();
    }
  });
});

describe("releaseVelocity", () => {
  it("is zero for a pointer that stopped before it was released", () => {
    const samples = [{ t: 1000, dxPx: 30, dyPx: 10 }];
    expect(releaseVelocity(samples, 1000 + VELOCITY_WINDOW_MS + 1)).toEqual({
      azimuth: 0,
      elevation: 0,
    });
    expect(releaseVelocity([], 5)).toEqual({ azimuth: 0, elevation: 0 });
  });

  it("is the angular speed of the recent moves, signed like a drag", () => {
    // 60 px right over 60 ms: 1 px/ms.
    const samples = [
      { t: 1000, dxPx: 20, dyPx: 0 },
      { t: 1020, dxPx: 20, dyPx: 0 },
      { t: 1040, dxPx: 20, dyPx: 0 },
    ];
    const v = releaseVelocity(samples, 1060);
    expect(v.azimuth).toBeCloseTo((-60 * RADIANS_PER_PIXEL * 1000) / 60, 9);
    expect(v.elevation).toBeCloseTo(0, 12);
  });

  it("drops the vertical component for a touch drag", () => {
    const samples = [{ t: 1000, dxPx: 10, dyPx: 90 }];
    expect(releaseVelocity(samples, 1020, true).elevation).toBe(0);
    expect(releaseVelocity(samples, 1020, false).elevation).not.toBe(0);
  });
});

describe("momentum: the guideline's projection and the coast agree", () => {
  const velocity: OrbitVelocity = { azimuth: 3, elevation: 0 };

  it("projects current + (v / 1000) * d / (1 - d) with d = 0.998", () => {
    const projected = projectedAngles(START, velocity);
    expect(projected.azimuth).toBeCloseTo(
      START.azimuth + (3 / 1000) * (0.998 / (1 - 0.998)),
      12,
    );
    expect(MOMENTUM_DECAY).toBe(0.998);
  });

  it("a coast run to its end lands where the projection said (to a hundredth of a degree)", () => {
    let angles = START;
    let v = velocity;
    for (let frame = 0; frame < 20000; frame += 1) {
      const step = coastStep(angles, v, 16.7);
      angles = step.angles;
      v = step.velocity;
      if (!step.moving) break;
    }
    const projected = projectedAngles(START, velocity);
    expect(Math.abs(angles.azimuth - projected.azimuth)).toBeLessThan(
      (0.01 * Math.PI) / 180 + (MOMENTUM_STOP_SPEED * 1.2) / 1000 / (1 - 0.998),
    );
  });

  it("is independent of the frame rate", () => {
    const run = (dt: number) => {
      let angles = START;
      let v = velocity;
      for (let t = 0; t < 960; t += dt) {
        const step = coastStep(angles, v, dt);
        angles = step.angles;
        v = step.velocity;
      }
      return angles.azimuth;
    };
    expect(run(8)).toBeCloseTo(run(16), 6);
    expect(run(16)).toBeCloseTo(run(40), 6);
  });

  it("stops: speed decays, and the coast reports it has ended", () => {
    const slow = coastStep(
      START,
      { azimuth: MOMENTUM_STOP_SPEED, elevation: 0 },
      16,
    );
    expect(slow.moving).toBe(false);
    const fast = coastStep(START, { azimuth: 3, elevation: 0 }, 16);
    expect(fast.moving).toBe(true);
    expect(Math.abs(fast.velocity.azimuth)).toBeLessThan(3);
  });

  it("pins against the elevation limit and drops that axis's speed", () => {
    const step = coastStep(
      { azimuth: 0, elevation: ELEVATION_MAX - 0.001 },
      { azimuth: 0, elevation: 5 },
      100,
    );
    expect(step.angles.elevation).toBe(ELEVATION_MAX);
    expect(step.velocity.elevation).toBe(0);
  });
});

describe("cameraPosition", () => {
  it("looks from the rear (+z) at azimuth 0, from +x at a quarter turn, from above at the top", () => {
    const [x, y, z] = cameraPosition([0, 0, 0], 2, {
      azimuth: 0,
      elevation: 0,
    });
    expect([x, y, z]).toEqual([0, 0, 2]);
    const side = cameraPosition([0, 0, 0], 2, {
      azimuth: Math.PI / 2,
      elevation: 0,
    });
    expect(side[0]).toBeCloseTo(2, 12);
    expect(side[2]).toBeCloseTo(0, 12);
    const top = cameraPosition([0, 0, 0], 2, {
      azimuth: 1,
      elevation: Math.PI / 2,
    });
    expect(top[1]).toBeCloseTo(2, 12);
    expect(top[0]).toBeCloseTo(0, 12);
  });

  it("is always exactly `distance` from the target", () => {
    const target = [0.1, 0.02, -0.05] as const;
    for (const azimuth of [-3, -1, 0, 0.7, 2.5]) {
      for (const elevation of [ELEVATION_MIN, 0.5, ELEVATION_MAX]) {
        const p = cameraPosition(target, 0.6, { azimuth, elevation });
        expect(
          Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]),
        ).toBeCloseTo(0.6, 12);
      }
    }
  });
});

describe("fitDistance", () => {
  it("fits a sphere in the narrower field of view", () => {
    const radius = 0.12;
    const wide = fitDistance(radius, 32, 1.5, 1);
    // Vertical field decides: sin(16 deg) = radius / distance.
    expect(radius / wide).toBeCloseTo(Math.sin((16 * Math.PI) / 180), 9);

    const tall = fitDistance(radius, 32, 0.5, 1);
    const horizontal = 2 * Math.atan(Math.tan((16 * Math.PI) / 180) * 0.5);
    expect(radius / tall).toBeCloseTo(Math.sin(horizontal / 2), 9);
    expect(tall).toBeGreaterThan(wide);
  });

  it("leaves the margin it is asked for", () => {
    expect(fitDistance(0.1, 30, 1.4, 1.2)).toBeCloseTo(
      fitDistance(0.1, 30, 1.4, 1) * 1.2,
      12,
    );
  });
});

describe("boundingRadius, clampElevation, defaultAngles", () => {
  it("takes half the box's diagonal", () => {
    expect(boundingRadius([0, 0, 0], [0.3, 0.4, 0])).toBeCloseTo(0.25, 12);
  });

  it("clamps the elevation", () => {
    expect(clampElevation(-1)).toBe(ELEVATION_MIN);
    expect(clampElevation(3)).toBe(ELEVATION_MAX);
    expect(clampElevation(0.6)).toBe(0.6);
  });

  it("opens from the thumb side, mirrored for the other hand, a little above", () => {
    const right = defaultAngles("right");
    const left = defaultAngles("left");
    expect(right.azimuth).toBeLessThan(0); // camera on the -x side, where a right thumb is
    expect(left.azimuth).toBeCloseTo(-right.azimuth, 12);
    expect(right.elevation).toBeGreaterThan(ELEVATION_MIN);
    expect(right.elevation).toBeLessThan(ELEVATION_MAX);
  });
});
