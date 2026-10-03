import { describe, expect, it } from "vitest";
import {
  contrast,
  glyphAndBackOverWhite,
  glyphAndBackOverWhiteLayers,
  type Rgba,
} from "../e2e/fixtures/contrast";

/**
 * The maths behind the live-camera contrast measurement in
 * tests/e2e/a11y-axe.spec.ts: white text on a translucent black fill, laid over
 * a white picture, with the text's own alpha and the element's opacity.
 */
const WHITE: Rgba = [255, 255, 255, 1];
const black = (alpha: number): Rgba => [0, 0, 0, alpha];

function ratio(text: Rgba, fill: Rgba | null, opacity = 1) {
  const { glyph, back } = glyphAndBackOverWhite(text, fill, opacity);
  return contrast(glyph, back);
}

describe("glyphAndBackOverWhite", () => {
  it("white on a 60% black fill is 5.74:1 (the figure the suite has always reported for the controls)", () => {
    expect(ratio(WHITE, black(0.6))).toBeCloseTo(5.74, 1);
  });

  it("white on a 62% black fill is 6.19:1 (the cue)", () => {
    expect(ratio(WHITE, black(0.62))).toBeCloseTo(6.19, 1);
  });

  it("a fill with no colour under white text is 1:1: nothing to read against a white picture", () => {
    expect(ratio(WHITE, null)).toBeCloseTo(1, 5);
    expect(ratio(WHITE, black(0))).toBeCloseTo(1, 5);
  });

  it("a weaker fill fails: 20% black under white text is about 1.5:1", () => {
    expect(ratio(WHITE, black(0.2))).toBeLessThan(2);
  });

  it("text that is itself translucent fails: white at 30% on a 60% fill", () => {
    expect(ratio([255, 255, 255, 0.3], black(0.6))).toBeLessThan(2.5);
  });

  it("fading the whole element pulls both towards the picture: opacity .4 is about 1.8:1", () => {
    expect(ratio(WHITE, black(0.6), 0.4)).toBeLessThan(2);
    expect(ratio(WHITE, black(0.6), 0.4)).toBeGreaterThan(1.5);
  });

  it("opacity 1 changes nothing, opacity 0 leaves only the picture", () => {
    expect(ratio(WHITE, black(0.6), 1)).toBeCloseTo(5.74, 1);
    expect(ratio(WHITE, black(0.6), 0)).toBeCloseTo(1, 5);
  });

  it("opaque text on an opaque fill is that contrast whatever the picture", () => {
    expect(ratio([255, 255, 255, 1], [0, 0, 0, 1])).toBeCloseTo(21, 3);
  });

  it("a glyph pixel is the text over the fill over the picture (by hand: 30% white over 60% black over white)", () => {
    // coverage 0.3 + 0.6 * 0.7 = 0.72; premultiplied colour 255 * 0.3 = 76.5;
    // on white: 255 * 0.28 + 76.5 = 147.9.
    const { glyph, back } = glyphAndBackOverWhite(
      [255, 255, 255, 0.3],
      black(0.6),
      1,
    );
    expect(glyph).toBe("rgb(148, 148, 148)");
    expect(back).toBe("rgb(102, 102, 102)");
  });
});

describe("glyphAndBackOverWhite with a fill that is not black (the text-under term)", () => {
  it("50% blue text over a 50% red fill, over white: by hand", () => {
    // fill premultiplied (127.5, 0, 0), a .5; text premultiplied (0, 0, 127.5), a .5.
    // glyph pixel: text over fill = (63.75, 0, 127.5) at a .75; over white
    // 255 * .25 = 63.75 added: (127.5, 63.75, 191.25).
    // beside it: the fill alone, over white: (255, 127.5, 127.5).
    const { glyph, back } = glyphAndBackOverWhite(
      [0, 0, 255, 0.5],
      [255, 0, 0, 0.5],
      1,
    );
    expect(glyph).toBe("rgb(128, 64, 191)");
    expect(back).toBe("rgb(255, 128, 128)");
  });

  it("the text's own alpha lets the fill show through it: without the (1 - at) term the answer would be different", () => {
    // Half-transparent blue text over an opaque red fill lets half the red
    // through the text: (0, 0, 127.5) + (255, 0, 0) * (1 - 0.5) = (127.5, 0,
    // 127.5). Without the (1 - at) term the red would count in full, and the
    // glyph would come out (255, 0, 127.5).
    const { glyph } = glyphAndBackOverWhite(
      [0, 0, 255, 0.5],
      [255, 0, 0, 1],
      1,
    );
    // text over an opaque red fill: (0, 0, 127.5) + (255, 0, 0) * .5 = (127.5, 0, 127.5)
    expect(glyph).toBe("rgb(128, 0, 128)");
  });
});

describe("glyphAndBackOverWhiteLayers: the chain of elements between the screen and the text", () => {
  it("one layer is the single-element answer", () => {
    for (const opacity of [1, 0.7, 0.4])
      for (const fillAlpha of [0.2, 0.6, 1])
        expect(
          glyphAndBackOverWhiteLayers(
            [255, 255, 255, 0.8],
            [{ fill: [10, 20, 30, fillAlpha], opacity }],
          ),
        ).toEqual(
          glyphAndBackOverWhite(
            [255, 255, 255, 0.8],
            [10, 20, 30, fillAlpha],
            opacity,
          ),
        );
  });

  it("a parent at opacity .5 holding a 60% black fill, and a child with no fill at opacity .5, by hand", () => {
    // Text (white, a 1) in the child: faded .5 -> (127.5, a .5). Over the
    // parent's fill (black a .6): (127.5, a .5 + .6 * .5 = .8); faded .5 ->
    // (63.75, a .4). Over white: 255 * .6 + 63.75 = 216.75.
    // Beside the text: child nothing; parent fill (0, a .6) faded .5 -> a .3;
    // over white: 255 * .7 = 178.5.
    const { glyph, back } = glyphAndBackOverWhiteLayers(
      [255, 255, 255, 1],
      [
        { fill: [0, 0, 0, 0.6], opacity: 0.5 },
        { fill: null, opacity: 0.5 },
      ],
    );
    expect(glyph).toBe("rgb(217, 217, 217)");
    expect(back).toBe("rgb(179, 179, 179)");
  });

  it("a light child fill over a dark parent pill is blended over it, not measured against white alone", () => {
    // Parent: black a .6. Child: white a .5 fill, text white. The child's fill
    // lightens the pill: text white over it must read worse than over the pill.
    const pillOnly = glyphAndBackOverWhiteLayers(
      [255, 255, 255, 1],
      [{ fill: [0, 0, 0, 0.6], opacity: 1 }],
    );
    const withLightChild = glyphAndBackOverWhiteLayers(
      [255, 255, 255, 1],
      [
        { fill: [0, 0, 0, 0.6], opacity: 1 },
        { fill: [255, 255, 255, 0.5], opacity: 1 },
      ],
    );
    expect(contrast(withLightChild.glyph, withLightChild.back)).toBeLessThan(
      contrast(pillOnly.glyph, pillOnly.back),
    );
    // by hand: the pill over white is 102; 50% white over it is 178.5 -> 179.
    expect(withLightChild.back).toBe("rgb(179, 179, 179)");
  });

  it("transparent text is unreadable: contrast 1", () => {
    const { glyph, back } = glyphAndBackOverWhiteLayers(
      [255, 255, 255, 0],
      [{ fill: [0, 0, 0, 0.6], opacity: 1 }],
    );
    expect(contrast(glyph, back)).toBeCloseTo(1, 5);
  });

  it("no layers: the text over plain white", () => {
    expect(glyphAndBackOverWhiteLayers([0, 0, 0, 1], [])).toEqual({
      glyph: "rgb(0, 0, 0)",
      back: "rgb(255, 255, 255)",
    });
  });
});
