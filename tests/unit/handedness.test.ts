import { describe, expect, it } from "vitest";
import { normalizeHandedness } from "../../src/client/photo/landmarks";

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
