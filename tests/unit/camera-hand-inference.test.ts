import { describe, expect, it } from "vitest";
import {
  INITIAL_HAND_CHIP_STATE,
  applyDetectedHandedness,
  toggleHandChip,
  type HandChipState,
} from "../../src/client/camera/handInference";
import { resolvePipelineHand } from "../../src/client/photo/pipeline";
import { runPaperEdgeHandGates } from "../../src/client/photo/gates";

describe("easy-scan hand chip state", () => {
  it("uses a detected left hand for an untouched right-hand default", () => {
    expect(resolvePipelineHand("right", "left", false)).toEqual({
      stated: undefined,
      submission: "left",
    });
  });

  it("keeps an explicit right-hand choice when the photo detects left", () => {
    expect(resolvePipelineHand("right", "left", true)).toEqual({
      stated: "right",
      submission: "right",
    });
  });
  it("does not report a mismatch for an untouched chip and a detected left hand", () => {
    const chip = INITIAL_HAND_CHIP_STATE;
    const resolved = resolvePipelineHand(chip.hand, "left", chip.locked);
    const report = runPaperEdgeHandGates({
      paperFound: false,
      landmarkCount: 21,
      handedness: "left",
      handStated: resolved.stated,
      landmarkConfidence: 1,
      landmarksMm: [],
      paperCornersMm: [],
      laplacianVariance: 100,
    });
    expect(report.errors.map((error) => error.code)).not.toContain(
      "HANDEDNESS_MISMATCH",
    );
  });
  it("blocks an untouched chip when handedness detection is null", () => {
    const chip = INITIAL_HAND_CHIP_STATE;
    const resolved = resolvePipelineHand(chip.hand, null, chip.locked);
    const report = runPaperEdgeHandGates({
      paperFound: false,
      landmarkCount: 21,
      handedness: null,
      handStated: resolved.stated,
      landmarkConfidence: 1,
      landmarksMm: [],
      paperCornersMm: [],
      laplacianVariance: 100,
    });
    expect(report.errors.map((error) => error.code)).toContain(
      "LOW_LANDMARK_CONFIDENCE",
    );
  });
  it("shows the below-sheet hand instruction for a paper-edge mismatch", () => {
    const chip = toggleHandChip(INITIAL_HAND_CHIP_STATE);
    const resolved = resolvePipelineHand(chip.hand, "right", chip.locked);
    const report = runPaperEdgeHandGates({
      paperFound: false,
      landmarkCount: 21,
      handedness: "right",
      handStated: resolved.stated,
      handednessFixInstruction: "tap the hand button below",
      landmarkConfidence: 1,
      landmarksMm: [],
      paperCornersMm: [],
      laplacianVariance: 100,
    });
    expect(
      report.errors.find((error) => error.code === "HANDEDNESS_MISMATCH")
        ?.message,
    ).toContain("tap the hand button below");
  });
  it("defaults to right hand, unlocked", () => {
    expect(INITIAL_HAND_CHIP_STATE).toEqual({ hand: "right", locked: false });
  });

  it("toggling flips the hand and locks it", () => {
    const next = toggleHandChip(INITIAL_HAND_CHIP_STATE);
    expect(next).toEqual({ hand: "left", locked: true });
    expect(toggleHandChip(next)).toEqual({ hand: "right", locked: true });
  });

  it("an unlocked chip picks up a detected hand that differs", () => {
    const next = applyDetectedHandedness(INITIAL_HAND_CHIP_STATE, "left");
    expect(next).toEqual({ hand: "left", locked: false });
  });

  it("is a no-op when the detected hand already matches", () => {
    const next = applyDetectedHandedness(INITIAL_HAND_CHIP_STATE, "right");
    expect(next).toBe(INITIAL_HAND_CHIP_STATE);
  });

  it("is a no-op when nothing was detected", () => {
    expect(applyDetectedHandedness(INITIAL_HAND_CHIP_STATE, null)).toBe(
      INITIAL_HAND_CHIP_STATE,
    );
    expect(applyDetectedHandedness(INITIAL_HAND_CHIP_STATE, undefined)).toBe(
      INITIAL_HAND_CHIP_STATE,
    );
  });

  it("never overwrites a locked (manually chosen) hand", () => {
    const locked: HandChipState = { hand: "right", locked: true };
    expect(applyDetectedHandedness(locked, "left")).toBe(locked);
  });
});
