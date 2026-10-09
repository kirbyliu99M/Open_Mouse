import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/particles/random";
import {
  LABEL_REACH,
  MARK_RULES,
  MAX_EDGE_WIDTH,
  type Mask,
  depthInside,
  dilateMask,
  distanceToOutline,
  groupLetters,
  labelPieces,
  lettersFromLabels,
  markGap,
  maskAt,
  sampleMask,
  spacingForCount,
  squaredDistanceTo,
  thinToCount,
  thresholdMask,
} from "@/lib/particles/text-mask";

/** A blank alpha canvas and a way to paint filled rectangles on it. */
function canvas(width: number, height: number) {
  const alpha = new Uint8ClampedArray(width * height);
  const rect = (x: number, y: number, w: number, h: number, a = 255) => {
    for (let j = y; j < y + h; j += 1) {
      for (let i = x; i < x + w; i += 1) alpha[j * width + i] = a;
    }
  };
  return { alpha, rect, width, height };
}

/**
 * "Ii" on line one and "LL" on line two, block letters: an I (bar), an i (a
 * dot over a stem), and two L's (each a stem and a foot that touch: one piece).
 */
function twoLines() {
  const c = canvas(80, 60);
  c.rect(4, 4, 6, 20); // I
  c.rect(20, 4, 6, 4); // i's dot
  c.rect(20, 11, 6, 13); // i's stem
  c.rect(4, 34, 5, 20); // L
  c.rect(4, 49, 14, 5); // its foot
  c.rect(30, 34, 5, 20); // L
  c.rect(30, 49, 14, 5);
  return c;
}

/**
 * The distance from (x, y) to the nearest point outside the mask, by brute
 * force: every unset pixel's square, and the canvas's four edges (beyond
 * them is outside). 0 when (x, y) is itself outside.
 */
function bruteOutline(mask: Mask, x: number, y: number): number {
  if (!maskAt(mask, x, y)) return 0;
  let best = Math.min(x, y, mask.width - x, mask.height - y);
  for (let j = 0; j < mask.height; j += 1) {
    for (let i = 0; i < mask.width; i += 1) {
      if (mask.data[j * mask.width + i] === 1) continue;
      const dx = x < i ? i - x : x > i + 1 ? x - (i + 1) : 0;
      const dy = y < j ? j - y : y > j + 1 ? y - (j + 1) : 0;
      best = Math.min(best, Math.sqrt(dx * dx + dy * dy));
    }
  }
  return best;
}

const bruteSquared = (feature: Uint8Array, w: number, h: number) => {
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let best = Infinity;
      for (let v = 0; v < h; v += 1) {
        for (let u = 0; u < w; u += 1) {
          if (feature[v * w + u] === 1) {
            best = Math.min(best, (u - x) ** 2 + (v - y) ** 2);
          }
        }
      }
      out[y * w + x] = best;
    }
  }
  return out;
};

describe("thresholdMask and maskAt", () => {
  it("sets the pixels at or over the threshold and reads a point by its pixel", () => {
    const mask = thresholdMask([0, 127, 128, 255], 2, 2);
    expect([...mask.data]).toEqual([0, 0, 1, 1]);
    expect(maskAt(mask, 0.5, 1.99)).toBe(true);
    expect(maskAt(mask, 1.99, 0.5)).toBe(false);
    expect(thresholdMask([0, 127, 128, 255], 2, 2, 100).data[1]).toBe(1);
  });

  it("counts anything outside the mask as unset", () => {
    const mask = thresholdMask([255], 1, 1);
    expect(maskAt(mask, 0.5, 0.5)).toBe(true);
    for (const [x, y] of [
      [-0.01, 0.5],
      [1, 0.5],
      [0.5, 1],
      [Number.NaN, 0],
    ]) {
      expect(maskAt(mask, x!, y!)).toBe(false);
    }
  });

  it("refuses an array of the wrong size, and a size that is not a positive whole number", () => {
    expect(() => thresholdMask([0, 0, 0], 2, 2)).toThrow(/4 values/);
    expect(() => thresholdMask([], 0, 0)).toThrow(/positive/);
    expect(() => thresholdMask([0, 0], 1.5, 1)).toThrow(/positive/);
  });
});

describe("squaredDistanceTo", () => {
  it("is exact: it matches a brute-force search on random grids", () => {
    const random = mulberry32(3);
    for (let n = 0; n < 6; n += 1) {
      const w = 7 + n;
      const h = 5 + 2 * n;
      const feature = new Uint8Array(w * h);
      for (let i = 0; i < feature.length; i += 1) {
        feature[i] = random() < 0.08 ? 1 : 0;
      }
      feature[0] = 1;
      expect([...squaredDistanceTo(feature, w, h)]).toEqual([
        ...bruteSquared(feature, w, h),
      ]);
    }
  });

  it("is huge everywhere when there is no feature, and 0 on every feature pixel", () => {
    const none = squaredDistanceTo(new Uint8Array(12), 4, 3);
    for (const d of none) expect(d).toBeGreaterThanOrEqual(1e20);
    const all = squaredDistanceTo(new Uint8Array(12).fill(1), 4, 3);
    expect([...all]).toEqual(new Array(12).fill(0));
  });

  it("works on one row and one column", () => {
    expect([...squaredDistanceTo(Uint8Array.from([0, 0, 1, 0]), 4, 1)]).toEqual(
      [4, 1, 0, 1],
    );
    expect([...squaredDistanceTo(Uint8Array.from([1, 0, 0]), 1, 3)]).toEqual([
      0, 1, 4,
    ]);
  });
});

describe("dilateMask", () => {
  const dot = (): Mask => {
    const data = new Uint8Array(9 * 9);
    data[4 * 9 + 4] = 1;
    return { width: 9, height: 9, data };
  };
  const count = (m: Mask) => m.data.reduce((s, v) => s + v, 0);

  it("leaves the mask as it is at radius 0, and grows a pixel into a disc", () => {
    expect([...dilateMask(dot(), 0).data]).toEqual([...dot().data]);
    // Offsets with dx² + dy² ≤ 4: the centre, 4 at distance 1, 4 at √2, 4 at 2.
    expect(count(dilateMask(dot(), 2))).toBe(13);
    expect(count(dilateMask(dot(), 1))).toBe(5);
  });

  it("only grows: a bigger radius covers everything a smaller one does", () => {
    const small = dilateMask(dot(), 1.5);
    const big = dilateMask(dot(), 3);
    for (let i = 0; i < small.data.length; i += 1) {
      if (small.data[i] === 1) expect(big.data[i]).toBe(1);
    }
    expect(count(big)).toBeGreaterThan(count(small));
  });

  it("refuses a negative radius", () => {
    expect(() => dilateMask(dot(), -1)).toThrow(/radius/);
    expect(() => dilateMask(dot(), Number.NaN)).toThrow(/radius/);
  });
});

describe("depthInside", () => {
  it("is the distance to the nearest unset pixel, the outside counting as unset", () => {
    const c = canvas(9, 9);
    c.rect(2, 2, 5, 5);
    const mask = thresholdMask(c.alpha, 9, 9);
    const depth = depthInside(mask);
    expect(depth[4 * 9 + 4]).toBe(3);
    expect(depth[2 * 9 + 4]).toBe(1);
    expect(depth[0]).toBe(0);
    // A mask filling the whole canvas still has an edge at the border.
    const full = depthInside(thresholdMask(new Array(9).fill(255), 3, 3));
    expect([...full]).toEqual([1, 1, 1, 1, 2, 1, 1, 1, 1]);
  });
});

describe("labelPieces and groupLetters", () => {
  it("joins pixels that touch, corners included", () => {
    const c = canvas(6, 6);
    c.rect(0, 0, 2, 2);
    c.rect(2, 2, 2, 2); // touches the first at a corner
    c.rect(5, 5, 1, 1);
    const { pieces, labels } = labelPieces(thresholdMask(c.alpha, 6, 6));
    expect(pieces).toHaveLength(2);
    expect(pieces.map((p) => p.area)).toEqual([8, 1]);
    expect(labels[0]).toBe(labels[3 * 6 + 3]);
    expect(labels[1 * 6 + 5]).toBe(-1);
  });

  it("reads letters line by line, left to right, and puts an i's dot with its stem", () => {
    const c = twoLines();
    const { pieces } = labelPieces(thresholdMask(c.alpha, c.width, c.height));
    expect(pieces).toHaveLength(5);
    const { letters, letterOfPiece } = groupLetters(pieces);
    expect(letters).toHaveLength(4);
    expect(letters.map((l) => l.line)).toEqual([0, 0, 1, 1]);
    expect(letters.map((l) => l.x0)).toEqual([4, 20, 4, 30]);
    // The dot (y 4) and the stem (y 11) are one letter, from y 4 to y 23.
    expect(letters[1]).toMatchObject({ y0: 4, y1: 23 });
    expect(new Set(letterOfPiece)).toEqual(new Set([0, 1, 2, 3]));
  });

  it("joins pixels that touch at a corner in either diagonal", () => {
    // (1, 0) and (0, 1): the scan meets (1, 0) first and must reach down-left.
    const anti = thresholdMask([0, 255, 255, 0], 2, 2);
    expect(labelPieces(anti).pieces).toHaveLength(1);
    const main = thresholdMask([255, 0, 0, 255], 2, 2);
    expect(labelPieces(main).pieces).toHaveLength(1);
  });

  it("has nothing to read in an empty mask", () => {
    expect(groupLetters([])).toEqual({ letters: [], letterOfPiece: [] });
  });

  const box = (x0: number, y0: number, x1: number, y1: number) => ({
    x0,
    y0,
    x1,
    y1,
    area: (x1 - x0 + 1) * (y1 - y0 + 1),
  });

  it("puts a lone i's dot with its stem: one letter, one line (no tall letter beside it)", () => {
    const { letters, letterOfPiece } = groupLetters([
      { x0: 20, y0: 4, x1: 25, y1: 7, area: 24 },
      { x0: 20, y0: 11, x1: 25, y1: 23, area: 78 },
    ]);
    expect(letters).toHaveLength(1);
    expect(letterOfPiece).toEqual([0, 0]);
    expect(letters[0]).toMatchObject({
      x0: 20,
      y0: 4,
      x1: 25,
      y1: 23,
      line: 0,
    });
  });

  it("reads a line of lower-case letters only, dots and all: 'mini' is four letters", () => {
    const { letters, letterOfPiece } = groupLetters([
      box(0, 12, 17, 25), // m
      box(22, 5, 25, 8), // i's dot
      box(22, 12, 25, 25), // i's stem
      box(30, 12, 41, 25), // n
      box(46, 5, 49, 8), // i's dot
      box(46, 12, 49, 25), // i's stem
    ]);
    expect(letters).toHaveLength(4);
    expect(letters.every((l) => l.line === 0)).toBe(true);
    expect(letterOfPiece).toEqual([0, 1, 1, 2, 3, 3]);
  });

  it("takes a mark below its letter too (a cedilla), and an accent above it", () => {
    const { letters, letterOfPiece } = groupLetters([
      box(0, 10, 11, 23), // c
      box(4, 26, 8, 29), // cedilla, 2 rows below
      box(20, 10, 31, 23), // e
      box(23, 4, 28, 7), // acute, 2 rows above
    ]);
    expect(letters).toHaveLength(2);
    expect(letterOfPiece).toEqual([0, 0, 1, 1]);
    expect(letters[0]).toMatchObject({ y0: 10, y1: 29 });
    expect(letters[1]).toMatchObject({ y0: 4, y1: 23 });
  });

  it("keeps two stacked lines apart, even set tight ('Find Your' over 'Best Mouse')", () => {
    // Capitals 20 px tall, lower case 14, lines 4 px apart; a full stop at the
    // end of line one right above a capital of line two.
    const top = [
      box(0, 0, 11, 19), // F
      box(16, 0, 19, 3), // i's dot
      box(16, 6, 19, 19), // i's stem
      box(24, 6, 35, 19), // n
      box(40, 16, 43, 19), // a full stop
    ];
    const bottom = [
      box(0, 24, 11, 43), // B
      box(16, 30, 21, 43), // e
      box(26, 24, 29, 27), // i's dot, right under line one's n
      box(26, 30, 29, 43), // i's stem
      box(36, 24, 47, 43), // M, under the full stop
    ];
    const { letters, letterOfPiece } = groupLetters([...top, ...bottom]);
    expect(letters.map((l) => l.line)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    // Each i is one letter; the full stop stays on line one; line two's dot
    // goes with its own stem, not with the n above it.
    expect(letterOfPiece.slice(0, 5)).toEqual([0, 1, 1, 2, 3]);
    expect(letterOfPiece.slice(5)).toEqual([4, 5, 6, 6, 7]);
    for (const l of letters.filter((x) => x.line === 0)) {
      expect(l.y1).toBeLessThanOrEqual(19);
    }
  });

  it("only treats a small piece close to a bigger one as its mark (markGap)", () => {
    const stem = box(20, 11, 25, 23);
    expect(markGap(box(20, 4, 25, 7), stem)).toBe(3);
    // Too far for its size: a dot 4 rows high, 7 rows away.
    expect(markGap(box(20, 0, 25, 3), stem)).toBe(-1);
    // Each gap limit on its own: 7 rows is within 0.4 of a 20-row host but
    // more than 1.5 dot heights; 5 rows is within 1.5 heights of a 5-row mark
    // but more than 0.4 of a 12-row host.
    expect(markGap(box(20, 0, 25, 3), box(20, 11, 25, 30))).toBe(-1);
    expect(markGap(box(20, 4, 25, 7), box(20, 11, 25, 30))).toBe(3);
    expect(markGap(box(0, 0, 5, 4), box(0, 10, 5, 21))).toBe(-1);
    expect(markGap(box(0, 0, 5, 4), box(0, 9, 5, 20))).toBe(4);
    // Size: 6 rows is more than 0.45 of a 13-row stem; a lower-case letter is
    // never a mark of a taller one.
    expect(markGap(box(20, 1, 25, 6), stem)).toBe(-1);
    expect(markGap(box(20, 32, 31, 45), box(20, 6, 31, 29))).toBe(-1);
    // Across x: more than 0.3 of the narrower (an italic j's dot, half over).
    expect(markGap(box(23, 4, 28, 7), stem)).toBe(3);
    expect(markGap(box(24, 4, 29, 7), stem)).toBe(3);
    expect(markGap(box(25, 4, 30, 7), stem)).toBe(-1);
    expect(markGap(box(30, 4, 35, 7), stem)).toBe(-1);
    // Sharing a row: a neighbour in the line, not a mark.
    expect(markGap(box(20, 9, 25, 12), stem)).toBe(-1);
    // A mark is never a host of a bigger piece.
    expect(markGap(stem, box(20, 4, 25, 7))).toBe(-1);
    expect(MARK_RULES.size).toBeLessThan(1);
  });

  describe("Codex's cases (review 2)", () => {
    it("gives a dot between two lines to the stem under it, not the n above (case 1)", () => {
      const { letterOfPiece, letters } = groupLetters([
        box(20, 6, 31, 19), // line one's n
        box(24, 22, 27, 25), // line two's i dot: 2 rows under the n, 4 over its stem
        box(24, 30, 27, 43), // line two's i stem
      ]);
      expect(letterOfPiece).toEqual([0, 1, 1]);
      expect(letters.map((l) => l.line)).toEqual([0, 1]);
    });

    it("keeps a descender of line one and the letter under it on two lines (case 2)", () => {
      const { letterOfPiece, letters } = groupLetters([
        box(20, 6, 31, 29), // a g or p: x-height plus descender
        box(20, 32, 31, 45), // the next line's lower-case letter
      ]);
      expect(letterOfPiece).toEqual([0, 1]);
      expect(letters.map((l) => l.line)).toEqual([0, 1]);
    });

    it("keeps a full stop on its own line, not on the capital under it (case 3)", () => {
      const { letterOfPiece, letters } = groupLetters([
        box(0, 6, 11, 25), // line one's capital
        box(20, 16, 23, 19), // its full stop
        box(20, 24, 31, 43), // line two's capital, under the full stop
      ]);
      expect(letterOfPiece).toEqual([0, 1, 2]);
      expect(letters.map((l) => l.line)).toEqual([0, 0, 1]);
    });
  });

  it("reads a colon beside letters as one letter of the line", () => {
    const { letterOfPiece, letters } = groupLetters([
      box(0, 4, 11, 23), // a capital
      box(16, 12, 19, 15), // colon's upper dot
      box(16, 20, 19, 23), // colon's lower dot
      box(24, 10, 35, 23), // a lower-case letter
    ]);
    expect(letterOfPiece).toEqual([0, 1, 1, 2]);
    expect(letters.every((l) => l.line === 0)).toBe(true);
  });

  it("is known to split a colon with no letter beside it (use labels): two lines", () => {
    const { letters } = groupLetters([
      box(16, 12, 19, 15),
      box(16, 20, 19, 23),
    ]);
    expect(letters).toHaveLength(2);
  });

  it("puts an italic j's dot, only partly over its stem, with the stem", () => {
    const { letterOfPiece, letters } = groupLetters([
      box(26, 3, 31, 6), // the dot, shifted right
      box(20, 10, 27, 35), // the stem, slanting, with its descender
    ]);
    expect(letterOfPiece).toEqual([0, 0]);
    expect(letters).toHaveLength(1);
  });
});

describe("distanceToOutline", () => {
  it("matches a brute-force search at random points, edges of the canvas included", () => {
    const random = mulberry32(17);
    const c = canvas(14, 11);
    c.rect(0, 0, 9, 6); // touches the top and left edges
    c.rect(5, 4, 9, 7); // touches the right and bottom edges
    c.rect(2, 8, 1, 1);
    const mask = thresholdMask(c.alpha, c.width, c.height);
    for (let n = 0; n < 2000; n += 1) {
      const x = random() * c.width;
      const y = random() * c.height;
      const want = bruteOutline(mask, x, y);
      const got = distanceToOutline(mask, x, y, 20);
      expect(got).toBeCloseTo(want, 12);
      // With a short reach it still finds anything within it, and nothing beyond.
      const short = distanceToOutline(mask, x, y, 1.5);
      if (want <= 1.5) expect(short).toBeCloseTo(want, 12);
      else expect(short).toBe(Infinity);
    }
  });

  it("finds an outside square exactly at the reach, on the low side too", () => {
    // 5 × 7, column 0 unset: from (2.5, 3.5) the outline is 1.5 away to the
    // left, and every canvas edge is further.
    const c = canvas(5, 7);
    c.rect(1, 0, 4, 7);
    const mask = thresholdMask(c.alpha, 5, 7);
    expect(distanceToOutline(mask, 2.5, 3.5, 1.5)).toBe(1.5);
    expect(distanceToOutline(mask, 2.5, 3.5, 1.4)).toBe(Infinity);
  });

  it("refuses a negative reach", () => {
    const mask = thresholdMask([255], 1, 1);
    expect(() => distanceToOutline(mask, 0.5, 0.5, -1)).toThrow(/limit/);
  });
});

describe("edge particles, measured from the particle", () => {
  it("marks a particle 1 px from the outline as an edge particle (pixel centres would say 1.5)", () => {
    const full = new Array(81).fill(255);
    const { particles } = sampleMask(full, 9, 9, {
      spacing: 2,
      jitter: 0,
      seed: 9,
      guessLetters: true,
      edgeWidth: 1.5,
    });
    const p = particles.find(
      (q) => q.x === 1 && Math.abs(q.y - 4.330127018922193) < 1e-9,
    );
    expect(p).toBeDefined();
    expect(p!.edge).toBe(true);
    const mask = thresholdMask(full, 9, 9);
    for (const q of particles) {
      expect(q.edge).toBe(bruteOutline(mask, q.x, q.y) <= 1.5);
    }
  });

  it("can tell two jittered particles in one pixel apart", () => {
    // Columns 0-5 set: the outline on the right is x = 6.
    const c = canvas(12, 12);
    c.rect(0, 0, 6, 12);
    const mask = thresholdMask(c.alpha, 12, 12);
    let split = 0;
    for (let seed = 1; seed <= 40 && split === 0; seed += 1) {
      const { particles } = sampleMask(c.alpha, 12, 12, {
        spacing: 1.2,
        jitter: 0.5,
        seed,
        guessLetters: true,
        edgeWidth: 1.4,
      });
      for (const q of particles) {
        expect(q.edge).toBe(bruteOutline(mask, q.x, q.y) <= 1.4);
      }
      // Two particles in pixel column 4, one nearer the outline than 1.4 and one not.
      const col4 = particles.filter(
        (q) => Math.floor(q.x) === 4 && q.y > 2 && q.y < 10,
      );
      if (col4.some((q) => q.edge) && col4.some((q) => !q.edge)) split += 1;
    }
    expect(split).toBe(1);
  });

  it("treats the canvas's edge as the outline when the letters touch it", () => {
    const { particles } = sampleMask(new Array(36).fill(255), 6, 6, {
      spacing: 1,
      jitter: 0,
      seed: 1,
      guessLetters: true,
      edgeWidth: 0.6,
    });
    for (const q of particles) {
      const border = Math.min(q.x, q.y, 6 - q.x, 6 - q.y);
      expect(q.edge).toBe(border <= 0.6);
    }
    expect(particles.some((q) => q.edge)).toBe(true);
    expect(particles.some((q) => !q.edge)).toBe(true);
  });
});

describe("sampleMask", () => {
  const c = twoLines();
  const options = { spacing: 2.5, seed: 9, guessLetters: true };
  const { particles, letters } = sampleMask(
    c.alpha,
    c.width,
    c.height,
    options,
  );
  const mask = thresholdMask(c.alpha, c.width, c.height);

  it("puts every particle inside the mask, on a hexagonal grid about `spacing` apart", () => {
    expect(particles.length).toBeGreaterThan(50);
    for (const p of particles) expect(maskAt(mask, p.x, p.y)).toBe(true);
    const area = mask.data.reduce((s, v) => s + v, 0);
    // One particle per hexagonal cell, √3/2 · spacing².
    const expected = area / ((Math.sqrt(3) / 2) * options.spacing ** 2);
    expect(particles.length).toBeGreaterThan(expected * 0.8);
    expect(particles.length).toBeLessThan(expected * 1.2);
  });

  it("sits exactly on the grid with no jitter: rows √3/2 spacing apart, every other row shifted half a spacing", () => {
    const flat = sampleMask(c.alpha, c.width, c.height, {
      ...options,
      jitter: 0,
    }).particles;
    const row = (options.spacing * Math.sqrt(3)) / 2;
    for (const p of flat) {
      const j = Math.round(p.y / row - 0.5);
      expect(p.y).toBeCloseTo((j + 0.5) * row, 9);
      const shift = j % 2 === 1 ? options.spacing / 2 : 0;
      const i = Math.round((p.x - shift) / options.spacing - 0.5);
      expect(p.x).toBeCloseTo((i + 0.5) * options.spacing + shift, 9);
    }
  });

  it("is reproducible, and another seed jitters differently", () => {
    expect(sampleMask(c.alpha, c.width, c.height, options).particles).toEqual(
      particles,
    );
    expect(
      sampleMask(c.alpha, c.width, c.height, { ...options, seed: 10 })
        .particles,
    ).not.toEqual(particles);
  });

  it("tells edge particles from inner ones by the particle's own distance to the outline", () => {
    const at = (p: { x: number; y: number }) => bruteOutline(mask, p.x, p.y);
    const edge = particles.filter((p) => p.edge);
    const inner = particles.filter((p) => !p.edge);
    expect(edge.length).toBeGreaterThan(0);
    expect(inner.length).toBeGreaterThan(0);
    for (const p of edge) expect(at(p)).toBeLessThanOrEqual(1.5);
    for (const p of inner) expect(at(p)).toBeGreaterThan(1.5);
    // A wider edge band takes in more of them.
    const wide = sampleMask(c.alpha, c.width, c.height, {
      ...options,
      edgeWidth: 3,
    }).particles.filter((p) => p.edge).length;
    expect(wide).toBeGreaterThan(edge.length);
  });

  it("orders them letter by letter in reading order, and left to right inside a letter", () => {
    expect(letters).toHaveLength(4);
    for (let i = 1; i < particles.length; i += 1) {
      expect(particles[i]!.order).toBeGreaterThanOrEqual(
        particles[i - 1]!.order,
      );
      expect(particles[i]!.letter).toBeGreaterThanOrEqual(
        particles[i - 1]!.letter,
      );
    }
    for (const p of particles) {
      expect(p.order).toBeGreaterThanOrEqual(p.letter / letters.length);
      expect(p.order).toBeLessThanOrEqual((p.letter + 1) / letters.length);
    }
    // Inside a letter, further right is later.
    const l = particles.filter((p) => p.letter === 2);
    for (let i = 0; i < l.length; i += 1) {
      for (let k = 0; k < l.length; k += 1) {
        if (l[i]!.x < l[k]!.x)
          expect(l[i]!.order).toBeLessThanOrEqual(l[k]!.order);
      }
    }
  });

  it("gives no particles and no letters for an empty mask", () => {
    const blank = canvas(20, 10);
    expect(sampleMask(blank.alpha, 20, 10, options)).toEqual({
      particles: [],
      letters: [],
    });
  });

  it("refuses spacing, jitter and edge widths that make no sense", () => {
    const go = (o: Partial<typeof options> & Record<string, number>) => () =>
      sampleMask(c.alpha, c.width, c.height, { ...options, ...o });
    expect(go({ spacing: 0 })).toThrow(/spacing/);
    expect(go({ spacing: Number.POSITIVE_INFINITY })).toThrow(/spacing/);
    expect(go({ jitter: 0.6 })).toThrow(/jitter/);
    expect(go({ jitter: -0.1 })).toThrow(/jitter/);
    expect(go({ edgeWidth: -1 })).toThrow(/edgeWidth/);
    expect(go({ edgeWidth: MAX_EDGE_WIDTH + 0.1 })).toThrow(/edgeWidth/);
    expect(go({ maxCount: -1 })).toThrow(/maxCount/);
    expect(() => sampleMask([1, 2], 3, 1, options)).toThrow(/values/);
  });
});

/** An alpha canvas and its letter labels, from rectangles tagged with their letter. */
function labelled(
  width: number,
  height: number,
  rects: readonly [
    x: number,
    y: number,
    w: number,
    h: number,
    letter: number,
  ][],
) {
  const alpha = new Uint8ClampedArray(width * height);
  const labels = new Uint16Array(width * height);
  for (const [x, y, w, h, letter] of rects) {
    for (let j = y; j < y + h; j += 1) {
      for (let i = x; i < x + w; i += 1) {
        alpha[j * width + i] = 255;
        labels[j * width + i] = letter + 1;
      }
    }
  }
  return { alpha, labels };
}

describe("letters from the caller's labels", () => {
  // Line one: "i." (dot and stem; a full stop). Line two: ":M" (two dots; a capital).
  const W = 60;
  const H = 60;
  const { alpha, labels } = labelled(W, H, [
    [4, 4, 6, 4, 0], // i's dot
    [4, 11, 6, 13, 0], // i's stem
    [14, 20, 4, 4, 1], // full stop
    [4, 36, 4, 4, 2], // colon, upper dot
    [4, 46, 4, 4, 2], // colon, lower dot
    [14, 30, 12, 20, 3], // M
  ]);
  const lines = [0, 0, 1, 1];
  const opts = { spacing: 1.5, seed: 4, letters: { labels, lines } };

  it("takes every letter and line from the labels: an i, a full stop, a colon, two lines", () => {
    const { particles, letters } = sampleMask(alpha, W, H, opts);
    expect(letters.map((l) => l.line)).toEqual([0, 0, 1, 1]);
    expect(letters[0]).toMatchObject({ x0: 4, y0: 4, x1: 9, y1: 23 });
    expect(letters[2]).toMatchObject({ x0: 4, y0: 36, x1: 7, y1: 49 });
    for (const p of particles) {
      const at = Math.floor(p.y) * W + Math.floor(p.x);
      expect(p.letter).toBe(labels[at]! - 1);
    }
    expect(new Set(particles.map((p) => p.letter))).toEqual(
      new Set([0, 1, 2, 3]),
    );
  });

  it("reads a lone colon as one letter, where shapes alone see two lines", () => {
    const lone = labelled(12, 30, [
      [4, 6, 4, 4, 0],
      [4, 16, 4, 4, 0],
    ]);
    const byLabel = sampleMask(lone.alpha, 12, 30, {
      spacing: 1,
      seed: 2,
      letters: { labels: lone.labels, lines: [0] },
    });
    expect(byLabel.letters).toHaveLength(1);
    expect(
      sampleMask(lone.alpha, 12, 30, {
        spacing: 1,
        seed: 2,
        guessLetters: true,
      }).letters,
    ).toHaveLength(2);
  });

  it("settles Codex's case 1 the way the labels say, whichever way they say it", () => {
    const rects = (dotLetter: number) =>
      labelled(40, 50, [
        [20, 6, 12, 14, 0], // line one's n
        [24, 22, 4, 4, dotLetter], // the dot between the lines
        [24, 30, 4, 14, 1], // line two's stem
      ]);
    for (const dot of [0, 1]) {
      const { alpha: a, labels: l } = rects(dot);
      const { particles } = sampleMask(a, 40, 50, {
        spacing: 1,
        seed: 1,
        letters: { labels: l, lines: [0, 1] },
      });
      const dotParticles = particles.filter((p) => p.y > 22 && p.y < 26);
      expect(dotParticles.length).toBeGreaterThan(0);
      for (const p of dotParticles) expect(p.letter).toBe(dot);
    }
  });

  it("gives the same letters and particles as the shapes do where the shapes are not in doubt", () => {
    const c = twoLines();
    const known = new Uint16Array(c.width * c.height);
    const tag = (x: number, y: number, w: number, h: number, k: number) => {
      for (let j = y; j < y + h; j += 1) {
        for (let i = x; i < x + w; i += 1) known[j * c.width + i] = k + 1;
      }
    };
    tag(4, 4, 6, 20, 0); // I
    tag(20, 4, 6, 4, 1); // i's dot
    tag(20, 11, 6, 13, 1); // i's stem
    tag(4, 34, 5, 20, 2); // L
    tag(4, 49, 14, 5, 2);
    tag(30, 34, 5, 20, 3); // L
    tag(30, 49, 14, 5, 3);
    const base = { spacing: 2.5, seed: 9 };
    const byShape = sampleMask(c.alpha, c.width, c.height, {
      ...base,
      guessLetters: true,
    });
    const byLabel = sampleMask(c.alpha, c.width, c.height, {
      ...base,
      letters: { labels: known, lines: [0, 0, 1, 1] },
    });
    expect(byLabel).toEqual(byShape);
  });

  it("lends an unlabelled edge pixel the nearest label within LABEL_REACH, and refuses one further out", () => {
    const { alpha: a, labels: l } = labelled(10, 5, [[0, 0, 4, 5, 0]]);
    const near = Uint8ClampedArray.from(a);
    near[2 * 10 + 5] = 255; // 2 px right of the letter, unlabelled
    const mask = thresholdMask(near, 10, 5);
    const { letterAt } = lettersFromLabels(mask, { labels: l, lines: [0] });
    expect(letterAt[2 * 10 + 5]).toBe(0);
    expect(LABEL_REACH).toBe(2);
    const far = Uint8ClampedArray.from(a);
    far[2 * 10 + 7] = 255; // 4 px away
    expect(() =>
      lettersFromLabels(thresholdMask(far, 10, 5), { labels: l, lines: [0] }),
    ).toThrow(/no letter is within/);
  });

  it("refuses labels that do not fit the mask or the letters", () => {
    const mask = thresholdMask(alpha, W, H);
    expect(() => lettersFromLabels(mask, { labels: [1, 2], lines })).toThrow(
      /one value per mask pixel/,
    );
    const tooBig = Uint16Array.from(labels);
    tooBig[0] = 9;
    expect(() => lettersFromLabels(mask, { labels: tooBig, lines })).toThrow(
      /a label is 0 to 4/,
    );
    expect(() =>
      lettersFromLabels(mask, { labels, lines: [0, 1, 0, 1] }),
    ).toThrow(/go back up/);
    expect(() =>
      lettersFromLabels(mask, { labels, lines: [0, 0, 1, 1, 1] }),
    ).toThrow(/letter 4 has no pixel/);
  });
});

describe("a hard limit on the count (maxCount, thinToCount, spacingForCount)", () => {
  it("never goes over: Codex's 100 × 100 at a budget of 11 (the spacing estimate alone gave 12)", () => {
    const full = new Array(100 * 100).fill(255);
    const spacing = spacingForCount(100 * 100, 11);
    const loose = sampleMask(full, 100, 100, {
      spacing,
      seed: 1,
      guessLetters: true,
    }).particles;
    const capped = sampleMask(full, 100, 100, {
      spacing,
      seed: 1,
      guessLetters: true,
      maxCount: 11,
    }).particles;
    expect(capped.length).toBe(Math.min(11, loose.length));
    expect(capped.length).toBeLessThanOrEqual(11);
  });

  it("holds a full 1440 × 260 headline band to a budget of 10,000", () => {
    const area = 1440 * 260;
    const full = new Uint8ClampedArray(area).fill(255);
    const { particles } = sampleMask(full, 1440, 260, {
      spacing: spacingForCount(area, 10_000),
      seed: 2,
      guessLetters: true,
      maxCount: 10_000,
    });
    expect(particles.length).toBeLessThanOrEqual(10_000);
    expect(particles.length).toBeGreaterThan(9_000);
  });

  const c = twoLines();
  const sampled = sampleMask(c.alpha, c.width, c.height, {
    spacing: 1.2,
    seed: 3,
    guessLetters: true,
  });

  it("keeps a particle in every letter when the budget allows one each, and spreads the rest fairly", () => {
    for (const max of [4, 5, 40, 200]) {
      const kept = thinToCount(sampled.particles, 4, max);
      expect(kept).toHaveLength(max);
      expect(new Set(kept.map((p) => p.letter))).toEqual(new Set([0, 1, 2, 3]));
    }
    // In proportion: each letter's share within one particle of its fair share.
    const max = 200;
    const kept = thinToCount(sampled.particles, 4, max);
    for (let k = 0; k < 4; k += 1) {
      const n = sampled.particles.filter((p) => p.letter === k).length;
      const fair = 1 + ((max - 4) * (n - 1)) / (sampled.particles.length - 4);
      const got = kept.filter((p) => p.letter === k).length;
      expect(Math.abs(got - fair)).toBeLessThan(1);
    }
  });

  it("shares what is left by largest remainder", () => {
    // 4 and 7 particles, 6 kept: one each, then 4 more shared 4·3/9 = 1.33
    // and 4·6/9 = 2.67: floors 1 and 2, the last one to the larger remainder.
    const synthetic = [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1].map((letter, i) => ({
      x: i,
      y: 0,
      edge: i % 2 === 0,
      letter,
      order: i / 11,
    }));
    const kept = thinToCount(synthetic, 2, 6);
    expect(kept.filter((p) => p.letter === 0)).toHaveLength(2);
    expect(kept.filter((p) => p.letter === 1)).toHaveLength(4);
  });

  it("with fewer than one each, keeps letters spread through the reading order", () => {
    const kept = thinToCount(sampled.particles, 4, 2);
    expect(kept.map((p) => p.letter)).toEqual([1, 3]);
    expect(thinToCount(sampled.particles, 4, 0)).toEqual([]);
  });

  it("is deterministic, keeps the reading order, and keeps the edge share", () => {
    const half = Math.floor(sampled.particles.length / 2);
    const a = thinToCount(sampled.particles, 4, half);
    expect(thinToCount(sampled.particles, 4, half)).toEqual(a);
    const index = a.map((p) => sampled.particles.indexOf(p));
    for (let i = 1; i < index.length; i += 1) {
      expect(index[i]).toBeGreaterThan(index[i - 1]!);
    }
    const share = (list: readonly { edge: boolean }[]) =>
      list.filter((p) => p.edge).length / list.length;
    expect(Math.abs(share(a) - share(sampled.particles))).toBeLessThan(0.02);
    // Not the first half: the last letter keeps about half of its particles.
    const last = (list: readonly { letter: number }[]) =>
      list.filter((p) => p.letter === 3).length;
    expect(last(a)).toBeGreaterThan(last(sampled.particles) * 0.45);
  });

  it("returns the particles unchanged when they fit, and refuses a bad limit", () => {
    expect(thinToCount(sampled.particles, 4, 1e6)).toEqual(sampled.particles);
    expect(() => thinToCount(sampled.particles, 4, 2.5)).toThrow(/maxCount/);
    expect(() => thinToCount(sampled.particles, 4, -1)).toThrow(/maxCount/);
  });

  it("estimates a spacing from area and count, and refuses nonsense", () => {
    expect(spacingForCount(Math.sqrt(3) / 2, 1)).toBeCloseTo(1, 12);
    expect(spacingForCount(400, 4)).toBeGreaterThan(spacingForCount(400, 9));
    expect(() => spacingForCount(0, 5)).toThrow(/area/);
    expect(() => spacingForCount(10, 0)).toThrow(/count/);
    expect(() => spacingForCount(10, 1.5)).toThrow(/count/);
  });

  it("gives a letter the grid misses one particle at its deepest pixel", () => {
    const small = canvas(30, 10);
    small.rect(0, 0, 20, 10);
    small.rect(25, 2, 1, 1); // a 1 px letter between the grid's places
    const { particles, letters } = sampleMask(small.alpha, 30, 10, {
      spacing: 6,
      jitter: 0,
      seed: 1,
      guessLetters: true,
    });
    expect(letters).toHaveLength(2);
    const tiny = particles.filter((p) => p.letter === 1);
    expect(tiny).toEqual([
      expect.objectContaining({ x: 25.5, y: 2.5, edge: true }),
    ]);
  });
});

describe("round 4: pinned behaviour", () => {
  const box = (x0: number, y0: number, x1: number, y1: number) => ({
    x0,
    y0,
    x1,
    y1,
    area: (x1 - x0 + 1) * (y1 - y0 + 1),
  });
  /** Particles of the given letters, edge where `edge(i)`, x = index. */
  const synthetic = (
    letters: readonly number[],
    edge: (i: number) => boolean = () => false,
  ) =>
    letters.map((letter, i) => ({
      x: i,
      y: 0,
      edge: edge(i),
      letter,
      order: i / letters.length,
    }));
  const counts = (kept: readonly { letter: number }[], n: number) =>
    Array.from(
      { length: n },
      (_, k) => kept.filter((p) => p.letter === k).length,
    );

  it("breaks an exact tie of remainders toward the earlier letter (5, 8 and 2 particles, keep 7)", () => {
    // One each leaves 4 to share over 4 + 7 + 1 = 12 beyond the first:
    // 4·4/12, 4·7/12, 4·1/12 = 1 r4, 2 r4, 0 r4 (all remainders 4/12).
    // Floors 1 + 2 + 0 = 3, one left, to the earliest letter: 1+1+1, 1+2, 1+0.
    const p = synthetic([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2]);
    expect(counts(thinToCount(p, 3, 7), 3)).toEqual([3, 3, 1]);
  });

  it("shares only what is beyond each letter's first particle, and never goes over", () => {
    // 2 and 2, keep 3: one each, 1 to share over 1 + 1 beyond: tie, earlier.
    const two = thinToCount(synthetic([0, 0, 1, 1]), 2, 3);
    expect(counts(two, 2)).toEqual([2, 1]);
    // 1, 1, 1 and 5, keep 6: one each, 2 to share; only the last letter has
    // any beyond its first (4), so it takes both.
    const four = thinToCount(synthetic([0, 1, 2, 3, 3, 3, 3, 3]), 4, 6);
    expect(counts(four, 4)).toEqual([1, 1, 1, 3]);
    expect(new Set(four).size).toBe(6);
  });

  it("picks evenly inside a letter: half of 20 inner particles is every other one, right half included", () => {
    const p = synthetic(new Array(20).fill(0));
    const kept = thinToCount(p, 1, 10);
    expect(kept.map((q) => q.x)).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19]);
  });

  it("keeps a letter's edge share rounded, not floored (7 of 10 on the edge, keep 5: 3.5 → 4)", () => {
    const p = synthetic(new Array(10).fill(0), (i) => i < 7);
    const kept = thinToCount(p, 1, 5);
    expect(kept.filter((q) => q.edge)).toHaveLength(4);
  });

  it("refuses a particle whose letter is outside letterCount, with a readable error", () => {
    const p = synthetic([0, 1, 2]);
    expect(() => thinToCount(p, 2, 1)).toThrow(/letter 2, outside 0 to 1/);
    expect(() => thinToCount(p, -1, 1)).toThrow(/letterCount/);
  });

  it("wants line numbers 0, 1, 2 … with none left out, and whole and not negative", () => {
    const one = labelled(6, 6, [
      [0, 0, 2, 2, 0],
      [3, 3, 2, 2, 1],
    ]);
    const mask = thresholdMask(one.alpha, 6, 6);
    const go = (lines: number[]) => () =>
      lettersFromLabels(mask, { labels: one.labels, lines });
    expect(go([0, 1])).not.toThrow();
    expect(go([0, 0])).not.toThrow();
    expect(go([3, 7])).toThrow(/no line left out/);
    expect(go([0, 2])).toThrow(/no line left out/);
    expect(go([1, 1])).toThrow(/no line left out/);
    expect(go([0.5, 1])).toThrow(/whole number/);
    expect(go([-1, 0])).toThrow(/whole number/);
  });

  it("lends an unlabelled pixel the label at the shortest straight-line distance", () => {
    // Pixel (2, 2) is set but unlabelled: letter 0 at (1, 1) is √2 away,
    // letter 1 at (3, 2) is 1 away. A square ring scan meets (1, 1) first.
    const alpha = new Uint8ClampedArray(25);
    const labels = new Uint16Array(25);
    alpha[1 * 5 + 1] = 255;
    labels[1 * 5 + 1] = 1;
    alpha[2 * 5 + 3] = 255;
    labels[2 * 5 + 3] = 2;
    alpha[2 * 5 + 2] = 255;
    const { letterAt } = lettersFromLabels(thresholdMask(alpha, 5, 5), {
      labels,
      lines: [0, 0],
    });
    expect(letterAt[2 * 5 + 2]).toBe(1);
  });

  it("never lends a lent label on: a run of unlabelled pixels ends at LABEL_REACH", () => {
    // Letter in columns 0-3; unlabelled set pixels at x = 4, 5, 6 on row 2.
    const { alpha, labels } = labelled(10, 5, [[0, 0, 4, 5, 0]]);
    const run = Uint8ClampedArray.from(alpha);
    run[2 * 10 + 4] = 255;
    run[2 * 10 + 5] = 255;
    expect(() =>
      lettersFromLabels(thresholdMask(run, 10, 5), { labels, lines: [0] }),
    ).not.toThrow();
    run[2 * 10 + 6] = 255; // 3 px from the letter
    expect(() =>
      lettersFromLabels(thresholdMask(run, 10, 5), { labels, lines: [0] }),
    ).toThrow(/pixel \(6, 2\)/);
  });

  it("caps edgeWidth at 16 px exactly", () => {
    expect(MAX_EDGE_WIDTH).toBe(16);
    const full = new Array(400).fill(255);
    const at = (edgeWidth: number) => () =>
      sampleMask(full, 20, 20, {
        spacing: 4,
        seed: 1,
        edgeWidth,
        guessLetters: true,
      });
    expect(at(16)).not.toThrow();
    expect(at(17)).toThrow(/edgeWidth is 0 to 16 px/);
  });

  it("adds a fallback particle only to a letter the grid missed, one at most, and still keeps maxCount", () => {
    const opts = { spacing: 6, jitter: 0, seed: 1, guessLetters: true };
    const big = canvas(30, 10);
    big.rect(0, 0, 20, 10);
    const alone = sampleMask(big.alpha, 30, 10, opts).particles;
    const both = canvas(30, 10);
    both.rect(0, 0, 20, 10);
    both.rect(25, 2, 1, 1);
    const withTiny = sampleMask(both.alpha, 30, 10, opts).particles;
    expect(withTiny.filter((p) => p.letter === 0)).toHaveLength(alone.length);
    expect(withTiny.filter((p) => p.letter === 1)).toHaveLength(1);
    const capped = sampleMask(both.alpha, 30, 10, { ...opts, maxCount: 3 });
    expect(capped.particles).toHaveLength(3);
    expect(new Set(capped.particles.map((p) => p.letter))).toEqual(
      new Set([0, 1]),
    );
  });

  it("refuses to guess the letters unless told to, and refuses both at once", () => {
    const c = twoLines();
    expect(() =>
      sampleMask(c.alpha, c.width, c.height, { spacing: 2, seed: 1 }),
    ).toThrow(/needs the letters/);
    const labels = new Uint16Array(c.width * c.height);
    expect(() =>
      sampleMask(c.alpha, c.width, c.height, {
        spacing: 2,
        seed: 1,
        guessLetters: true,
        letters: { labels, lines: [0] },
      }),
    ).toThrow(/not both/);
  });

  it("gives a mark that shares as many rows with two lines to the upper one, whichever line is bigger", () => {
    // Line A rows 0-19 and line B rows 16-35 (4 rows apart in overlap); the
    // mark at rows 16-19 shares 4 rows with each, and could be the dot of
    // B's stem C (rows 22-35) under it.
    const run = (aWide: boolean) =>
      groupLetters([
        box(0, 0, aWide ? 40 : 11, 19), // line A's body
        box(50, 16, aWide ? 61 : 90, 35), // line B's body
        box(20, 16, 23, 19), // the mark
        box(20, 22, 23, 35), // C, line B
      ]);
    for (const aWide of [true, false]) {
      const { letters, letterOfPiece } = run(aWide);
      expect(letters[letterOfPiece[2]!]!.line).toBe(0);
    }
  });

  it("reads an italic colon (dots three-quarters over each other) beside letters as one letter", () => {
    const { letterOfPiece } = groupLetters([
      box(0, 4, 11, 23),
      box(17, 12, 20, 15),
      box(16, 20, 19, 23),
      box(26, 10, 37, 23),
    ]);
    expect(letterOfPiece).toEqual([0, 1, 1, 2]);
  });
});
