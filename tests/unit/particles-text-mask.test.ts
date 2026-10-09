import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/particles/random";
import {
  MARK_RULES,
  type Mask,
  depthInside,
  dilateMask,
  distanceToOutline,
  groupLetters,
  labelPieces,
  markGap,
  maskAt,
  sampleMask,
  sitsOnBaseline,
  squaredDistanceTo,
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
    expect(sitsOnBaseline(top[4]!, [...top, ...bottom])).toBe(true);
    expect(sitsOnBaseline(top[1]!, [...top, ...bottom])).toBe(false);
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
    // more than 1.5 dot heights; 6 rows is within 1.5 heights of a 7-row mark
    // but more than 0.4 of a 12-row host.
    expect(markGap(box(20, 0, 25, 3), box(20, 11, 25, 30))).toBe(-1);
    expect(markGap(box(20, 4, 25, 7), box(20, 11, 25, 30))).toBe(3);
    expect(markGap(box(0, 0, 5, 6), box(0, 13, 5, 24))).toBe(-1);
    expect(markGap(box(0, 0, 5, 6), box(0, 10, 5, 24))).toBe(3);
    // Beside it, not over it.
    expect(markGap(box(30, 4, 35, 7), stem)).toBe(-1);
    // Sharing a row: a neighbour in the line, not a mark.
    expect(markGap(box(20, 9, 25, 12), stem)).toBe(-1);
    // Too big to be a mark of this host.
    expect(markGap(box(20, 0, 25, 9), stem)).toBe(-1);
    // A mark is never a host of a bigger piece.
    expect(markGap(stem, box(20, 4, 25, 7))).toBe(-1);
    expect(MARK_RULES.size).toBeLessThan(1);
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
  const options = { spacing: 2.5, seed: 9 };
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
    expect(() => sampleMask([1, 2], 3, 1, options)).toThrow(/values/);
  });
});
