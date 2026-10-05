import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TEMPLATE_BOUNDS_GLTF_M,
  TEMPLATE_HAND_LENGTH_MM,
  TEMPLATE_LANDMARKS_M,
  TEMPLATE_PALM_WIDTH_MM,
  handScale,
  scaleAsVector,
  scaleHand,
  type HandScale,
  type Vec3,
} from "../../src/lib/viewer/hand-scale";
import { handMeasurementsSchema } from "../../src/lib/contracts/measurement";

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(root, "public/models/manifest.json"), "utf8"),
) as { hand: { landmarksMetres: number[][] } };

/** The JSON chunk of a .glb file. */
function glbJson(path: string) {
  const bytes = readFileSync(join(root, path));
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")) as {
    accessors: {
      type: string;
      count: number;
      min?: number[];
      max?: number[];
    }[];
    meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  };
}

/** The template's landmark `index` after `scale`, in the authoring frame (x across, y along). */
function scaledLandmark(scale: HandScale, index: number): [number, number] {
  const p = TEMPLATE_LANDMARKS_M[index]!;
  return [p[0] * scale.across, p[1] * scale.along];
}
const mmBetween = (a: [number, number], b: [number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]) * 1000;

describe("the template hand's own numbers", () => {
  it("TEMPLATE_LANDMARKS_M equals manifest.json hand.landmarksMetres (no drift from the file Codex owns)", () => {
    expect(manifest.hand.landmarksMetres).toHaveLength(21);
    manifest.hand.landmarksMetres.forEach((point, index) => {
      point.forEach((value, axis) => {
        expect(TEMPLATE_LANDMARKS_M[index]![axis]).toBeCloseTo(value, 7);
      });
    });
  });

  it("TEMPLATE_BOUNDS_GLTF_M equals the POSITION accessor bounds of hand.glb", () => {
    const glb = glbJson("public/models/hand.glb");
    const position =
      glb.accessors[glb.meshes[0]!.primitives[0]!.attributes.POSITION]!;
    position.min!.forEach((value, axis) => {
      expect(TEMPLATE_BOUNDS_GLTF_M.min[axis]).toBeCloseTo(value, 7);
    });
    position.max!.forEach((value, axis) => {
      expect(TEMPLATE_BOUNDS_GLTF_M.max[axis]).toBeCloseTo(value, 7);
    });
  });

  it("measures the way the measurement contract defines it: 0 to 12 for the length, 5 to 17 for the palm width", () => {
    expect(TEMPLATE_HAND_LENGTH_MM).toBeCloseTo(176.1, 1);
    expect(TEMPLATE_PALM_WIDTH_MM).toBeCloseTo(57.4, 1);
  });

  it("is a right hand: the thumb tip is on the -x side of the little finger (palm down, fingers up the screen)", () => {
    expect(TEMPLATE_LANDMARKS_M[4]![0]).toBeLessThan(
      TEMPLATE_LANDMARKS_M[20]![0],
    );
  });
});

describe("handScale", () => {
  it("is 1 on every axis for the template's own lengths", () => {
    const scale = handScale({
      handLengthMm: TEMPLATE_HAND_LENGTH_MM,
      palmWidthMm: TEMPLATE_PALM_WIDTH_MM,
    });
    expect(scale.along).toBeCloseTo(1, 9);
    expect(scale.across).toBeCloseTo(1, 9);
    expect(scale.thickness).toBeCloseTo(1, 9);
  });

  it.each([
    [150, 70],
    [160, 75],
    [172.4, 81.3],
    [183.4, 84.7],
    [190, 90],
    [200, 95],
    [215.5, 101],
    [100, 50],
    [280, 150],
    [100, 150],
    [280, 50],
  ])(
    "makes the scaled template's wrist-to-middle-fingertip %s mm and palm width %s mm",
    (handLengthMm, palmWidthMm) => {
      const scale = handScale({ handLengthMm, palmWidthMm });
      expect(
        mmBetween(scaledLandmark(scale, 0), scaledLandmark(scale, 12)),
      ).toBeCloseTo(handLengthMm, 6);
      expect(
        mmBetween(scaledLandmark(scale, 5), scaledLandmark(scale, 17)),
      ).toBeCloseTo(palmWidthMm, 6);
    },
  );

  it("is exact to 0.05 mm over the whole measurement ranges the contract accepts, at 0.1 mm steps", () => {
    let worst = 0;
    for (let length = 100; length <= 280; length += 7.3) {
      for (let width = 50; width <= 150; width += 6.1) {
        const scale = handScale({
          handLengthMm: length,
          palmWidthMm: width,
        });
        worst = Math.max(
          worst,
          Math.abs(
            mmBetween(scaledLandmark(scale, 0), scaledLandmark(scale, 12)) -
              length,
          ),
          Math.abs(
            mmBetween(scaledLandmark(scale, 5), scaledLandmark(scale, 17)) -
              width,
          ),
        );
      }
    }
    expect(worst).toBeLessThan(0.05);
  });

  it("scales the length axis with the hand length and the width axis with the palm width, independently", () => {
    const base = handScale({ handLengthMm: 180, palmWidthMm: 80 });
    const longer = handScale({ handLengthMm: 198, palmWidthMm: 80 });
    const wider = handScale({ handLengthMm: 180, palmWidthMm: 88 });
    expect(longer.along / base.along).toBeCloseTo(1.1, 2);
    expect(longer.across).toBeCloseTo(base.across, 2);
    expect(wider.across / base.across).toBeCloseTo(1.1, 2);
    expect(wider.along).toBeCloseTo(base.along, 2);
  });

  it("scales the thickness by the geometric mean of the other two, and never reads palmThicknessMm", () => {
    const scale = handScale({ handLengthMm: 200, palmWidthMm: 90 });
    expect(scale.thickness).toBeCloseTo(
      Math.sqrt(scale.along * scale.across),
      12,
    );
    const withThickness = handScale({
      handLengthMm: 200,
      palmWidthMm: 90,
      palmThicknessMm: 70,
    } as { handLengthMm: number; palmWidthMm: number });
    expect(withThickness).toEqual(scale);
  });

  it("returns positive finite scales for every measurement the contract accepts", () => {
    for (let length = 100; length <= 280; length += 20) {
      for (let width = 50; width <= 150; width += 20) {
        const measurements = {
          handLengthMm: length,
          palmLengthMm: 60,
          palmWidthMm: width,
        };
        expect(handMeasurementsSchema.safeParse(measurements).success).toBe(
          true,
        );
        const scale = handScale(measurements);
        for (const value of [scale.along, scale.across, scale.thickness]) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThan(0);
        }
      }
    }
  });

  it("falls back to the plain per-axis ratios for a template the exact solution does not suit", () => {
    // A template whose length and width vectors are parallel makes the two
    // equations the same equation: no unique solution.
    const parallel: Vec3[] = TEMPLATE_LANDMARKS_M.map(() => [0, 0, 0] as Vec3);
    parallel[0] = [0, 0, 0];
    parallel[12] = [0, 0.2, 0];
    parallel[5] = [0, 0, 0];
    parallel[17] = [0, 0.1, 0];
    const scale = handScale({ handLengthMm: 180, palmWidthMm: 90 }, parallel);
    expect(Number.isFinite(scale.along)).toBe(true);
    expect(Number.isFinite(scale.across)).toBe(true);
    expect(scale.along).toBeCloseTo(0.18 / 0.2, 9);
    expect(scale.across).toBeCloseTo(0.09 / 0.1, 9);
  });

  it("maps to the root object's (x, y, z) as (across, thickness, along)", () => {
    const scale = handScale({ handLengthMm: 200, palmWidthMm: 90 });
    expect(scaleAsVector(scale)).toEqual([
      scale.across,
      scale.thickness,
      scale.along,
    ]);
  });
});

describe("scaleHand", () => {
  it("returns the template's own bounds and palm centre at scale 1", () => {
    const hand = scaleHand({ along: 1, across: 1, thickness: 1 });
    expect(hand.bounds).toEqual(TEMPLATE_BOUNDS_GLTF_M);
    // centroid of landmarks 0, 5, 9, 13, 17 in the authoring frame: x 3 mm,
    // y 60.2 mm along the hand, which is glTF z = -0.0602.
    expect(hand.palmCentre[0]).toBeCloseTo(0.003, 9);
    expect(hand.palmCentre[1]).toBe(0);
    expect(hand.palmCentre[2]).toBeCloseTo(-0.0602, 9);
  });

  it("scales bounds and palm centre axis by axis", () => {
    const hand = scaleHand({ along: 1.2, across: 0.9, thickness: 1.5 });
    expect(hand.bounds.max[0]).toBeCloseTo(
      TEMPLATE_BOUNDS_GLTF_M.max[0] * 0.9,
      12,
    );
    expect(hand.bounds.min[1]).toBeCloseTo(
      TEMPLATE_BOUNDS_GLTF_M.min[1] * 1.5,
      12,
    );
    expect(hand.bounds.min[2]).toBeCloseTo(
      TEMPLATE_BOUNDS_GLTF_M.min[2] * 1.2,
      12,
    );
    expect(hand.palmCentre[0]).toBeCloseTo(0.003 * 0.9, 12);
    expect(hand.palmCentre[2]).toBeCloseTo(-0.0602 * 1.2, 12);
  });

  it("puts the palm centre inside the palm: between the wrist and the knuckles, over the middle of the bounds across", () => {
    const hand = scaleHand(
      handScale({ handLengthMm: 183.4, palmWidthMm: 84.7 }),
    );
    expect(hand.palmCentre[2]).toBeLessThan(0); // toward the fingers
    expect(hand.palmCentre[2]).toBeGreaterThan(hand.bounds.min[2]);
    expect(hand.palmCentre[0]).toBeGreaterThan(hand.bounds.min[0]);
    expect(hand.palmCentre[0]).toBeLessThan(hand.bounds.max[0]);
  });
});
