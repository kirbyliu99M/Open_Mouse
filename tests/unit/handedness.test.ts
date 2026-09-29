import { describe, expect, it } from "vitest";
import { normalizeHandedness } from "../../src/client/photo/landmarks";
import { submittedHand } from "../../src/client/photo/submission";
import { checkHandedness } from "../../src/client/photo/gates";

describe("normalizeHandedness", () => {
  // Palm-down, rear-camera photos: MediaPipe's raw label is already the hand
  // in the photo (the back-of-hand view and the unmirrored image cancel).
  // Measured 2026-09-29 on four photos and in Kirby's field test.
  it.each([
    ["Right", "right"],
    ["Left", "left"],
    [" right ", "right"],
    ["LEFT", "left"],
  ] as const)("keeps MediaPipe's %j as %j (no swap)", (raw, expected) => {
    expect(normalizeHandedness(raw)).toBe(expected);
  });

  it.each(["", "Unknown", "ambidextrous"])("returns null for %j", (raw) => {
    expect(normalizeHandedness(raw)).toBeNull();
  });
});

describe("submittedHand", () => {
  it("uses the detected hand while the chip is on auto", () => {
    expect(submittedHand({ hand: "right", handIsAuto: true }, "left")).toBe(
      "left",
    );
  });

  it("keeps the default when auto found no hand", () => {
    expect(submittedHand({ hand: "right", handIsAuto: true }, null)).toBe(
      "right",
    );
  });

  it("never overrides a hand the user chose", () => {
    expect(submittedHand({ hand: "right", handIsAuto: false }, "left")).toBe(
      "right",
    );
    expect(submittedHand({ hand: "left" }, "right")).toBe("left");
  });
});

describe("handedness gate with an auto hand", () => {
  it("has nothing to contradict when no hand was stated", () => {
    expect(checkHandedness("left", undefined)).toBeNull();
  });

  it("still stops a photo that contradicts a chosen hand", () => {
    expect(checkHandedness("left", "right")?.code).toBe("HANDEDNESS_MISMATCH");
  });
});
