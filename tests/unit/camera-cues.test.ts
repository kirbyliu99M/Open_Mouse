import { describe, expect, it } from "vitest";
import { pickCue, computeStatusChips, type CueInput } from "../../src/client/camera/cues";
import type { Quad } from "../../src/client/camera/quad";

const GOOD_QUAD: Quad = {
  topLeft: { x: 100, y: 100 },
  topRight: { x: 500, y: 100 },
  bottomRight: { x: 500, y: 500 },
  bottomLeft: { x: 100, y: 500 },
};

function baseInput(overrides: Partial<CueInput> = {}): CueInput {
  return {
    markerCount: 4,
    quad: GOOD_QUAD,
    frameWidth: 640,
    meanLuma: 120,
    clippedFraction: 0,
    steady: true,
    sharpEnough: true,
    ...overrides,
  };
}

describe("pickCue — priority order", () => {
  it("1: no markers", () => {
    expect(pickCue(baseInput({ markerCount: 0, quad: null })).code).toBe(
      "no-markers",
    );
  });

  it("2: 1-3 markers", () => {
    expect(pickCue(baseInput({ markerCount: 1, quad: null })).code).toBe(
      "some-markers",
    );
    expect(pickCue(baseInput({ markerCount: 3, quad: null })).code).toBe(
      "some-markers",
    );
  });

  it("2b: 4 markers reported but no quad yet also reads as some-markers", () => {
    expect(pickCue(baseInput({ markerCount: 4, quad: null })).code).toBe(
      "some-markers",
    );
  });

  it("3: skewed quad, even with everything else perfect", () => {
    const skewed: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 400, y: 0 },
      bottomRight: { x: 200, y: 400 },
      bottomLeft: { x: 0, y: 400 },
    };
    expect(pickCue(baseInput({ quad: skewed, frameWidth: 640 })).code).toBe(
      "tilted",
    );
  });

  it("4a: quad too small in frame -> too-far ('Move closer')", () => {
    const small: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 100, y: 100 },
      bottomLeft: { x: 0, y: 100 },
    };
    expect(pickCue(baseInput({ quad: small, frameWidth: 640 })).code).toBe(
      "too-far",
    );
  });

  it("4b: quad too large in frame -> too-close ('Move back a little')", () => {
    const big: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 630, y: 0 },
      bottomRight: { x: 630, y: 630 },
      bottomLeft: { x: 0, y: 630 },
    };
    expect(pickCue(baseInput({ quad: big, frameWidth: 640 })).code).toBe(
      "too-close",
    );
  });

  it("5a: too dark", () => {
    expect(pickCue(baseInput({ meanLuma: 40 })).code).toBe("dark");
  });

  it("5b: too bright / clipped", () => {
    expect(pickCue(baseInput({ clippedFraction: 0.2 })).code).toBe("bright");
  });

  it("6: not steady", () => {
    expect(pickCue(baseInput({ steady: false })).code).toBe("hold-still");
  });

  it("6b: not sharp enough", () => {
    expect(pickCue(baseInput({ sharpEnough: false })).code).toBe(
      "hold-still",
    );
  });

  it("7: everything passes -> perfect, and only perfect sets allPass", () => {
    const result = pickCue(baseInput());
    expect(result.code).toBe("perfect");
    expect(result.allPass).toBe(true);
    expect(pickCue(baseInput({ steady: false })).allPass).toBe(false);
  });

  it("checks run in the documented order — e.g. dark AND unsteady reports dark first", () => {
    expect(pickCue(baseInput({ meanLuma: 40, steady: false })).code).toBe(
      "dark",
    );
  });
});

describe("computeStatusChips", () => {
  it("all three chips pass when everything is good", () => {
    const chips = computeStatusChips(baseInput());
    expect(chips.sheet).toEqual({ label: "Sheet 4/4", pass: true });
    expect(chips.steady).toEqual({ label: "Steady", pass: true });
    expect(chips.light).toEqual({ label: "Light", pass: true });
  });

  it("sheet chip reflects a partial marker count and fails", () => {
    const chips = computeStatusChips(baseInput({ markerCount: 2, quad: null }));
    expect(chips.sheet).toEqual({ label: "Sheet 2/4", pass: false });
  });

  it("steady chip fails on either unsteady or not-sharp-enough", () => {
    expect(computeStatusChips(baseInput({ steady: false })).steady.pass).toBe(
      false,
    );
    expect(
      computeStatusChips(baseInput({ sharpEnough: false })).steady.pass,
    ).toBe(false);
  });

  it("light chip fails when dark or bright", () => {
    expect(computeStatusChips(baseInput({ meanLuma: 10 })).light.pass).toBe(
      false,
    );
    expect(
      computeStatusChips(baseInput({ clippedFraction: 0.5 })).light.pass,
    ).toBe(false);
  });
});
