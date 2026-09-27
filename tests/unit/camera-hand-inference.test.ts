import { describe, expect, it } from "vitest";
import {
  INITIAL_HAND_CHIP_STATE,
  applyDetectedHandedness,
  toggleHandChip,
  type HandChipState,
} from "../../src/client/camera/handInference";
import { resolvePipelineHand } from "../../src/client/photo/pipeline";

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
