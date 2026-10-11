import { describe, expect, it } from "vitest";
import type { FormFactor } from "../../src/lib/contracts/descriptors";
import {
  toMiceListRow,
  visibleMice,
  toFilterSource,
} from "../../src/lib/mice/list";
import {
  EXCLUDED_FORM_FACTORS,
  isExcludedFromMiceList,
  withoutExcludedFormFactors,
} from "../../src/server/catalogue/mice-exclusion";
import { VERTICAL_FORM_FACTOR_RATIO } from "../../src/server/fit/coefficients";
import { excludeReasonV1 } from "../../src/server/fit/exclusions-v1";
import type { CatalogueMouse } from "../../src/server/fit/types";
import {
  emptyFilters,
  facetCounts,
  matchCount,
} from "../../src/lib/results/filters";

const q = (
  slug: string,
  formFactor: FormFactor,
  over: { lengthMm?: number; heightMm?: number; model?: string } = {},
) => ({
  slug,
  brand: "Acme",
  model: over.model ?? slug,
  size: "medium" as const,
  shape: "ergonomic" as const,
  connectivity: "wired" as const,
  lengthMm: over.lengthMm ?? 125,
  widthMm: 63.5,
  heightMm: over.heightMm ?? 40,
  weightG: 80,
  formFactor,
});
const listRow = (r: ReturnType<typeof q>) => toMiceListRow(r);

describe("the temporary exclusion of vertical mice and trackballs (Kirby 2026-10-12)", () => {
  const set = [
    q("a", "standard"),
    q("v", "vertical"),
    q("t", "trackball"),
    q("b", "standard"),
  ];

  it("excludes exactly the vertical and trackball form factors", () => {
    expect([...EXCLUDED_FORM_FACTORS].sort()).toEqual([
      "trackball",
      "vertical",
    ]);
  });

  it("drops them from the list and keeps the order of the rest", () => {
    expect(withoutExcludedFormFactors(set).map((r) => r.slug)).toEqual([
      "a",
      "b",
    ]);
  });

  it("also drops a row whose form_factor is still the default standard but whose height / length is above the fit service's ratio", () => {
    // 70 / 100 = 0.7, a vertical shell written before CAT-1.
    const old = q("old", "standard", { lengthMm: 100, heightMm: 70 });
    expect(isExcludedFromMiceList(old)).toBe(true);
    expect(
      withoutExcludedFormFactors([q("a", "standard"), old]).map((r) => r.slug),
    ).toEqual(["a"]);
  });

  it("uses the fit service's own ratio, and a row exactly at it stays", () => {
    expect(VERTICAL_FORM_FACTOR_RATIO).toBe(0.55);
    const at = q("at", "standard", { lengthMm: 100, heightMm: 55 });
    const over = q("over", "standard", { lengthMm: 100, heightMm: 55.1 });
    expect(isExcludedFromMiceList(at)).toBe(false);
    expect(isExcludedFromMiceList(over)).toBe(true);
  });

  it("agrees with the fit service on which standard-form-factor rows are vertical", () => {
    const mouse = (heightMm: number): CatalogueMouse =>
      ({
        slug: "x",
        brand: "Acme",
        model: "X",
        lengthMm: 100,
        widthMm: 60,
        heightMm,
        formFactor: "standard",
        handCompatibility: null,
        shape: null,
      }) as unknown as CatalogueMouse;
    for (const h of [40, 54.9, 55, 55.1, 70]) {
      const fitSaysVertical =
        excludeReasonV1(mouse(h), "right", {} as never) ===
        "vertical_form_factor";
      expect(
        isExcludedFromMiceList(
          q("x", "standard", { lengthMm: 100, heightMm: h }),
        ),
        String(h),
      ).toBe(fitSaysVertical);
    }
  });

  it("the count, the search and the option counts follow the rows that are left", () => {
    const kept = withoutExcludedFormFactors(set).map(listRow);
    expect(visibleMice(kept, emptyFilters(), "").length).toBe(2);
    expect(matchCount(toFilterSource(kept), emptyFilters())).toBe(2);
    const shapes = facetCounts(toFilterSource(kept), emptyFilters()).shape;
    expect(shapes.map((o) => [o.value, o.count])).toEqual([
      ["ergonomic", 2],
      ["symmetrical", 0],
    ]);
    // With them left in, the same call counts 4 (that is what the exclusion changes).
    expect(visibleMice(set.map(listRow), emptyFilters(), "").length).toBe(4);
    const named = [
      q("v", "vertical", { model: "MX Vertical" }),
      q("s", "standard", { model: "G305" }),
    ];
    expect(
      visibleMice(
        withoutExcludedFormFactors(named).map(listRow),
        emptyFilters(),
        "vertical",
      ),
    ).toEqual([]);
  });

  it("takes nothing out when the excluded list is empty (removing the constant brings every row back, the ratio rule included)", () => {
    const tall = q("tall", "standard", { lengthMm: 100, heightMm: 70 });
    expect(
      withoutExcludedFormFactors([...set, tall], []).map((r) => r.slug),
    ).toEqual(["a", "v", "t", "b", "tall"]);
  });
});
