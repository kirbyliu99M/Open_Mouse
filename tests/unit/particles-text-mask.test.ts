import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/particles/random";
import {
  type Mask,
  depthInside,
  dilateMask,
  groupLetters,
  labelPieces,
  maskAt,
  sampleMask,
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

  it("has nothing to read in an empty mask", () => {
    expect(groupLetters([])).toEqual({ letters: [], letterOfPiece: [] });
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

  it("tells edge particles from inner ones by their distance to the outline", () => {
    const depth = depthInside(mask);
    const at = (p: { x: number; y: number }) =>
      depth[Math.floor(p.y) * c.width + Math.floor(p.x)]!;
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
