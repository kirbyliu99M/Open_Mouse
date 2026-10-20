import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResultsView } from "../../src/components/results/ResultsView";
import { ShapeToggle } from "../../src/components/results/filter/ShapeToggle";
import type { FitResponse } from "../../src/lib/contracts/fit";
import { RESULTS_PAGE_COPY } from "../../src/lib/copy/results-page";
import { filterAppliedSource } from "../../src/lib/results/analyticsEvents";
import {
  emptyFilters,
  filteredView,
  toggleOption,
  type Filters,
} from "../../src/lib/results/filters";
import {
  cardMotion,
  clearBesideToggle,
  fewSegmentNote,
  filtersBesideToggle,
  rowDelayMs,
  SHAPE_SEGMENTS,
  segmentDirection,
  segmentForKey,
  segmentOf,
  segmentOnly,
  TOGGLE_MOTION,
  toggleShowsShape,
  withSegment,
} from "../../src/lib/results/shapeToggle";
import { filterFit, type FilterSpec } from "./fixtures/filter-fit";

const f = (patch: Partial<Filters>): Filters => ({
  ...emptyFilters(),
  ...patch,
});

describe("segmentOf / withSegment: the toggle is the filter's 滑鼠握感 group", () => {
  it("no shape is 綜合, one shape is that segment, both shapes is no segment", () => {
    expect(segmentOf(emptyFilters())).toBe("overall");
    expect(segmentOf(f({ shape: ["ergonomic"], order: ["shape"] }))).toBe(
      "ergonomic",
    );
    expect(segmentOf(f({ shape: ["symmetrical"], order: ["shape"] }))).toBe(
      "symmetrical",
    );
    expect(
      segmentOf(f({ shape: ["ergonomic", "symmetrical"], order: ["shape"] })),
    ).toBeNull();
  });

  it("a segment sets the shape group alone and keeps every other group", () => {
    const base = f({
      brand: ["Razer"],
      size: ["small"],
      order: ["brand", "size"],
    });
    const ergo = withSegment(base, "ergonomic");
    expect(ergo.shape).toEqual(["ergonomic"]);
    expect(ergo.brand).toEqual(["Razer"]);
    expect(ergo.size).toEqual(["small"]);
    expect(ergo.order).toEqual(["brand", "size", "shape"]);
    // Switching shape keeps the group's place in the order.
    const sym = withSegment(
      f({ shape: ["ergonomic"], brand: ["Razer"], order: ["shape", "brand"] }),
      "symmetrical",
    );
    expect(sym.shape).toEqual(["symmetrical"]);
    expect(sym.order).toEqual(["shape", "brand"]);
    // 綜合 drops the group and its place.
    const all = withSegment(ergo, "overall");
    expect(all.shape).toEqual([]);
    expect(all.order).toEqual(["brand", "size"]);
  });

  it("is two-way: what the panel sets is what the toggle shows, and back", () => {
    const fromPanel = toggleOption(emptyFilters(), "shape", "symmetrical");
    expect(segmentOf(fromPanel)).toBe("symmetrical");
    const fromToggle = withSegment(emptyFilters(), "symmetrical");
    expect(fromToggle).toEqual(fromPanel);
    // The panel's other option added on top: no segment says both.
    expect(
      segmentOf(toggleOption(fromToggle, "shape", "ergonomic")),
    ).toBeNull();
  });
});

describe("segmentDirection and segmentForKey", () => {
  it("moves right to a segment on the right, left to one on the left, nowhere from none", () => {
    expect(segmentDirection("overall", "ergonomic")).toBe(1);
    expect(segmentDirection("ergonomic", "symmetrical")).toBe(-1);
    expect(segmentDirection("symmetrical", "symmetrical")).toBe(0);
    expect(segmentDirection(null, "overall")).toBe(0);
  });

  it("arrow keys step and wrap; Home and End go to the ends; other keys do nothing", () => {
    expect(segmentForKey("overall", "ArrowRight")).toBe("symmetrical");
    expect(segmentForKey("ergonomic", "ArrowRight")).toBe("overall");
    expect(segmentForKey("overall", "ArrowLeft")).toBe("ergonomic");
    expect(segmentForKey("symmetrical", "ArrowUp")).toBe("overall");
    expect(segmentForKey("symmetrical", "ArrowDown")).toBe("ergonomic");
    expect(segmentForKey("ergonomic", "Home")).toBe("overall");
    expect(segmentForKey("overall", "End")).toBe("ergonomic");
    expect(segmentForKey(null, "ArrowRight")).toBe("overall");
    expect(segmentForKey(null, "ArrowLeft")).toBe("ergonomic");
    expect(segmentForKey("overall", "Enter")).toBeNull();
    expect(segmentForKey("overall", "a")).toBeNull();
  });
});

describe("segmentOnly and fewSegmentNote", () => {
  it("names the shape only when it is the whole filter", () => {
    expect(segmentOnly(f({ shape: ["ergonomic"], order: ["shape"] }))).toBe(
      "ergonomic",
    );
    expect(segmentOnly(emptyFilters())).toBeNull();
    expect(
      segmentOnly(
        f({
          shape: ["ergonomic"],
          brand: ["Razer"],
          order: ["shape", "brand"],
        }),
      ),
    ).toBeNull();
    expect(
      segmentOnly(f({ shape: ["ergonomic", "symmetrical"], order: ["shape"] })),
    ).toBeNull();
  });

  it("the note is for 2 to 5 mice under a shape segment, and never pads the list", () => {
    const ergo = f({ shape: ["ergonomic"], order: ["shape"] });
    expect(fewSegmentNote(ergo, 0)).toBeNull(); // FilterNoMatch instead
    expect(fewSegmentNote(ergo, 1)).toBeNull(); // 「只有這 1 款符合」 instead
    expect(fewSegmentNote(ergo, 2)).toEqual({ shape: "ergonomic", count: 2 });
    expect(fewSegmentNote(ergo, 5)).toEqual({ shape: "ergonomic", count: 5 });
    expect(fewSegmentNote(ergo, 6)).toBeNull();
    expect(fewSegmentNote(emptyFilters(), 3)).toBeNull();
  });
});

describe("the toggle's motion", () => {
  it("has the design's timings", () => {
    expect(TOGGLE_MOTION.PILL_MS).toBe(220);
    expect(TOGGLE_MOTION.OUT_MS).toBe(160);
    expect(TOGGLE_MOTION.IN_MS).toBe(220);
    expect(TOGGLE_MOTION.SHIFT_PX).toBe(24);
    expect(TOGGLE_MOTION.REDUCED_MS).toBe(120);
  });

  it("the old card leaves against the direction, the new one comes from it", () => {
    expect(cardMotion(1, false)).toEqual({
      outMs: 160,
      inMs: 220,
      outToPx: -24,
      inFromPx: 24,
    });
    expect(cardMotion(-1, false)).toEqual({
      outMs: 160,
      inMs: 220,
      outToPx: 24,
      inFromPx: -24,
    });
    const none = cardMotion(0, false);
    expect(Object.is(none.outToPx, 0)).toBe(true);
    expect(Object.is(none.inFromPx, 0)).toBe(true);
  });

  it("reduced motion is a 120 ms fade with no movement", () => {
    for (const dir of [-1, 0, 1] as const) {
      expect(cardMotion(dir, true)).toEqual({
        outMs: 120,
        inMs: 120,
        outToPx: 0,
        inFromPx: 0,
      });
    }
  });

  it("rows fade in 30 ms apart, five at most; the rest appear at once", () => {
    expect([0, 1, 2, 3, 4].map((i) => rowDelayMs(i, false))).toEqual([
      0, 30, 60, 90, 120,
    ]);
    expect(rowDelayMs(5, false)).toBeNull();
    expect(rowDelayMs(9, false)).toBeNull();
    expect([0, 4].map((i) => rowDelayMs(i, true))).toEqual([0, 0]);
    expect(rowDelayMs(-1, false)).toBeNull();
  });
});

describe("analytics: a toggle change sends no filter_applied (no contract source)", () => {
  it("maps the contract's sources to themselves and the toggle to null", () => {
    expect(filterAppliedSource("sheet")).toBe("sheet");
    expect(filterAppliedSource("sidebar")).toBe("sidebar");
    expect(filterAppliedSource("chips")).toBe("chips");
    expect(filterAppliedSource("no_match")).toBe("no_match");
    expect(filterAppliedSource("shape_toggle")).toBeNull();
  });
});

describe("ShapeToggle", () => {
  const html = (
    selected: (typeof SHAPE_SEGMENTS)[number] | null,
    reduced = false,
  ) =>
    renderToStaticMarkup(
      createElement(ShapeToggle, {
        language: "zh-TW",
        selected,
        reducedMotion: reduced,
        onSelect: () => {},
      }),
    );

  it("is a named radio group of 綜合, 左右對稱, 人體工學, in that order", () => {
    const out = html("overall");
    expect(out).toContain('role="radiogroup"');
    expect(out).toContain('aria-label="滑鼠形狀"');
    const labels = [...out.matchAll(/role="radio"[^>]*>([^<]+)</g)].map(
      (m) => m[1],
    );
    expect(labels).toEqual(["綜合", "左右對稱", "人體工學"]);
  });

  it("exposes the checked segment and puts only it in the Tab order", () => {
    const out = html("ergonomic");
    const radios = [...out.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map(
      (m) => m[0],
    );
    expect(radios).toHaveLength(3);
    expect(radios.map((r) => r.includes('aria-checked="true"'))).toEqual([
      false,
      false,
      true,
    ]);
    expect(radios.map((r) => r.includes('tabindex="0"'))).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("with no segment checked (both shapes in the panel): no pill, the first is the Tab stop", () => {
    const out = html(null);
    expect(out).not.toContain("results-shapeToggle-pill");
    expect(out).not.toContain('aria-checked="true"');
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    expect(out.indexOf('tabindex="0"')).toBeLessThan(out.indexOf("左右對稱"));
  });

  it("the pill sits under the checked segment by a transform", () => {
    expect(html("symmetrical")).toContain("transform:translateX(100%)");
    expect(html("ergonomic")).toContain("transform:translateX(200%)");
    expect(html("overall", true)).toContain('data-motion="reduced"');
  });

  it("has English labels too", () => {
    const en = RESULTS_PAGE_COPY.en.shapeToggle.segment;
    expect([en.overall, en.symmetrical, en.ergonomic]).toEqual([
      "Overall",
      "Symmetrical",
      "Ergonomic",
    ]);
  });
});

describe("the results page with the toggle", () => {
  // Ranked in this order: s1 is the overall #1.
  const SPECS: FilterSpec[] = [
    { slug: "s1", brand: "Zowie", shape: "symmetrical" },
    { slug: "s2", brand: "Razer", shape: "symmetrical" },
    { slug: "e3", brand: "Logitech", shape: "ergonomic" },
    { slug: "s4", brand: "Pulsar", shape: "symmetrical" },
    { slug: "e5", brand: "Razer", shape: "ergonomic" },
    { slug: "h6", brand: "Alpha", shape: "hybrid" },
  ];
  const fit = (): FitResponse => filterFit(SPECS);
  const render = (filters: Filters, onFiltersChange: boolean = true) =>
    renderToStaticMarkup(
      createElement(ResultsView, {
        response: fit(),
        language: "zh-TW",
        filters,
        ...(onFiltersChange ? { onFiltersChange: () => {} } : {}),
      }),
    );

  it("sits above the filter button, 綜合 checked by default", () => {
    const html = render(emptyFilters());
    const toggle = html.indexOf("results-shapeToggle");
    expect(toggle).toBeGreaterThan(-1);
    expect(toggle).toBeLessThan(html.indexOf("results-filterButton"));
    expect(html).toMatch(/aria-checked="true"[^>]*>綜合</);
  });

  it("is not on a page without the filter (a detail page, the demo)", () => {
    expect(render(emptyFilters(), false)).not.toContain("results-shapeToggle");
  });

  it("人體工學: the cards renumbered, the place line names the shape and the overall rank", () => {
    const ergo = withSegment(emptyFilters(), "ergonomic");
    const view = filteredView(fit(), ergo);
    expect(view.cards.map((c) => [c.entry.mouse.slug, c.displayRank])).toEqual([
      ["e3", 1],
      ["e5", 2],
    ]);
    const html = render(ergo);
    expect(html).toContain("人體工學第 1 名");
    expect(html).toContain("總排名第 3 名");
    expect(html).toMatch(/aria-checked="true"[^>]*>人體工學</);
    // The analysis line and the share button follow the filter's rules.
    expect(html).toContain("results-analysisLine");
    expect(html).toContain("分享總排名第 1 名");
  });

  it("a shape with few mice lists exactly those, with the note and a way back to 綜合", () => {
    const html = render(withSegment(emptyFilters(), "ergonomic"));
    expect(html).toContain("目前符合的人體工學款只有 2 款，全部列在這裡。");
    expect(html).toContain("看綜合排序");
    // No padding: only the two ergonomic mice are named.
    for (const slug of ["S1", "S2", "S4", "H6"])
      expect(html).not.toContain(`>${slug}<`);
    expect(html).toContain(">E3<");
    expect(html).toContain(">E5<");
  });

  it("with other filters too, the place line is the filter's own", () => {
    const html = render(
      withSegment(f({ brand: ["Razer"], order: ["brand"] }), "symmetrical"),
    );
    // Razer + symmetrical: s2 only, which is not the overall #1.
    expect(html).toContain("篩選後第 1 名");
    expect(html).toContain("只有這 1 款符合");
    expect(html).not.toContain("results-fewNote");
  });

  it("a segment with nothing in it shows FilterNoMatch", () => {
    const html = render(
      withSegment(f({ brand: ["Zowie"], order: ["brand"] }), "ergonomic"),
    );
    expect(html).toContain("results-noMatch");
    expect(html).toContain("目前沒有符合條件的滑鼠");
    expect(html).not.toContain("results-fewNote");
  });

  it("綜合 is the page as it was: no badge, no note", () => {
    const html = render(emptyFilters());
    expect(html).not.toContain("results-badge");
    expect(html).not.toContain("results-fewNote");
  });
});

describe("the chips row and the button's count beside the toggle", () => {
  it("leave out the one shape the toggle shows, and keep both shapes as chips", () => {
    const ergo = f({
      shape: ["ergonomic"],
      brand: ["Razer"],
      order: ["brand", "shape"],
    });
    expect(toggleShowsShape(ergo)).toBe(true);
    expect(filtersBesideToggle(ergo).shape).toEqual([]);
    expect(filtersBesideToggle(ergo).brand).toEqual(["Razer"]);
    const both = f({ shape: ["ergonomic", "symmetrical"], order: ["shape"] });
    expect(toggleShowsShape(both)).toBe(false);
    expect(filtersBesideToggle(both)).toBe(both);
  });

  it("「清除全部」 there clears the rest and keeps the toggle's segment", () => {
    const ergo = f({
      shape: ["ergonomic"],
      brand: ["Razer"],
      order: ["brand", "shape"],
    });
    const cleared = clearBesideToggle(ergo);
    expect(cleared.shape).toEqual(["ergonomic"]);
    expect(cleared.brand).toEqual([]);
    expect(cleared.order).toEqual(["shape"]);
    expect(
      clearBesideToggle(f({ brand: ["Razer"], order: ["brand"] })),
    ).toEqual(emptyFilters());
  });

  it("on the page: a toggle-only shape gives no chip and 「篩選」 with no number", () => {
    const html = renderToStaticMarkup(
      createElement(ResultsView, {
        response: filterFit([
          { slug: "s1", shape: "symmetrical" },
          { slug: "e2", shape: "ergonomic" },
        ]),
        language: "zh-TW",
        filters: withSegment(emptyFilters(), "ergonomic"),
        onFiltersChange: () => {},
      }),
    );
    expect(html).not.toContain("results-chips");
    expect(html).toMatch(/results-filterButton[^]*?<span>篩選<\/span>/);
  });

  it("with a brand too: only the brand is a chip, and the count is 1", () => {
    const html = renderToStaticMarkup(
      createElement(ResultsView, {
        response: filterFit([
          { slug: "s1", brand: "Razer", shape: "symmetrical" },
          { slug: "e2", brand: "Razer", shape: "ergonomic" },
        ]),
        language: "zh-TW",
        filters: withSegment(
          f({ brand: ["Razer"], order: ["brand"] }),
          "ergonomic",
        ),
        onFiltersChange: () => {},
      }),
    );
    expect(html).toContain("篩選（1）");
    expect(html).toContain("移除「Razer」");
    expect(html).not.toContain("移除「人體工學」");
  });
});
