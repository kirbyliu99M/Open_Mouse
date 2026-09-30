import { describe, expect, it } from "vitest";
import {
  contrast,
  glyphAndBackOverWhite,
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
