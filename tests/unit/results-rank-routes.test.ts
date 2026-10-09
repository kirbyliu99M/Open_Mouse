import { describe, expect, it } from "vitest";
import {
  detailResultsPath,
  entryAtRank,
  mainResultsPath,
  otherMice,
  otherPicks,
  pathForEntry,
  resolveDetailTarget,
  TOP_PICK_COUNT,
} from "../../src/lib/results/rankRoutes";
import { FIXTURES } from "../../src/components/results/fixtures";

const many = FIXTURES["many-results"];
const SCAN = many.scanId;

const slugOf = (rank: number) =>
  many.results.find((r) => r.rank === rank)!.mouse.slug;

describe("paths", () => {
  it("rank 1 is the main page, the rest are detail pages", () => {
    expect(mainResultsPath(SCAN)).toBe(`/results/${SCAN}`);
    expect(detailResultsPath(SCAN, "razer-viper-v3-pro")).toBe(
      `/results/${SCAN}/m/razer-viper-v3-pro`,
    );
    expect(pathForEntry(SCAN, many.results[0])).toBe(`/results/${SCAN}`);
    expect(pathForEntry(SCAN, many.results[1])).toBe(
      `/results/${SCAN}/m/${slugOf(2)}`,
    );
  });
});

describe("resolveDetailTarget (the redirect rule)", () => {
  it("shows ranks 2 to 5", () => {
    for (const rank of [2, 3, 4, 5]) {
      const target = resolveDetailTarget(many.results, slugOf(rank));
      expect(target.kind).toBe("detail");
      if (target.kind === "detail") expect(target.entry.rank).toBe(rank);
    }
  });

  it("sends rank 1, rank 6 and later, and an unknown slug to the main page", () => {
    expect(resolveDetailTarget(many.results, slugOf(1))).toEqual({
      kind: "main",
    });
    for (const rank of [6, 7, 8])
      expect(resolveDetailTarget(many.results, slugOf(rank))).toEqual({
        kind: "main",
      });
    expect(resolveDetailTarget(many.results, "no-such-mouse")).toEqual({
      kind: "main",
    });
    expect(resolveDetailTarget([], "anything")).toEqual({ kind: "main" });
  });

  it("does not show an excluded mouse as a detail page", () => {
    expect(resolveDetailTarget(many.results, many.excluded[0].slug)).toEqual({
      kind: "main",
    });
  });
});

describe("otherPicks", () => {
  it("on the main page is ranks 2 to 5", () => {
    expect(otherPicks(many.results, 1).map((e) => e.rank)).toEqual([
      2, 3, 4, 5,
    ]);
  });

  it("on a detail page is the other four of the top five, rank 1 first", () => {
    expect(otherPicks(many.results, 3).map((e) => e.rank)).toEqual([
      1, 2, 4, 5,
    ]);
    expect(otherPicks(many.results, 5).map((e) => e.rank)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("never lists more than the top five, and copes with fewer results", () => {
    expect(otherPicks(many.results, 2)).toHaveLength(TOP_PICK_COUNT - 1);
    const few = FIXTURES["low-confidence"].results;
    expect(otherPicks(few, 1).map((e) => e.rank)).toEqual([2]);
    expect(otherPicks([], 1)).toEqual([]);
  });

  it("does not depend on the order of the array", () => {
    const shuffled = [...many.results].reverse();
    expect(otherPicks(shuffled, 1).map((e) => e.rank)).toEqual([2, 3, 4, 5]);
  });
});

describe("otherMice", () => {
  it("lists rank 6 onward in order, the excluded last, and counts both", () => {
    const result = otherMice(many);
    expect(result.ranked.map((e) => e.rank)).toEqual([6, 7, 8]);
    expect(result.excluded).toEqual(many.excluded);
    expect(result.count).toBe(3 + many.excluded.length);
  });

  it("is empty when there are five or fewer ranked mice and none excluded", () => {
    const result = otherMice(FIXTURES["high-confidence"]);
    expect(result).toEqual({ ranked: [], excluded: [], count: 0 });
  });

  it("lists only the excluded when there are five or fewer ranked mice", () => {
    const result = otherMice(FIXTURES["with-exclusions"]);
    expect(result.ranked).toEqual([]);
    expect(result.count).toBe(FIXTURES["with-exclusions"].excluded.length);
  });
});

describe("entryAtRank", () => {
  it("finds an entry by rank or returns null", () => {
    expect(entryAtRank(many.results, 4)?.rank).toBe(4);
    expect(entryAtRank(many.results, 99)).toBeNull();
  });
});
