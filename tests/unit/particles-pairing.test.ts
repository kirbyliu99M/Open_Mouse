import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTargets } from "@/lib/particles/load-targets";
import {
  MOUSE_COUNT,
  buildPairing,
  groupByRank,
  pairTargets,
  sortByX,
  splitIntoGroups,
} from "@/lib/particles/pairing";
import { mulberry32 } from "@/lib/particles/random";
import type { TargetPoint } from "@/lib/particles/sampling";
import { ARTIFACT_PATHS } from "@/lib/particles/artifacts";
import { serializeTargets } from "@/lib/particles/targets";

const committed = readFileSync(ARTIFACT_PATHS.targets, "utf8");
const targets = parseTargets(JSON.parse(committed));

const randomPoints = (n: number, seed: number): TargetPoint[] => {
  const random = mulberry32(seed);
  return Array.from({ length: n }, () => ({
    x: Math.round(random() * 400) / 2,
    y: Math.round(random() * 400) / 2,
    tone: random() < 0.3 ? 1 : 0,
  }));
};

describe("the committed targets file", () => {
  it("reads back into typed point lists, and writes out as the same file", () => {
    expect(serializeTargets(targets)).toBe(committed);
    expect(targets.logo.points.length).toBeGreaterThan(100);
    expect(targets.hand.landmarks).toHaveLength(21);
    expect(Object.keys(targets.mice)).toContain("g-pro-sketch");
  });

  it("refuses a file that is not what the generator writes", () => {
    const raw = JSON.parse(committed);
    expect(() => parseTargets({ ...raw, version: 2 })).toThrow(/version 1/);
    expect(() => parseTargets(null)).toThrow(/version 1/);
    expect(() =>
      parseTargets({ ...raw, logo: { ...raw.logo, points: [[1, 2, 3]] } }),
    ).toThrow(/tone/);
    expect(() =>
      parseTargets({ ...raw, hand: { ...raw.hand, landmarks: [] } }),
    ).toThrow(/21 landmarks/);
  });
});

describe("sortByX", () => {
  it("orders by x, then y, and keeps equal points in their order; the input is untouched", () => {
    const a = { x: 5, y: 1, tone: 0 as const, id: "a" };
    const b = { x: 2, y: 9, tone: 1 as const, id: "b" };
    const c = { x: 5, y: 1, tone: 1 as const, id: "c" };
    const d = { x: 5, y: 0, tone: 0 as const, id: "d" };
    const input = [a, b, c, d];
    expect(sortByX(input).map((p) => p.id)).toEqual(["b", "d", "a", "c"]);
    expect(input.map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("splitIntoGroups", () => {
  it("splits by rank into equal groups: the lowest third of y is group 0", () => {
    const points = randomPoints(300, 11);
    const groups = splitIntoGroups(points, 3, "y");
    expect(groups.map((g) => g.length)).toEqual([100, 100, 100]);
    const maxOf = (g: TargetPoint[]) => Math.max(...g.map((p) => p.y));
    const minOf = (g: TargetPoint[]) => Math.min(...g.map((p) => p.y));
    expect(maxOf(groups[0]!)).toBeLessThanOrEqual(minOf(groups[1]!));
    expect(maxOf(groups[1]!)).toBeLessThanOrEqual(minOf(groups[2]!));
    // Every point is in exactly one group.
    expect(new Set(groups.flat()).size).toBe(300);
  });

  it("by x puts the left third first", () => {
    const groups = splitIntoGroups(randomPoints(90, 4), 3, "x");
    expect(Math.max(...groups[0]!.map((p) => p.x))).toBeLessThanOrEqual(
      Math.min(...groups[1]!.map((p) => p.x)),
    );
    expect(Math.max(...groups[1]!.map((p) => p.x))).toBeLessThanOrEqual(
      Math.min(...groups[2]!.map((p) => p.x)),
    );
  });

  it("keeps the input order inside a group, and breaks ties the same way every time", () => {
    const points = Array.from({ length: 6 }, (_, i) => ({
      x: i,
      y: 5,
      tone: 0 as const,
    }));
    // All y equal: the tie is broken by x, so the first two points are group 0.
    expect(groupByRank(points, 3, "y")).toEqual([0, 0, 1, 1, 2, 2]);
    expect(groupByRank(points, 3, "y")).toEqual(groupByRank(points, 3, "y"));
  });

  it("refuses a count that does not divide evenly", () => {
    expect(() => splitIntoGroups(randomPoints(10, 1), 3, "y")).toThrow(
      RangeError,
    );
    expect(() => splitIntoGroups(randomPoints(9, 1), 0, "y")).toThrow(
      RangeError,
    );
  });
});

describe("pairTargets", () => {
  const count = 90;
  const logo = randomPoints(count, 1);
  const hand = randomPoints(count, 2);
  const mice = [3, 4, 5].map((seed) => randomPoints(count / 3, seed));

  it("sorts the logo and the hand by x and pairs them by index", () => {
    const pairing = pairTargets(logo, hand, mice, "stacked");
    expect(pairing.count).toBe(count);
    expect(pairing.logo).toEqual(sortByX(logo));
    expect(pairing.hand).toEqual(sortByX(hand));
    for (let i = 1; i < count; i += 1) {
      expect(pairing.logo[i]!.x).toBeGreaterThanOrEqual(pairing.logo[i - 1]!.x);
      expect(pairing.hand[i]!.x).toBeGreaterThanOrEqual(pairing.hand[i - 1]!.x);
    }
  });

  it("stacked: the hand's top third goes to mouse 0, the middle to 1, the bottom to 2", () => {
    const pairing = pairTargets(logo, hand, mice, "stacked");
    const ys = [0, 1, 2].map((slot) =>
      pairing.hand.filter((_, i) => pairing.slot[i] === slot).map((p) => p.y),
    );
    expect(ys.map((g) => g.length)).toEqual([30, 30, 30]);
    expect(Math.max(...ys[0]!)).toBeLessThanOrEqual(Math.min(...ys[1]!));
    expect(Math.max(...ys[1]!)).toBeLessThanOrEqual(Math.min(...ys[2]!));
  });

  it("row: the hand's left third goes to mouse 0, the middle to 1, the right to 2", () => {
    const pairing = pairTargets(logo, hand, mice, "row");
    const xs = [0, 1, 2].map((slot) =>
      pairing.hand.filter((_, i) => pairing.slot[i] === slot).map((p) => p.x),
    );
    expect(xs.map((g) => g.length)).toEqual([30, 30, 30]);
    expect(Math.max(...xs[0]!)).toBeLessThanOrEqual(Math.min(...xs[1]!));
    expect(Math.max(...xs[1]!)).toBeLessThanOrEqual(Math.min(...xs[2]!));
  });

  it("inside a group, the k-th hand point by x meets the k-th point of its mouse by x", () => {
    for (const layout of ["stacked", "row"] as const) {
      const pairing = pairTargets(logo, hand, mice, layout);
      for (let slot = 0; slot < MOUSE_COUNT; slot += 1) {
        const ends = pairing.mouse.filter((_, i) => pairing.slot[i] === slot);
        expect(ends).toEqual(sortByX(mice[slot]!));
      }
    }
  });

  it("uses every point of every mouse exactly once", () => {
    const pairing = pairTargets(logo, hand, mice, "stacked");
    expect(pairing.mouse).toHaveLength(count);
    for (let slot = 0; slot < MOUSE_COUNT; slot += 1) {
      const used = pairing.mouse.filter((_, i) => pairing.slot[i] === slot);
      expect([...used].sort((a, b) => a.x - b.x || a.y - b.y)).toEqual(
        [...mice[slot]!].sort((a, b) => a.x - b.x || a.y - b.y),
      );
    }
  });

  it("refuses lists that do not fit: a wrong count, or other than three mice", () => {
    expect(() => pairTargets(logo, hand.slice(1), mice, "row")).toThrow(
      RangeError,
    );
    expect(() => pairTargets(logo, hand, mice.slice(1), "row")).toThrow(
      /expected 3/,
    );
    expect(() =>
      pairTargets(logo, hand, [mice[0]!, mice[1]!, mice[2]!.slice(1)], "row"),
    ).toThrow(RangeError);
  });
});

describe("buildPairing on the real targets", () => {
  const sketch = ["g-pro-sketch", "g-pro-sketch", "g-pro-sketch"];

  for (const [layout, count] of [
    ["stacked", 900],
    ["row", 1299],
    ["stacked", 450],
    ["row", 648],
  ] as const) {
    it(`${layout}, ${count} particles: every list has the budget's count, a third of it per mouse`, () => {
      const pairing = buildPairing(targets, {
        count,
        layout,
        seed: 7,
        mice: sketch,
      });
      expect(pairing.logo).toHaveLength(count);
      expect(pairing.hand).toHaveLength(count);
      expect(pairing.mouse).toHaveLength(count);
      for (let slot = 0; slot < MOUSE_COUNT; slot += 1) {
        expect(pairing.slot.filter((s) => s === slot)).toHaveLength(count / 3);
      }
    });
  }

  it("the same seed gives the same pairing, another seed a different one", () => {
    const options = {
      count: 900,
      layout: "stacked",
      seed: 7,
      mice: sketch,
    } as const;
    expect(buildPairing(targets, options)).toEqual(
      buildPairing(targets, options),
    );
    // The logo has fewer points than the budget, so the extra copies are nudged by the seed.
    const other = buildPairing(targets, { ...options, seed: 8 });
    expect(other.logo).not.toEqual(buildPairing(targets, options).logo);
  });

  it("stacked: mouse 0 takes the hand's fingers (the smallest y), mouse 2 the palm and wrist", () => {
    const pairing = buildPairing(targets, {
      count: 900,
      layout: "stacked",
      seed: 7,
      mice: sketch,
    });
    const meanY = (slot: number) => {
      const ys = pairing.hand
        .filter((_, i) => pairing.slot[i] === slot)
        .map((p) => p.y);
      return ys.reduce((a, b) => a + b, 0) / ys.length;
    };
    expect(meanY(0)).toBeLessThan(meanY(1));
    expect(meanY(1)).toBeLessThan(meanY(2));
  });

  it("refuses a count that is not a multiple of three, and a sketch that does not exist", () => {
    expect(() =>
      buildPairing(targets, {
        count: 100,
        layout: "row",
        seed: 1,
        mice: sketch,
      }),
    ).toThrow(/multiple of three/);
    expect(() =>
      buildPairing(targets, {
        count: 99,
        layout: "row",
        seed: 1,
        mice: ["nope", "nope", "nope"],
      }),
    ).toThrow(/no sketch named nope/);
  });
});
