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
        "paper-edge",
        "en",
      ).code,
    ).toBe("no-corners");
  });

  it("1b: no corners for longer than the timeout escalates to place-paper", () => {
    expect(
      pickCue(
        baseInput({ cornersSeen: 0, quad: null, msSinceLastDetection: 2001 }),
        "paper-edge",
        "en",
      ).code,
    ).toBe("place-paper");
  });

  it("1c: exactly at the timeout boundary still reads as no-corners", () => {
    expect(
      pickCue(
        baseInput({ cornersSeen: 0, quad: null, msSinceLastDetection: 2000 }),
        "paper-edge",
        "en",
      ).code,
    ).toBe("no-corners");
  });

  it("2: 1-3 corners", () => {
    expect(
      pickCue(baseInput({ cornersSeen: 1, quad: null }), "paper-edge", "en")
        .code,
    ).toBe("some-corners");
    expect(
      pickCue(baseInput({ cornersSeen: 3, quad: null }), "paper-edge", "en")
        .code,
    ).toBe("some-corners");
  });

  it("2b: 4 corners reported but no quad yet also reads as some-corners", () => {
    expect(
      pickCue(baseInput({ cornersSeen: 4, quad: null }), "paper-edge", "en")
        .code,
    ).toBe("some-corners");
  });

  it("3: skewed quad, even with everything else perfect", () => {
    const skewed: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 400, y: 0 },
      bottomRight: { x: 200, y: 400 },
      bottomLeft: { x: 0, y: 400 },
    };
    expect(
      pickCue(baseInput({ quad: skewed, frameWidth: 640 }), "paper-edge", "en")
        .code,
    ).toBe("tilted");
  });

  it("4a: quad too small in frame -> too-far ('Move closer')", () => {
    const small: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 100, y: 100 },
      bottomLeft: { x: 0, y: 100 },
    };
    expect(
      pickCue(baseInput({ quad: small, frameWidth: 640 }), "paper-edge", "en")
        .code,
    ).toBe("too-far");
  });

  it("4b: quad too large in frame -> too-close ('Move back a little')", () => {
    const big: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 630, y: 0 },
      bottomRight: { x: 630, y: 630 },
      bottomLeft: { x: 0, y: 630 },
    };
    expect(
      pickCue(baseInput({ quad: big, frameWidth: 640 }), "paper-edge", "en")
        .code,
    ).toBe("too-close");
  });

  it("5a: too dark", () => {
    expect(pickCue(baseInput({ meanLuma: 40 }), "paper-edge", "en").code).toBe(
      "dark",
    );
  });

  it("5b: too bright / clipped", () => {
    expect(
      pickCue(baseInput({ clippedFraction: 0.2 }), "paper-edge", "en").code,
    ).toBe("bright");
  });

  it("6: not steady", () => {
    expect(pickCue(baseInput({ steady: false }), "paper-edge", "en").code).toBe(
      "hold-still",
    );
  });

  it("6b: steady but not sharp enough is out of focus, not 'hold still'", () => {
    const result = pickCue(
      baseInput({ sharpEnough: false }),
      "paper-edge",
      "en",
    );
    expect(result.code).toBe("out-of-focus");
    expect(result.message).toBe("Waiting for a sharp picture");
    expect(result.allPass).toBe(false);
  });

  it("6c: shake is 'hold still' whether or not the picture is sharp", () => {
    expect(pickCue(baseInput({ steady: false }), "paper-edge", "en").code).toBe(
      "hold-still",
    );
    expect(
      pickCue(
        baseInput({ steady: false, sharpEnough: false }),
        "paper-edge",
        "en",
      ).code,
    ).toBe("hold-still");
  });

  it("6d: out-of-focus sits between steady and perfect: light and size still come first", () => {
    expect(
      pickCue(
        baseInput({ sharpEnough: false, meanLuma: 40 }),
        "paper-edge",
        "en",
      ).code,
    ).toBe("dark");
    expect(
      pickCue(
        baseInput({ sharpEnough: false, clippedFraction: 0.2 }),
        "paper-edge",
        "en",
      ).code,
    ).toBe("bright");
  });

  it("hold-still fires only for shake: never when steady", () => {
    for (const sharpEnough of [true, false]) {
      expect(
        pickCue(baseInput({ steady: true, sharpEnough }), "paper-edge", "en")
          .code,
      ).not.toBe("hold-still");
    }
  });

  it("out-of-focus fires only when steady and not sharp", () => {
    for (const steady of [true, false]) {
      for (const sharpEnough of [true, false]) {
        const code = pickCue(
          baseInput({ steady, sharpEnough }),
          "paper-edge",
          "en",
        ).code;
        expect(
          code === "out-of-focus",
          `steady=${steady} sharp=${sharpEnough}`,
        ).toBe(steady && !sharpEnough);
      }
    }
  });

  it("7: everything passes -> perfect, and only perfect sets allPass", () => {
    const result = pickCue(baseInput(), "paper-edge", "en");
    expect(result.code).toBe("perfect");
    expect(result.allPass).toBe(true);
    expect(
      pickCue(baseInput({ steady: false }), "paper-edge", "en").allPass,
    ).toBe(false);
  });

  it("checks run in the documented order — e.g. dark AND unsteady reports dark first", () => {
    expect(
      pickCue(baseInput({ meanLuma: 40, steady: false }), "paper-edge", "en")
        .code,
    ).toBe("dark");
  });
});

describe("computeStatusChips", () => {
  it("all three chips pass when everything is good", () => {
    const chips = computeStatusChips(baseInput(), "paper-edge", "en");
    expect(chips.paper).toEqual({ label: "Paper 4/4", pass: true });
    expect(chips.steady).toEqual({ label: "Steady", pass: true });
    expect(chips.light).toEqual({ label: "Light", pass: true });
  });

  it("paper chip reflects a partial corner count and fails", () => {
    const chips = computeStatusChips(
      baseInput({ cornersSeen: 2, quad: null }),
      "paper-edge",
      "en",
    );
    expect(chips.paper).toEqual({ label: "Paper 2/4", pass: false });
  });

  it("steady chip means shake only, like the hold-still cue: it fails on unsteady, not on blur", () => {
    expect(
      computeStatusChips(baseInput({ steady: false }), "paper-edge", "en")
        .steady.pass,
    ).toBe(false);
    expect(
      computeStatusChips(baseInput({ sharpEnough: false }), "paper-edge", "en")
        .steady.pass,
    ).toBe(true);
    expect(
      computeStatusChips(
        baseInput({ steady: false, sharpEnough: false }),
        "paper-edge",
        "en",
      ).steady.pass,
    ).toBe(false);
    // ...and it agrees with the cue: the chip fails exactly when the cue is hold-still.
    for (const steady of [true, false]) {
      for (const sharpEnough of [true, false]) {
        const input = baseInput({ steady, sharpEnough });
        expect(computeStatusChips(input, "paper-edge", "en").steady.pass).toBe(
          pickCue(input, "paper-edge", "en").code !== "hold-still",
        );
      }
    }
  });

  it("light chip fails when dark or bright", () => {
    expect(
      computeStatusChips(baseInput({ meanLuma: 10 }), "paper-edge", "en").light
        .pass,
    ).toBe(false);
    expect(
      computeStatusChips(
        baseInput({ clippedFraction: 0.5 }),
        "paper-edge",
        "en",
      ).light.pass,
    ).toBe(false);
  });
});

it("uses sheet nouns for printed-sheet cues and paper nouns for paper-edge cues", () => {
  const noCorners = baseInput({ cornersSeen: 0, quad: null });
  expect(pickCue(noCorners, "printed-sheet", "en").message).toBe(
    "Point the camera at the sheet",
  );
  expect(pickCue(noCorners, "paper-edge", "en").message).toBe(
    "Point the camera at the paper",
  );
  expect(
    pickCue(baseInput({ cornersSeen: 2, quad: null }), "printed-sheet", "en")
      .message,
  ).toContain("sheet corners");
  expect(
    computeStatusChips(baseInput(), "printed-sheet", "en").paper.label,
  ).toBe("Sheet 4/4");
  expect(computeStatusChips(baseInput(), "paper-edge", "en").paper.label).toBe(
    "Paper 4/4",
  );
});

describe("the easy scan's cue text", () => {
  it("'perfect' reads 'Got it — hold still'", () => {
    expect(
      easyCueText(cueFromCode("perfect", "paper-edge", "en"), {
        tapToFocus: true,
        locale: "en",
      }),
    ).toBe("Got it — hold still");
    expect(
      easyCueText(cueFromCode("perfect", "paper-edge", "en"), {
        tapToFocus: false,
        locale: "en",
      }),
    ).toBe("Got it — hold still");
  });

  it("out of focus asks for a tap where a tap can set the focus, else it waits", () => {
    expect(
      easyCueText(cueFromCode("out-of-focus", "paper-edge", "en"), {
        tapToFocus: true,
        locale: "en",
      }),
    ).toBe("Tap the paper to focus");
    expect(
      easyCueText(cueFromCode("out-of-focus", "paper-edge", "en"), {
        tapToFocus: false,
        locale: "en",
      }),
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
      const cue = cueFromCode(code, "paper-edge", "en");
      expect(easyCueText(cue, { tapToFocus: true, locale: "en" })).toBe(
        cue.message,
      );
      expect(easyCueText(cue, { tapToFocus: false, locale: "en" })).toBe(
        cue.message,
      );
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
        locale: "en",
      }),
    ).toBe("Waiting for a sharp picture");
  });

  it("does not repeat the cue's words when the cue already says them", () => {
    expect(
      easyHintText({
        cueCode: "out-of-focus",
        ringFraction: 0,
        tapToFocus: false,
        locale: "en",
      }),
    ).toBe("");
  });

  it("says the photo is being taken once the ring has started to fill", () => {
    expect(
      easyHintText({
        cueCode: "perfect",
        ringFraction: 0.125,
        tapToFocus: false,
        locale: "en",
      }),
    ).toBe("Hold still — taking the photo");
    expect(
      easyHintText({
        cueCode: "perfect",
        ringFraction: 0,
        tapToFocus: false,
        locale: "en",
      }),
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
        easyHintText({
          cueCode: code,
          ringFraction: 0.5,
          tapToFocus: true,
          locale: "en",
        }),
      ).toBe("");
    }
    expect(
      easyHintText({
        cueCode: null,
        ringFraction: 0,
        tapToFocus: true,
        locale: "en",
      }),
    ).toBe("");
  });
});

describe("pickCue: the photo's paper gate (S1)", () => {
  const covered = { kind: "edge-covered", side: "left" } as const;

  it("a covered edge is its own cue, named by side, in both languages", () => {
    const en = pickCue(baseInput({ paperGate: covered }), "paper-edge", "en");
    expect(en.code).toBe("edge-covered-left");
    expect(en.message).toBe("The left edge is covered. Move your hand in.");
    expect(en.allPass).toBe(false);
    const zh = pickCue(
      baseInput({ paperGate: covered }),
      "paper-edge",
      "zh-TW",
    );
    expect(zh.message).toBe("紙的左緣被擋住，手往內移");
  });

  it("with no trustworthy side name, the plain 'an edge' cue", () => {
    const cue = pickCue(
      baseInput({ paperGate: { kind: "edge-covered", side: null } }),
      "paper-edge",
      "en",
    );
    expect(cue.code).toBe("edge-covered");
    expect(cue.message).toBe("An edge is covered. Move your hand in.");
  });

  it("a paper that is not flat is its own cue", () => {
    const cue = pickCue(
      baseInput({ paperGate: { kind: "curled" } }),
      "paper-edge",
      "en",
    );
    expect(cue.code).toBe("paper-curled");
    expect(cue.message).toBe("Smooth the paper down.");
  });

  it("passes, and not-yet-judged, change nothing: the cue is what it was without the field", () => {
    expect(pickCue(baseInput(), "paper-edge", "en").code).toBe("perfect");
    for (const paperGate of [
      { kind: "pass" },
      { kind: "not-evaluated" },
    ] as const)
      expect(pickCue(baseInput({ paperGate }), "paper-edge", "en").code).toBe(
        "perfect",
      );
  });

  it("sits after the corner, tilt, size and light cues and before shake and focus", () => {
    const gate = { paperGate: covered };
    // Before it: no corners, some corners, tilt, size.
    expect(
      pickCue(
        baseInput({ ...gate, cornersSeen: 3, quad: null }),
        "paper-edge",
        "en",
      ).code,
    ).toBe("some-corners");
    const skewed: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 400, y: 0 },
      bottomRight: { x: 200, y: 400 },
      bottomLeft: { x: 0, y: 400 },
    };
    expect(
      pickCue(baseInput({ ...gate, quad: skewed }), "paper-edge", "en").code,
    ).toBe("tilted");
    const small: Quad = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 100, y: 100 },
      bottomLeft: { x: 0, y: 100 },
    };
    expect(
      pickCue(baseInput({ ...gate, quad: small }), "paper-edge", "en").code,
    ).toBe("too-far");
    // Light comes first: poor light can itself cause the edge failure.
    expect(
      pickCue(baseInput({ ...gate, meanLuma: 40 }), "paper-edge", "en").code,
    ).toBe("dark");
    expect(
      pickCue(baseInput({ ...gate, clippedFraction: 0.2 }), "paper-edge", "en")
        .code,
    ).toBe("bright");
    // After it: unsteady and out of focus both wait for the gate.
    for (const worse of [{ steady: false }, { sharpEnough: false }])
      expect(
        pickCue(baseInput({ ...gate, ...worse }), "paper-edge", "en").code,
      ).toBe("edge-covered-left");
  });

  it("a refusal with no words is read as the corners cue, never as perfect", () => {
    expect(
      pickCue(baseInput({ paperGate: { kind: "blocked" } }), "paper-edge", "en")
        .code,
    ).toBe("some-corners");
  });

  it("the easy scan's cue line says the same words, from the code", () => {
    const cue = cueFromCode("edge-covered-top", "paper-edge", "en");
    expect(easyCueText(cue, { tapToFocus: true, locale: "en" })).toBe(
      "The top edge is covered. Move your hand in.",
    );
    expect(easyCueText(cue, { tapToFocus: false, locale: "zh-TW" })).toBe(
      "紙的上緣被擋住，手往內移",
    );
  });
});
