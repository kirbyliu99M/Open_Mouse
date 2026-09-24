import { describe, expect, it } from "vitest";
import {
  pickCue,
  computeStatusChips,
  type CueInput,
} from "../../src/client/camera/cues";
import type { Quad } from "../../src/client/camera/quad";

const GOOD_QUAD: Quad = {
  topLeft: { x: 100, y: 100 },
  topRight: { x: 500, y: 100 },
  bottomRight: { x: 500, y: 500 },
  bottomLeft: { x: 100, y: 500 },
};

function baseInput(overrides: Partial<CueInput> = {}): CueInput {
  return {
    cornersSeen: 4,
    quad: GOOD_QUAD,
    frameWidth: 640,
    meanLuma: 120,
    clippedFraction: 0,
    steady: true,
    sharpEnough: true,
    msSinceLastDetection: 0,
    ...overrides,
  };
}

describe("pickCue — priority order", () => {
  it("1a: no corners, within the place-paper timeout", () => {
    expect(
      pickCue(
        baseInput({ cornersSeen: 0, quad: null, msSinceLastDetection: 500 }),
      ).code,
    ).toBe("no-corners");
  });

  it("1b: no corners for longer than the timeout escalates to place-paper", () => {
    expect(
      pickCue(
        baseInput({ cornersSeen: 0, quad: null, msSinceLastDetection: 2001 }),
      ).code,
    ).toBe("place-paper");
  });

  it("1c: exactly at the timeout boundary still reads as no-corners", () => {
    expect(
      pickCue(
        baseInput({ cornersSeen: 0, quad: null, msSinceLastDetection: 2000 }),
      ).code,
    ).toBe("no-corners");
  });

  it("2: 1-3 corners", () => {
    expect(pickCue(baseInput({ cornersSeen: 1, quad: null })).code).toBe(
      "some-corners",
    );
    expect(pickCue(baseInput({ cornersSeen: 3, quad: null })).code).toBe(
      "some-corners",
    );
  });

  it("2b: 4 corners reported but no quad yet also reads as some-corners", () => {
    expect(pickCue(baseInput({ cornersSeen: 4, quad: null })).code).toBe(
      "some-corners",
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
    expect(pickCue(baseInput({ sharpEnough: false })).code).toBe("hold-still");
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
    expect(chips.paper).toEqual({ label: "Paper 4/4", pass: true });
    expect(chips.steady).toEqual({ label: "Steady", pass: true });
    expect(chips.light).toEqual({ label: "Light", pass: true });
  });

  it("paper chip reflects a partial corner count and fails", () => {
    const chips = computeStatusChips(baseInput({ cornersSeen: 2, quad: null }));
    expect(chips.paper).toEqual({ label: "Paper 2/4", pass: false });
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
