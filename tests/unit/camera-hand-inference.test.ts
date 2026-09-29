import { describe, expect, it } from "vitest";
import {
  INITIAL_HAND_CHIP_STATE,
  applyDetectedHandedness,
  canToggleHandChip,
  handChipLabel,
  toggleHandChip,
  type HandChipState,
} from "../../src/client/camera/handInference";
import { resolvePipelineHand } from "../../src/client/photo/hand";
import { runPaperEdgeHandGates } from "../../src/client/photo/gates";

describe("easy-scan hand chip state", () => {
  it("uses a detected left hand for an untouched right-hand default", () => {
    expect(
      resolvePipelineHand({
        selected: "right",
        detected: "left",
        explicit: false,
      }),
    ).toEqual({ stated: undefined, submitted: "left" });
  });

  it("keeps an explicit right-hand choice when the photo detects left", () => {
    expect(
      resolvePipelineHand({
        selected: "right",
        detected: "left",
        explicit: true,
      }),
    ).toEqual({ stated: "right", submitted: "right" });
  });
  it("does not report a mismatch for an untouched chip and a detected left hand", () => {
    const chip = INITIAL_HAND_CHIP_STATE;
    const resolved = resolvePipelineHand({
      selected: chip.hand,
      detected: "left",
      explicit: chip.locked,
    });
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
    const resolved = resolvePipelineHand({
      selected: chip.hand,
      detected: null,
      explicit: chip.locked,
    });
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
    expect(
      report.errors.filter((error) => error.code === "LOW_LANDMARK_CONFIDENCE"),
    ).toHaveLength(1);
  });
  it("uses the supplied fix instruction for a paper-edge mismatch", () => {
    const chip = toggleHandChip(INITIAL_HAND_CHIP_STATE);
    const resolved = resolvePipelineHand({
      selected: chip.hand,
      detected: "right",
      explicit: chip.locked,
    });
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

  it("labels an untouched chip 'auto' and a tapped chip without it", () => {
    expect(handChipLabel(INITIAL_HAND_CHIP_STATE)).toBe("Right hand · auto");
    expect(handChipLabel({ hand: "left", locked: false })).toBe(
      "Left hand · auto",
    );
    const tapped = toggleHandChip(INITIAL_HAND_CHIP_STATE);
    expect(handChipLabel(tapped)).toBe("Left hand");
    // Tapping back to the default hand is still the user's choice, not 'auto'.
    expect(handChipLabel(toggleHandChip(tapped))).toBe("Right hand");
  });

  it("never says 'auto' once a detection is folded into a locked chip", () => {
    const locked = toggleHandChip(INITIAL_HAND_CHIP_STATE);
    const after = applyDetectedHandedness(locked, "right");
    expect(handChipLabel(after)).not.toContain("auto");
  });

  it("does not let the chip change while a photo is being processed", () => {
    expect(canToggleHandChip("processing")).toBe(false);
    for (const kind of ["none", "measured", "gateFailure"]) {
      expect(canToggleHandChip(kind)).toBe(true);
    }
  });
});
