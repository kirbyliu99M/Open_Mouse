import { describe, expect, it } from "vitest";
import { type Vec, distance } from "@/lib/particles/geometry";
import {
  METEOR,
  METEOR_LAYOUT,
  type Rect,
  STAR_CLASSES,
  STAR_COUNTS,
  TRAIL,
  inRect,
  meteorSegments,
  placeMeteors,
  placeStars,
  segmentHitsRect,
  smoothSpeed,
  tailDirection,
  trailScale,
} from "@/lib/particles/starfield";

const W = 1440;
const H = 900;
/** Roughly the v17 desktop hero: the headline band, the hand's box, the two buttons. */
const AVOID: Rect[] = [
  { x: 360, y: 400, width: 720, height: 120 },
  { x: 420, y: 60, width: 600, height: 540 },
  { x: 512, y: 690, width: 416, height: 56 },
];

describe("placeStars", () => {
  const options = { width: W, height: H, seed: 4, counts: STAR_COUNTS.desktop };
  const stars = placeStars(options);

  it("places the frames' counts, class by class, inside the sky", () => {
    expect(stars).toHaveLength(330);
    STAR_COUNTS.desktop.forEach((n, cls) => {
      expect(stars.filter((s) => s.cls === cls)).toHaveLength(n);
    });
    for (const s of stars) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(W);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThan(H);
    }
    expect(STAR_COUNTS.mobile.reduce((a, b) => a + b, 0)).toBe(130);
  });

  it("is reproducible, and another seed gives another sky", () => {
    expect(placeStars(options)).toEqual(stars);
    expect(placeStars({ ...options, seed: 5 })).not.toEqual(stars);
  });

  it("keeps every star out of the avoided rectangles and their padding", () => {
    const sky = placeStars({ ...options, avoid: AVOID, padding: 8 });
    expect(sky.length).toBeGreaterThan(300);
    for (const s of sky) {
      for (const r of AVOID) {
        expect(
          inRect(
            {
              x: r.x - 8,
              y: r.y - 8,
              width: r.width + 16,
              height: r.height + 16,
            },
            s.x,
            s.y,
          ),
        ).toBe(false);
      }
    }
  });

  it("leaves a star out rather than put it in the way", () => {
    expect(
      placeStars({
        ...options,
        avoid: [{ x: -10, y: -10, width: W + 20, height: H + 20 }],
      }),
    ).toEqual([]);
  });

  it("refuses a sky with no size, a fifth class, and counts that are not whole", () => {
    expect(() => placeStars({ ...options, width: 0 })).toThrow(/width/);
    expect(() => placeStars({ ...options, counts: [1, 1, 1, 1, 1] })).toThrow(
      /classes/,
    );
    expect(() => placeStars({ ...options, counts: [1.5] })).toThrow(/whole/);
    expect(() => placeStars({ ...options, counts: [-1] })).toThrow(/whole/);
  });

  it("has four classes, each bigger than the last", () => {
    expect(STAR_CLASSES).toHaveLength(4);
    for (let i = 1; i < STAR_CLASSES.length; i += 1) {
      expect(STAR_CLASSES[i]!.px).toBeGreaterThan(STAR_CLASSES[i - 1]!.px);
    }
  });
});

describe("segmentHitsRect", () => {
  const r: Rect = { x: 10, y: 10, width: 10, height: 10 };

  it("sees a segment crossing, inside, touching or missing a rectangle", () => {
    expect(segmentHitsRect([0, 15], [30, 15], r)).toBe(true);
    expect(segmentHitsRect([12, 12], [13, 13], r)).toBe(true);
    expect(segmentHitsRect([0, 10], [5, 10], r)).toBe(false);
    expect(segmentHitsRect([0, 0], [10, 10], r)).toBe(true);
    expect(segmentHitsRect([0, 0], [30, 5], r)).toBe(false);
    expect(segmentHitsRect([25, 0], [25, 30], r)).toBe(false);
    expect(segmentHitsRect([0, 30], [30, 0], r)).toBe(true);
    // Passing a corner: inside the x band and inside the y band, but never both at once.
    expect(segmentHitsRect([0, 12], [12, 0], r)).toBe(false);
    expect(segmentHitsRect([12, 0], [0, 12], r)).toBe(false);
  });
});

describe("the meteors", () => {
  const options = {
    width: W,
    height: H,
    seed: 2,
    count: METEOR_LAYOUT.desktop.count,
    length: METEOR_LAYOUT.desktop.length,
    avoid: AVOID,
  };
  const meteors = placeMeteors(options);

  it("travel about 40° below the horizontal, down and to the left: the tail runs up and right from the head", () => {
    const [dx, dy] = tailDirection();
    expect(Math.hypot(dx, dy)).toBeCloseTo(1, 12);
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeLessThan(0);
    expect((Math.atan2(-dy, dx) * 180) / Math.PI).toBeCloseTo(
      METEOR.angleDeg,
      9,
    );
  });

  it("are placed with lengths in range, reproducibly", () => {
    expect(meteors.length).toBeGreaterThan(10);
    expect(meteors.length).toBeLessThanOrEqual(options.count);
    for (const m of meteors) {
      expect(m.length).toBeGreaterThanOrEqual(110);
      expect(m.length).toBeLessThanOrEqual(295);
    }
    expect(placeMeteors(options)).toEqual(meteors);
  });

  it("never cross an avoided rectangle, even with the longest tail scrolling can give them", () => {
    for (const m of meteors) {
      for (const seg of meteorSegments(m, TRAIL.max)) {
        for (const r of AVOID)
          expect(segmentHitsRect(seg.from, seg.to, r)).toBe(false);
      }
    }
  });

  it("refuse a count or a length range that makes no sense", () => {
    expect(() => placeMeteors({ ...options, count: -1 })).toThrow(/count/);
    expect(() => placeMeteors({ ...options, length: [0, 10] })).toThrow(
      /length/,
    );
    expect(() => placeMeteors({ ...options, length: [50, 10] })).toThrow(
      /length/,
    );
    expect(() => placeMeteors({ ...options, height: -5 })).toThrow(/height/);
  });

  it("draw as four touching quarters from the far end to the head, brighter and wider toward the head", () => {
    const m = { head: [300, 700] as Vec, length: 200 };
    const segs = meteorSegments(m);
    expect(segs).toHaveLength(4);
    expect(segs[3]!.to).toEqual(m.head);
    for (let i = 1; i < segs.length; i += 1) {
      expect(distance(segs[i]!.from, segs[i - 1]!.to)).toBeLessThan(1e-9);
      expect(segs[i]!.alpha).toBeGreaterThan(segs[i - 1]!.alpha);
      expect(segs[i]!.width).toBeGreaterThan(segs[i - 1]!.width);
    }
    expect(distance(segs[0]!.from, m.head)).toBeCloseTo(200, 9);
    expect(distance(meteorSegments(m, 1.5)[0]!.from, m.head)).toBeCloseTo(
      300,
      9,
    );
    // A bad scale draws the rest length.
    expect(meteorSegments(m, Number.NaN)).toEqual(segs);
    expect(meteorSegments(m, -2)).toEqual(segs);
  });
});

describe("trailScale and smoothSpeed", () => {
  it("is 1 at a standstill and TRAIL.max at full speed and beyond, either way", () => {
    expect(trailScale(0)).toBe(1);
    expect(trailScale(TRAIL.fullSpeed)).toBe(TRAIL.max);
    expect(trailScale(TRAIL.fullSpeed * 3)).toBe(TRAIL.max);
    expect(trailScale(-800)).toBe(trailScale(800));
    expect(trailScale(Number.NaN)).toBe(1);
    expect(trailScale(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("only grows with speed", () => {
    let last = 0;
    for (let v = 0; v <= TRAIL.fullSpeed * 1.5; v += 50) {
      const s = trailScale(v);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });

  it("smooths the scroll speed toward a steady pace, and holds it when no time passes", () => {
    let v = 0;
    for (let i = 0; i < 60; i += 1) v = smoothSpeed(v, 20, 16);
    expect(v).toBeCloseTo(1250, 0);
    expect(smoothSpeed(500, 40, 0)).toBe(500);
    expect(smoothSpeed(Number.NaN, 0, 16)).toBe(0);
    // One step moves part of the way, never past the new pace.
    const one = smoothSpeed(0, 20, 16);
    expect(one).toBeGreaterThan(0);
    expect(one).toBeLessThan(1250);
    expect(smoothSpeed(0, 40, 16)).toBeGreaterThan(one);
    // The step is 1 - e^(-dt/tau) of the gap: a longer time constant moves less.
    expect(one).toBeCloseTo(1250 * (1 - Math.exp(-16 / 120)), 9);
    expect(smoothSpeed(0, 20, 16, 1000)).toBeLessThan(
      smoothSpeed(0, 20, 16, 50),
    );
  });
});

describe("round 5: the documented shapes", () => {
  const rect: Rect = { x: 80, y: 80, width: 40, height: 40 };
  const grown = (pad: number): Rect => ({
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + 2 * pad,
    height: rect.height + 2 * pad,
  });

  it("keeps stars 6 px clear by default, and as far as a padding given", () => {
    const sky = {
      width: 200,
      height: 200,
      seed: 7,
      counts: [3000],
      avoid: [rect],
    };
    const byDefault = placeStars(sky);
    expect(byDefault.length).toBeGreaterThan(2500);
    for (const s of byDefault)
      expect(inRect(grown(5.99), s.x, s.y)).toBe(false);
    // Without padding, stars would sit in that 6 px band.
    expect(
      placeStars({ ...sky, padding: 0 }).some((s) =>
        inRect(grown(5.99), s.x, s.y),
      ),
    ).toBe(true);
    for (const s of placeStars({ ...sky, padding: 20 })) {
      expect(inRect(grown(19.99), s.x, s.y)).toBe(false);
    }
  });

  it("keeps every meteor's longest tail 6 px clear by default", () => {
    const options = {
      width: 300,
      height: 300,
      seed: 5,
      count: 400,
      length: [20, 40] as const,
      avoid: [rect],
    };
    const meteors = placeMeteors(options);
    expect(meteors.length).toBeGreaterThan(200);
    for (const m of meteors) {
      for (const seg of meteorSegments(m, TRAIL.max)) {
        expect(segmentHitsRect(seg.from, seg.to, grown(5.99))).toBe(false);
      }
    }
    const tight = placeMeteors({ ...options, padding: 0 });
    expect(
      tight.some((m) =>
        meteorSegments(m, TRAIL.max).some((seg) =>
          segmentHitsRect(seg.from, seg.to, grown(5.99)),
        ),
      ),
    ).toBe(true);
  });

  it("rises faster than a straight line at first, then flattens (above the line at half speed)", () => {
    const half = trailScale(TRAIL.fullSpeed / 2);
    expect(half).toBeGreaterThan(1 + (TRAIL.max - 1) / 2);
    expect(half).toBeLessThan(TRAIL.max);
    // Flattening: the last tenth of the speed adds less than the first tenth.
    const first = trailScale(TRAIL.fullSpeed / 10) - 1;
    const last = TRAIL.max - trailScale((TRAIL.fullSpeed * 9) / 10);
    expect(last).toBeLessThan(first);
  });
});
