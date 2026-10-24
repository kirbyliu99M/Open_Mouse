/**
 * V3.3 WP1a: handWorld.ts on synthetic world landmarks (模擬). The hand is the
 * repo's synthetic hand laid in a plane, in metres, then bent or rotated in 3D.
 */
import { describe, expect, it } from "vitest";
import {
  computeHandWorld,
  EMPTY_HAND_WORLD,
  fitPlane,
  type Point3,
} from "../../src/client/photo/handWorld";
import { syntheticHand } from "./helpers/synthetic-hand";
import { buildSyntheticCamera } from "./helpers/synthetic-camera";

type M = number[][];
const DEG = Math.PI / 180;

const rotX = (a: number): M => [
  [1, 0, 0],
  [0, Math.cos(a), -Math.sin(a)],
  [0, Math.sin(a), Math.cos(a)],
];
const rotY = (a: number): M => [
  [Math.cos(a), 0, Math.sin(a)],
  [0, 1, 0],
  [-Math.sin(a), 0, Math.cos(a)],
];
const rotZ = (a: number): M => [
  [Math.cos(a), -Math.sin(a), 0],
  [Math.sin(a), Math.cos(a), 0],
  [0, 0, 1],
];
const apply = (m: M | readonly (readonly number[])[], p: Point3): Point3 => ({
  x: m[0][0] * p.x + m[0][1] * p.y + m[0][2] * p.z,
  y: m[1][0] * p.x + m[1][1] * p.y + m[1][2] * p.z,
  z: m[2][0] * p.x + m[2][1] * p.y + m[2][2] * p.z,
});

/** Flat hand in the z = 0 plane, metres, wrist at the origin, fingers toward −y; |0→12| = 0.19 m. */
function flatHand(mirror = false): Point3[] {
  const u = syntheticHand({ spread: false }, { mirror });
  const k = 0.19 / Math.hypot(u[12].x - u[0].x, u[12].y - u[0].y);
  return u.map((p) => ({ x: p.x * k, y: p.y * k, z: 0 }));
}

/** Rotate `idx` about the axis through `pivot` with unit direction `axis` by `a` radians (Rodrigues). */
function rotateAbout(
  pts: Point3[],
  idx: number[],
  pivot: Point3,
  axis: [number, number, number],
  a: number,
) {
  const [kx, ky, kz] = axis;
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (const i of idx) {
    const vx = pts[i].x - pivot.x;
    const vy = pts[i].y - pivot.y;
    const vz = pts[i].z - pivot.z;
    const kv = kx * vx + ky * vy + kz * vz;
    const cx = ky * vz - kz * vy;
    const cy = kz * vx - kx * vz;
    const cz = kx * vy - ky * vx;
    pts[i] = {
      x: pivot.x + vx * c + cx * s + kx * kv * (1 - c),
      y: pivot.y + vy * c + cy * s + ky * kv * (1 - c),
      z: pivot.z + vz * c + cz * s + kz * kv * (1 - c),
    };
  }
}

/** The lateral axis of finger f (in the palm plane, perpendicular to the finger). */
function lateral(pts: Point3[], f: number): [number, number, number] {
  const m = 5 + 4 * f;
  const dx = pts[m + 1].x - pts[m].x;
  const dy = pts[m + 1].y - pts[m].y;
  const n = Math.hypot(dx, dy);
  return [-dy / n, dx / n, 0];
}

/** Bend every finger at the PIP by `deg` (flexion toward +z). */
function bendPip(pts: Point3[], deg: number) {
  for (let f = 0; f < 4; f++) {
    const m = 5 + 4 * f;
    rotateAbout(pts, [m + 2, m + 3], pts[m + 1], lateral(pts, f), deg * DEG);
  }
}

describe("computeHandWorld — synthetic (模擬)", () => {
  it("flat hand: planarity ≈ 0, flex ≈ 0, elevation ≈ 0", () => {
    const m = computeHandWorld(flatHand());
    expect(m.planarityRmsMm!).toBeLessThan(1e-6);
    for (const f of m.fingerFlexDeg!) expect(f).toBeLessThan(1e-4);
    for (const e of m.fingerElevDeg!) expect(e).toBeLessThan(1e-4);
    expect(m.palmTiltDeg).toBeNull(); // no rotation given
  });

  it("every finger bent 30° at the PIP: flex ≈ 30° each", () => {
    const pts = flatHand();
    bendPip(pts, 30);
    const m = computeHandWorld(pts);
    for (const f of m.fingerFlexDeg!)
      expect(Math.abs(f - 30)).toBeLessThan(0.01);
    expect(m.planarityRmsMm!).toBeGreaterThan(1);
  });

  it("bent 20° at the PIP and 15° at the DIP: flex ≈ 35°", () => {
    const pts = flatHand();
    bendPip(pts, 20);
    for (let f = 0; f < 4; f++) {
      const m = 5 + 4 * f;
      // Lateral axis is unchanged by a flexion about it.
      rotateAbout(pts, [m + 3], pts[m + 2], lateral(pts, f), 15 * DEG);
    }
    for (const f of computeHandWorld(pts).fingerFlexDeg!) {
      expect(Math.abs(f - 35)).toBeLessThan(0.01);
    }
  });

  it("straight fingers raised 20° at the knuckles: elevation ≈ 20°, flex ≈ 0", () => {
    const pts = flatHand();
    for (let f = 0; f < 4; f++) {
      const m = 5 + 4 * f;
      rotateAbout(
        pts,
        [m + 1, m + 2, m + 3],
        pts[m],
        lateral(pts, f),
        -20 * DEG,
      );
    }
    const r = computeHandWorld(pts);
    for (const e of r.fingerElevDeg!)
      expect(Math.abs(e - 20)).toBeLessThan(0.01);
    for (const f of r.fingerFlexDeg!) expect(f).toBeLessThan(1e-4);
  });

  it("left hand gives the same readings as the right", () => {
    const a = flatHand(false);
    const b = flatHand(true);
    bendPip(a, 25);
    bendPip(b, 25);
    const ra = computeHandWorld(a);
    const rb = computeHandWorld(b);
    for (let f = 0; f < 4; f++) {
      expect(rb.fingerFlexDeg![f]).toBeCloseTo(ra.fingerFlexDeg![f], 6);
      expect(rb.fingerElevDeg![f]).toBeCloseTo(ra.fingerElevDeg![f], 6);
    }
    expect(rb.planarityRmsMm!).toBeCloseTo(ra.planarityRmsMm!, 6);
  });

  it("flex, elevation and planarity do not depend on how the hand is rotated in 3D", () => {
    const pts = flatHand();
    bendPip(pts, 30);
    const base = computeHandWorld(pts);
    const R = [rotZ(37 * DEG), rotY(-22 * DEG), rotX(61 * DEG)].reduce(
      (acc, m) =>
        acc.map((row) =>
          [0, 1, 2].map(
            (j) => row[0] * m[0][j] + row[1] * m[1][j] + row[2] * m[2][j],
          ),
        ),
    );
    const turned = computeHandWorld(pts.map((p) => apply(R, p)));
    for (let f = 0; f < 4; f++) {
      expect(turned.fingerFlexDeg![f]).toBeCloseTo(base.fingerFlexDeg![f], 6);
      expect(turned.fingerElevDeg![f]).toBeCloseTo(base.fingerElevDeg![f], 6);
    }
    expect(turned.planarityRmsMm!).toBeCloseTo(base.planarityRmsMm!, 6);
  });

  describe("palmTiltDeg (assumes world landmarks share the camera frame — 不確定)", () => {
    // A hand lying on the sheet, in the camera frame: camera point = R · world point.
    // Sheet world frame (camera-pose.ts): Xw right, Yw up the page, Zw toward the camera.
    const handOnSheetInCamera = (
      R: readonly (readonly number[])[],
      liftDeg = 0,
    ) => {
      const pts = flatHand().map((p) => ({ x: p.x, y: -p.y, z: 0 })); // sheet → world (Yw up)
      // Lift the hand about the knuckle line (world X axis through the middle MCP).
      if (liftDeg !== 0) {
        rotateAbout(
          pts,
          [...Array(21).keys()],
          pts[9],
          [1, 0, 0],
          liftDeg * DEG,
        );
      }
      return pts.map((p) => apply(R, p));
    };

    it.each([0, 5, 10, 20])(
      "hand flat on the sheet, phone tilted %i°: tilt ≈ 0",
      (tilt) => {
        const cam = buildSyntheticCamera({
          tiltDeg: tilt,
          distanceMm: 300,
          fPx: 998,
        });
        const m = computeHandWorld(handOnSheetInCamera(cam.R), cam.R);
        expect(m.palmTiltDeg!).toBeLessThan(1e-3);
      },
    );

    it.each([5, 10, 30])(
      "palm tilted %i° off the sheet: tilt ≈ that angle",
      (lift) => {
        const cam = buildSyntheticCamera({
          tiltDeg: 8,
          distanceMm: 300,
          fPx: 998,
        });
        const m = computeHandWorld(handOnSheetInCamera(cam.R, lift), cam.R);
        expect(Math.abs(m.palmTiltDeg! - lift)).toBeLessThan(0.01);
      },
    );

    it("a malformed rotation nulls only palmTiltDeg", () => {
      const pts = flatHand();
      for (const bad of [
        [
          [1, 0],
          [0, 1],
        ],
        [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, Number.NaN],
        ],
        "R",
      ]) {
        const m = computeHandWorld(pts, bad as unknown as number[][]);
        expect(m.palmTiltDeg).toBeNull();
        expect(m.fingerFlexDeg).not.toBeNull();
      }
    });
  });
});

describe("invalid input → all null, never throws", () => {
  const good = flatHand();
  it.each([
    ["null", null],
    ["20 points", good.slice(0, 20)],
    ["a NaN z", good.map((p, i) => (i === 9 ? { ...p, z: Number.NaN } : p))],
    [
      "a missing z",
      good.map((p, i) => (i === 9 ? ({ x: p.x, y: p.y } as Point3) : p)),
    ],
    [
      "a missing point",
      good.map((p, i) => (i === 2 ? (null as unknown as Point3) : p)),
    ],
  ])("%s", (_l, pts) => {
    expect(computeHandWorld(pts as Point3[] | null)).toEqual(EMPTY_HAND_WORLD);
  });

  it("a collinear palm (degenerate plane)", () => {
    const pts = good.map((p, i) =>
      [0, 5, 9, 13, 17].includes(i) ? { x: 0, y: -i / 100, z: 0 } : p,
    );
    expect(computeHandWorld(pts)).toEqual(EMPTY_HAND_WORLD);
  });

  it("all points coincident", () => {
    const pts = good.map(() => ({ x: 0, y: 0, z: 0 }));
    expect(computeHandWorld(pts)).toEqual(EMPTY_HAND_WORLD);
  });

  it("a zero-length finger bone nulls the finger readings, keeps palmTiltDeg", () => {
    const pts = good.slice();
    pts[7] = pts[6];
    const cam = buildSyntheticCamera({ tiltDeg: 0, distanceMm: 300, fPx: 998 });
    const m = computeHandWorld(pts, cam.R);
    expect(m.fingerFlexDeg).toBeNull();
    expect(m.planarityRmsMm).toBeNull();
    expect(m.palmTiltDeg).not.toBeNull();
  });
});

describe("fitPlane", () => {
  it("recovers a tilted plane's normal", () => {
    const n = [0, Math.sin(20 * DEG), Math.cos(20 * DEG)];
    // Points in the plane spanned by (1,0,0) and (0,cos,−sin).
    const pts: Point3[] = [];
    for (const [a, b] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
      [0.3, 0.7],
    ]) {
      pts.push({ x: a, y: b * Math.cos(20 * DEG), z: -b * Math.sin(20 * DEG) });
    }
    const fit = fitPlane(pts)!;
    const d = Math.abs(
      fit.normal[0] * n[0] + fit.normal[1] * n[1] + fit.normal[2] * n[2],
    );
    expect(d).toBeCloseTo(1, 9);
  });
  it("fewer than 3 points → null", () => {
    expect(
      fitPlane([
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ]),
    ).toBeNull();
  });
});
