import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { carrySheet } from "@/client/camera/sheetCarry";
import { CAMERA_CONSTANTS } from "@/client/camera/constants";
import { NO_QUAD_DETECTION } from "@/client/camera/quad-source";
import type { SheetQuadDetection } from "@/client/paper/detect";

const found: SheetQuadDetection = {
  ...NO_QUAD_DETECTION,
  corners: [
    { x: 50, y: 150 },
    { x: 290, y: 150 },
    { x: 290, y: 490 },
    { x: 50, y: 490 },
  ],
  cornersSeen: 4,
  cornersFound: [true, true, true, true],
};
// The miss's rough quad: three corners on the sheet, the cut side off.
const cut: SheetQuadDetection = {
  ...NO_QUAD_DETECTION,
  failureStage: "aspect_mismatch",
  guessCorners: [
    { x: 20, y: 151 },
    { x: 291, y: 150 },
    { x: 289, y: 491 },
    { x: 51, y: 489 },
  ],
};
const shifted = (dx: number, dy: number): SheetQuadDetection => ({
  ...cut,
  guessCorners: cut.guessCorners!.map((p) => ({
    x: p.x + dx,
    y: p.y + dy,
  })) as unknown as SheetQuadDetection["guessCorners"],
});
const input = (over: Partial<Parameters<typeof carrySheet>[1]>) => ({
  nowMs: 1000,
  detection: cut,
  handSeen: true,
  handSteady: true,
  carryMs: 1500,
  followPx: 8,
  ...over,
});

describe("the last sheet carried through the forearm's misses (Kirby's S25 test, 2026-10-27)", () => {
  it("carries for 1.5 s (candidate)", () => {
    expect(CAMERA_CONSTANTS.autoCapture.sheetCarryMs).toBe(1500);
  });

  it("a found sheet is kept, and a cut one with the hand still takes it", () => {
    const first = carrySheet(null, input({ nowMs: 0, detection: found }));
    expect(first.carried).toBe(false);
    const next = carrySheet(first.state, input({ nowMs: 1400 }));
    expect(next.carried).toBe(true);
    // Moved by the three best-agreeing corners' mean shift (well under a pixel).
    next.detection.corners!.forEach((p, i) => {
      expect(p.x).toBeCloseTo(found.corners![i].x, 0);
      expect(p.y).toBeCloseTo(found.corners![i].y, 0);
    });
    // A carried sample does not make the sheet newer.
    expect(next.state?.atMs).toBe(0);
  });

  it("not after carryMs, not with the hand moving or gone, not at other stages", () => {
    const { state } = carrySheet(null, input({ nowMs: 0, detection: found }));
    expect(carrySheet(state, input({ nowMs: 1600 })).carried).toBe(false);
    expect(carrySheet(state, input({ handSteady: false })).carried).toBe(false);
    expect(carrySheet(state, input({ handSeen: false })).carried).toBe(false);
    expect(
      carrySheet(
        state,
        input({
          detection: { ...NO_QUAD_DETECTION, failureStage: "too_small" },
        }),
      ).carried,
    ).toBe(false);
    expect(carrySheet(null, input({})).carried).toBe(false);
  });

  it("the carried sheet follows the paper (Kirby: the outline did not keep up)", () => {
    expect(CAMERA_CONSTANTS.autoCapture.sheetCarryFollowFraction).toBe(0.01);
    const { state } = carrySheet(null, input({ nowMs: 0, detection: found }));
    const panned = carrySheet(state, input({ detection: shifted(30, -12) }));
    expect(panned.carried).toBe(true);
    expect(panned.detection.corners![0].x).toBeCloseTo(80, 0);
    expect(panned.detection.corners![2].y).toBeCloseTo(478, 0);
    // The moved sheet is kept, not its age.
    expect(panned.state?.detection.corners![0].x).toBeCloseTo(80, 0);
    expect(panned.state?.atMs).toBe(0);
    // No rough quad, or one whose corners do not agree on a shift (closer,
    // tilted): not carried.
    expect(
      carrySheet(state, input({ detection: { ...cut, guessCorners: null } }))
        .carried,
    ).toBe(false);
    const closer: SheetQuadDetection = {
      ...cut,
      guessCorners: [
        { x: 30, y: 130 },
        { x: 310, y: 130 },
        { x: 310, y: 510 },
        { x: 30, y: 510 },
      ],
    };
    expect(carrySheet(state, input({ detection: closer })).carried).toBe(false);
  });

  it("the live loop carries before the cue and the ring read the detection", () => {
    const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");
    const carryAt = source.indexOf("detection = carry.detection;");
    expect(carryAt).toBeGreaterThan(0);
    expect(source.indexOf("const sampleQuad: Quad | null")).toBeGreaterThan(
      carryAt,
    );
    expect(source).toContain("carriedSheetRef.current = null;");
    // The live detector returns a miss's rough quad for the carry to follow.
    expect(source).toContain("failureGuess: true,");
  });
});
