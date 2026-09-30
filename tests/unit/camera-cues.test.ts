import { describe, expect, it } from "vitest";
import {
  pickCue,
  computeStatusChips,
  cueFromCode,
  easyCueText,
  easyHintText,
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

  it("6b: steady but not sharp enough is out of focus, not 'hold still'", () => {
    const result = pickCue(baseInput({ sharpEnough: false }));
    expect(result.code).toBe("out-of-focus");
    expect(result.message).toBe("Waiting for a sharp picture");
    expect(result.allPass).toBe(false);
  });

  it("6c: shake is 'hold still' whether or not the picture is sharp", () => {
    expect(pickCue(baseInput({ steady: false })).code).toBe("hold-still");
    expect(pickCue(baseInput({ steady: false, sharpEnough: false })).code).toBe(
      "hold-still",
    );
  });

  it("6d: out-of-focus sits between steady and perfect: light and size still come first", () => {
    expect(pickCue(baseInput({ sharpEnough: false, meanLuma: 40 })).code).toBe(
      "dark",
    );
    expect(
      pickCue(baseInput({ sharpEnough: false, clippedFraction: 0.2 })).code,
    ).toBe("bright");
  });

  it("hold-still fires only for shake: never when steady", () => {
    for (const sharpEnough of [true, false]) {
      expect(pickCue(baseInput({ steady: true, sharpEnough })).code).not.toBe(
        "hold-still",
      );
    }
  });

  it("out-of-focus fires only when steady and not sharp", () => {
    for (const steady of [true, false]) {
      for (const sharpEnough of [true, false]) {
        const code = pickCue(baseInput({ steady, sharpEnough })).code;
        expect(
          code === "out-of-focus",
          `steady=${steady} sharp=${sharpEnough}`,
        ).toBe(steady && !sharpEnough);
      }
    }
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

  it("steady chip means shake only, like the hold-still cue: it fails on unsteady, not on blur", () => {
    expect(computeStatusChips(baseInput({ steady: false })).steady.pass).toBe(
      false,
    );
    expect(
      computeStatusChips(baseInput({ sharpEnough: false })).steady.pass,
    ).toBe(true);
    expect(
      computeStatusChips(baseInput({ steady: false, sharpEnough: false }))
        .steady.pass,
    ).toBe(false);
    // ...and it agrees with the cue: the chip fails exactly when the cue is hold-still.
    for (const steady of [true, false]) {
      for (const sharpEnough of [true, false]) {
        const input = baseInput({ steady, sharpEnough });
        expect(computeStatusChips(input).steady.pass).toBe(
          pickCue(input).code !== "hold-still",
        );
      }
    }
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

it("uses sheet nouns for printed-sheet cues and paper nouns for paper-edge cues", () => {
  const noCorners = baseInput({ cornersSeen: 0, quad: null });
  expect(pickCue(noCorners, "printed-sheet").message).toBe(
    "Point the camera at the sheet",
  );
  expect(pickCue(noCorners, "paper-edge").message).toBe(
    "Point the camera at the paper",
  );
  expect(
    pickCue(baseInput({ cornersSeen: 2, quad: null }), "printed-sheet").message,
  ).toContain("sheet corners");
  expect(computeStatusChips(baseInput(), "printed-sheet").paper.label).toBe(
    "Sheet 4/4",
  );
  expect(computeStatusChips(baseInput(), "paper-edge").paper.label).toBe(
    "Paper 4/4",
  );
});

describe("the easy scan's cue text", () => {
  it("'perfect' reads 'Got it — hold still'", () => {
    expect(easyCueText(cueFromCode("perfect"), { tapToFocus: true })).toBe(
      "Got it — hold still",
    );
    expect(easyCueText(cueFromCode("perfect"), { tapToFocus: false })).toBe(
      "Got it — hold still",
    );
  });

  it("out of focus asks for a tap where a tap can set the focus, else it waits", () => {
    expect(easyCueText(cueFromCode("out-of-focus"), { tapToFocus: true })).toBe(
      "Tap the paper to focus",
    );
    expect(
      easyCueText(cueFromCode("out-of-focus"), { tapToFocus: false }),
    ).toBe("Waiting for a sharp picture");
  });

  it("every other cue keeps its own message whatever the focus support", () => {
    for (const code of [
      "place-paper",
      "no-corners",
      "some-corners",
      "tilted",
      "too-far",
      "too-close",
      "dark",
      "bright",
      "hold-still",
    ] as const) {
      const cue = cueFromCode(code);
      expect(easyCueText(cue, { tapToFocus: true })).toBe(cue.message);
      expect(easyCueText(cue, { tapToFocus: false })).toBe(cue.message);
    }
  });
});

describe("the easy scan's hint line", () => {
  it("says the sharp picture is awaited while out of focus, where the cue says 'tap'", () => {
    expect(
      easyHintText({
        cueCode: "out-of-focus",
        ringFraction: 0,
        tapToFocus: true,
      }),
    ).toBe("Waiting for a sharp picture");
  });

  it("does not repeat the cue's words when the cue already says them", () => {
    expect(
      easyHintText({
        cueCode: "out-of-focus",
        ringFraction: 0,
        tapToFocus: false,
      }),
    ).toBe("");
  });

  it("says the photo is being taken once the ring has started to fill", () => {
    expect(
      easyHintText({
        cueCode: "perfect",
        ringFraction: 0.125,
        tapToFocus: false,
      }),
    ).toBe("Hold still — taking the photo");
    expect(
      easyHintText({ cueCode: "perfect", ringFraction: 0, tapToFocus: false }),
    ).toBe("");
  });

  it("is empty for every other cue", () => {
    for (const code of [
      "no-corners",
      "some-corners",
      "tilted",
      "hold-still",
      "dark",
    ] as const) {
      expect(
        easyHintText({ cueCode: code, ringFraction: 0.5, tapToFocus: true }),
      ).toBe("");
    }
    expect(
      easyHintText({ cueCode: null, ringFraction: 0, tapToFocus: true }),
    ).toBe("");
  });
});
