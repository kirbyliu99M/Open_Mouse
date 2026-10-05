import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HAND_CLEARANCE_M,
  handPlacement,
  placedHandBounds,
  unionBounds,
} from "../../src/lib/viewer/hand-placement";
import {
  handScale,
  scaleHand,
  type Bounds,
} from "../../src/lib/viewer/hand-scale";

/** A 64 x 125 x 40 mm shell standing on the desk, nose toward -z, centred on x = 0, z = 0. */
const SHELL: Bounds = {
  min: [-0.032, 0, -0.0625],
  max: [0.032, 0.04, 0.0625],
};

const HAND = scaleHand(handScale({ handLengthMm: 183.4, palmWidthMm: 84.7 }));

describe("handPlacement (candidate rule: palm down over the rear half, fingers to the nose)", () => {
  it("puts the middle of the palm over the middle of the shell's rear half, on its centre line", () => {
    const placement = handPlacement(SHELL, HAND, "right");
    const palmX = HAND.palmCentre[0] + placement.position[0];
    const palmZ = HAND.palmCentre[2] + placement.position[2];
    expect(palmX).toBeCloseTo(0, 12);
    // Rear half runs from z = 0 to z = 0.0625; its middle is 0.03125.
    expect(palmZ).toBeCloseTo(0.03125, 12);
  });

  it("rests the underside of the hand HAND_CLEARANCE_M above the highest point of the shell", () => {
    const placement = handPlacement(SHELL, HAND, "right");
    const placed = placedHandBounds(HAND, placement);
    expect(placed.min[1]).toBeCloseTo(SHELL.max[1] + HAND_CLEARANCE_M, 12);
    expect(placed.min[1]).toBeGreaterThan(SHELL.max[1]);
  });

  it("does not rotate the hand: the fingers still point to the nose (-z) and the thumb side is -x for a right hand", () => {
    const placement = handPlacement(SHELL, HAND, "right");
    expect(placement.mirrorX).toBe(false);
    const placed = placedHandBounds(HAND, placement);
    // Fingertips reach past the shell's nose; the wrist end is behind the palm centre.
    expect(placed.min[2]).toBeLessThan(SHELL.min[2]);
    // The thumb (template bounds reach further to -x) sticks out more on the -x side.
    expect(SHELL.min[0] - placed.min[0]).toBeGreaterThan(
      placed.max[0] - SHELL.max[0],
    );
  });

  it("mirrors a left hand: the same palm position, the thumb side flipped to +x", () => {
    const right = handPlacement(SHELL, HAND, "right");
    const left = handPlacement(SHELL, HAND, "left");
    expect(left.mirrorX).toBe(true);

    const palmX = -HAND.palmCentre[0] + left.position[0];
    expect(palmX).toBeCloseTo(0, 12);
    expect(left.position[1]).toBeCloseTo(right.position[1], 12);
    expect(left.position[2]).toBeCloseTo(right.position[2], 12);

    const placedRight = placedHandBounds(HAND, right);
    const placedLeft = placedHandBounds(HAND, left);
    expect(placedLeft.min[0]).toBeCloseTo(-placedRight.max[0], 12);
    expect(placedLeft.max[0]).toBeCloseTo(-placedRight.min[0], 12);
    expect(placedLeft.min[2]).toBeCloseTo(placedRight.min[2], 12);
    expect(placedLeft.min[1]).toBeCloseTo(placedRight.min[1], 12);
  });

  it("follows the shell wherever its bounds sit, not only when it is centred on the origin", () => {
    const moved: Bounds = {
      min: [0.1, 0.01, -0.5],
      max: [0.164, 0.05, -0.375],
    };
    const placement = handPlacement(moved, HAND, "right");
    const palmX = HAND.palmCentre[0] + placement.position[0];
    const palmZ = HAND.palmCentre[2] + placement.position[2];
    expect(palmX).toBeCloseTo(0.132, 12);
    // Centre z is -0.4375, back edge -0.375: the rear half's middle is -0.40625.
    expect(palmZ).toBeCloseTo(-0.40625, 12);
    expect(placedHandBounds(HAND, placement).min[1]).toBeCloseTo(
      0.05 + HAND_CLEARANCE_M,
      12,
    );
  });

  it("keeps the hand off the shell for every shell in the manifest and hands from 100 to 280 mm", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "public/models/manifest.json"), "utf8"),
    ) as {
      shells: { slug: string; dimensionsXYZmm: [number, number, number] }[];
    };
    expect(manifest.shells).toHaveLength(31);
    for (const { slug, dimensionsXYZmm } of manifest.shells) {
      // Blender (width, length, height) mm -> glTF bounds, centred, on the desk.
      const [w, l, h] = dimensionsXYZmm.map((v) => v / 1000) as [
        number,
        number,
        number,
      ];
      const shell: Bounds = {
        min: [-w / 2, 0, -l / 2],
        max: [w / 2, h, l / 2],
      };
      for (const length of [100, 150, 183.4, 230, 280]) {
        for (const hand of ["left", "right"] as const) {
          const scaled = scaleHand(
            handScale({ handLengthMm: length, palmWidthMm: length * 0.46 }),
          );
          const placement = handPlacement(shell, scaled, hand);
          const placed = placedHandBounds(scaled, placement);
          expect(placed.min[1], `${slug} ${hand} ${length}`).toBeGreaterThan(
            shell.max[1],
          );
          const palmZ = scaled.palmCentre[2] + placement.position[2];
          expect(palmZ, `${slug} ${length}`).toBeGreaterThan(0);
          expect(palmZ, `${slug} ${length}`).toBeLessThan(shell.max[2]);
        }
      }
    }
  });
});

describe("placedHandBounds", () => {
  it("translates unmirrored bounds and flips mirrored ones about the hand's own x = 0", () => {
    const hand = scaleHand({ along: 1, across: 1, thickness: 1 });
    const plain = placedHandBounds(hand, {
      position: [0.1, 0.2, 0.3],
      mirrorX: false,
    });
    expect(plain.min[0]).toBeCloseTo(hand.bounds.min[0] + 0.1, 12);
    expect(plain.max[2]).toBeCloseTo(hand.bounds.max[2] + 0.3, 12);

    const mirrored = placedHandBounds(hand, {
      position: [0.1, 0.2, 0.3],
      mirrorX: true,
    });
    expect(mirrored.min[0]).toBeCloseTo(-hand.bounds.max[0] + 0.1, 12);
    expect(mirrored.max[0]).toBeCloseTo(-hand.bounds.min[0] + 0.1, 12);
  });
});

describe("unionBounds", () => {
  it("is the smallest box holding both", () => {
    const union = unionBounds(
      { min: [0, 0, 0], max: [1, 1, 1] },
      { min: [-1, 0.5, 0.5], max: [0.5, 3, 0.7] },
    );
    expect(union).toEqual({ min: [-1, 0, 0], max: [1, 3, 1] });
  });
});
