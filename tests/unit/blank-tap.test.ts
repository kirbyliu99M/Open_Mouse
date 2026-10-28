import { describe, expect, it } from "vitest";
import { isBlankTap, pointInBox } from "@/lib/blankTap";

const base = {
  onOverlay: false,
  onMarkedBlank: false,
  overlayIsPanel: false,
  insideOverlayBox: false,
};

describe("isBlankTap: a tap on the empty page closes a pop-up", () => {
  it("a tap on a full-screen overlay outside its panel is blank", () => {
    expect(isBlankTap({ ...base, onOverlay: true })).toBe(true);
  });

  it("a tap inside the panel is not", () => {
    expect(isBlankTap(base)).toBe(false);
  });

  it("an overlay drawn as the panel: its backdrop is blank, its padding is not", () => {
    const self = { ...base, onOverlay: true, overlayIsPanel: true };
    expect(isBlankTap({ ...self, insideOverlayBox: false })).toBe(true);
    expect(isBlankTap({ ...self, insideOverlayBox: true })).toBe(false);
  });

  it("an element marked data-blank-tap is blank wherever it is", () => {
    expect(isBlankTap({ ...base, onMarkedBlank: true })).toBe(true);
  });
});

describe("pointInBox", () => {
  const box = { left: 10, top: 20, right: 110, bottom: 220 };
  it("is inclusive of the edges", () => {
    expect(pointInBox(10, 20, box)).toBe(true);
    expect(pointInBox(110, 220, box)).toBe(true);
  });
  it("is false just outside", () => {
    expect(pointInBox(9, 100, box)).toBe(false);
    expect(pointInBox(50, 221, box)).toBe(false);
  });
});
