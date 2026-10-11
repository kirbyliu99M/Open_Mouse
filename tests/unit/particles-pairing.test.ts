import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { finaleShape, finaleSlotName } from "@/lib/particles/finale-shape";
import { parseFinaleTargets } from "@/lib/particles/load-finale";
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
  // Since the finale (2026-10-11) the last state is one drawing: MOUSE_COUNT
  // is 1 and every particle ends on slot 0.
  const count = 90;
  const logo = randomPoints(count, 1);
  const hand = randomPoints(count, 2);
  const mice = [randomPoints(count, 3)];

  it("the last state is one drawing", () => {
    expect(MOUSE_COUNT).toBe(1);
  });

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

  it("every particle ends on the one drawing, the k-th hand point by x on its k-th point by x, in both layouts", () => {
    for (const layout of ["stacked", "row"] as const) {
      const pairing = pairTargets(logo, hand, mice, layout);
      expect(pairing.slot.every((s) => s === 0)).toBe(true);
      expect(pairing.mouse).toEqual(sortByX(mice[0]!));
    }
  });

  it("uses every point of the drawing exactly once", () => {
    const pairing = pairTargets(logo, hand, mice, "stacked");
    expect(pairing.mouse).toHaveLength(count);
    expect([...pairing.mouse].sort((a, b) => a.x - b.x || a.y - b.y)).toEqual(
      [...mice[0]!].sort((a, b) => a.x - b.x || a.y - b.y),
    );
  });

  it("refuses lists that do not fit: a wrong count, or other than one last drawing", () => {
    expect(() => pairTargets(logo, hand.slice(1), mice, "row")).toThrow(
      RangeError,
    );
    expect(() => pairTargets(logo, hand, [...mice, ...mice], "row")).toThrow(
      /expected 1/,
    );
    expect(() => pairTargets(logo, hand, [], "row")).toThrow(/expected 1/);
    expect(() => pairTargets(logo, hand, [mice[0]!.slice(1)], "row")).toThrow(
      RangeError,
    );
  });
});

describe("buildPairing on the real targets", () => {
  const finale = parseFinaleTargets(
    JSON.parse(readFileSync(ARTIFACT_PATHS.finale, "utf8")),
  );
  const withFinale = {
    ...targets,
    mice: {
      ...targets.mice,
      [finaleSlotName("desktop")]: finaleShape(finale, "desktop"),
      [finaleSlotName("mobile")]: finaleShape(finale, "mobile"),
    },
  };
  const sketch = [finaleSlotName("mobile")];

  for (const [layout, count, density] of [
    ["stacked", 900, "sparse"],
    ["row", 1299, "sparse"],
    ["stacked", 451, "sparse"],
    ["row", 6000, "dense"],
  ] as const) {
    it(`${layout}, ${count} particles (${density}): every list has the budget's count, all on the finale`, () => {
      const pairing = buildPairing(withFinale, {
        count,
        layout,
        seed: 7,
        mice: layout === "row" ? [finaleSlotName("desktop")] : sketch,
        density,
      });
      expect(pairing.logo).toHaveLength(count);
      expect(pairing.hand).toHaveLength(count);
      expect(pairing.mouse).toHaveLength(count);
      expect(pairing.slot.every((s) => s === 0)).toBe(true);
      // Every end lies on the drawing (its viewBox, moved to start at 0, 0).
      for (const p of pairing.mouse) {
        expect(p.x).toBeGreaterThanOrEqual(-2);
        expect(p.x).toBeLessThanOrEqual(finale.viewBox.width + 2);
        expect(p.y).toBeGreaterThanOrEqual(-2);
        expect(p.y).toBeLessThanOrEqual(finale.viewBox.height + 2);
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
    expect(buildPairing(withFinale, options)).toEqual(
      buildPairing(withFinale, options),
    );
    // The logo has fewer points than the budget, so the extra copies are nudged by the seed.
    const other = buildPairing(withFinale, { ...options, seed: 8 });
    expect(other.logo).not.toEqual(buildPairing(withFinale, options).logo);
  });

  it("refuses a count that is not a positive whole number, more than one drawing, and a sketch that does not exist", () => {
    expect(() =>
      buildPairing(withFinale, {
        count: 0,
        layout: "row",
        seed: 1,
        mice: sketch,
      }),
    ).toThrow(/multiple of 1/);
    expect(() =>
      buildPairing(withFinale, {
        count: 99,
        layout: "row",
        seed: 1,
        mice: [...sketch, ...sketch],
      }),
    ).toThrow(/expected 1/);
    expect(() =>
      buildPairing(withFinale, {
        count: 99,
        layout: "row",
        seed: 1,
        mice: ["nope"],
      }),
    ).toThrow(/no sketch named nope/);
  });
});
