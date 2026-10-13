import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_COUNT_CAP,
  analyticsEventSchemas,
  retailerOf,
  type AnalyticsEventName,
} from "@/lib/contracts/analytics";
import { createTrack, URGENT_EVENTS } from "@/client/analytics/track";
import {
  createResultsEmit,
  filterSelectionProps,
  filtersChanged,
  firstTime,
  headerCard,
  linkPositionOf,
  officialKindOf,
  resultsPageFields,
  type ResultsAnalytics,
} from "@/lib/results/analyticsEvents";
import {
  emptyFilters,
  filteredView,
  toggleOption,
} from "@/lib/results/filters";
import { ResultsView } from "@/components/results/ResultsView";
import { FIXTURES } from "@/components/results/fixtures";

const many = FIXTURES["many-results"];

/** A sender that checks every event against the contract, as `track` does. */
function recorder() {
  const sent: Array<[string, Record<string, unknown>]> = [];
  const track = createTrack({
    enabled: () => true,
    send: (name, props) => sent.push([name, props]),
  });
  const analytics: ResultsAnalytics = { send: track };
  return { sent, analytics };
}

describe("resultsPageFields", () => {
  it("is the main page for place 1 and a detail page for 2 to 5", () => {
    expect(resultsPageFields(1, false)).toEqual({
      page: "main",
      rank: 1,
      filtered: false,
    });
    expect(resultsPageFields(3, true)).toEqual({
      page: "detail",
      rank: 3,
      filtered: true,
    });
  });
  it("keeps the rank inside the contract's 1 to 5", () => {
    expect(resultsPageFields(0, false).rank).toBe(1);
    expect(resultsPageFields(9, false).rank).toBe(5);
    expect(resultsPageFields(Number.NaN, false).rank).toBe(1);
  });
});

describe("createResultsEmit", () => {
  it("adds the page fields and passes the contract's strict schema", () => {
    const { sent, analytics } = recorder();
    const emit = createResultsEmit(analytics, resultsPageFields(2, true));
    emit("purchase_link_clicked", {
      mouse: "some-mouse",
      overallRank: 4,
      retailer: retailerOf("https://24h.pchome.com.tw/prod/ABC?x=1"),
      position: linkPositionOf(0),
    });
    expect(sent).toEqual([
      [
        "purchase_link_clicked",
        {
          page: "detail",
          rank: 2,
          filtered: true,
          mouse: "some-mouse",
          overallRank: 4,
          retailer: "pchome",
          position: 1,
        },
      ],
    ]);
    // The URL never leaves the browser.
    expect(JSON.stringify(sent)).not.toContain("pchome.com.tw");
  });

  it("sends nothing without a sender (the demo)", () => {
    const emit = createResultsEmit(undefined, resultsPageFields(1, false));
    expect(() => emit("details_opened", {})).not.toThrow();
  });

  it("builds a valid event for every page-field event", () => {
    const { sent, analytics } = recorder();
    const emit = createResultsEmit(analytics, resultsPageFields(1, false));
    emit("purchase_links_shown", { mouse: "m", count: 2 });
    emit("official_link_clicked", { mouse: "m", kind: officialKindOf(null) });
    emit("details_opened", {});
    emit("viewer_used", {});
    emit("photo_zoomed", { mouse: "m" });
    emit("pick_opened", { toRank: 2, mouse: "n" });
    emit("other_mice_opened", {});
    emit("filter_sheet_opened", {});
    emit("share_started", { position: "hero", overall: false });
    emit("share_finished", { position: "top", outcome: "downloaded" });
    emit("survey_reminder_clicked", { unanswered: true });
    emit("rescan_clicked", {});
    expect(sent.map(([name]) => name)).toEqual([
      "purchase_links_shown",
      "official_link_clicked",
      "details_opened",
      "viewer_used",
      "photo_zoomed",
      "pick_opened",
      "other_mice_opened",
      "filter_sheet_opened",
      "share_started",
      "share_finished",
      "survey_reminder_clicked",
      "rescan_clicked",
    ]);
  });
});

describe("small mappers", () => {
  it("official kind: no kind reads as brand", () => {
    expect(officialKindOf("product")).toBe("product");
    expect(officialKindOf("brand")).toBe("brand");
    expect(officialKindOf(null)).toBe("brand");
    expect(officialKindOf(undefined)).toBe("brand");
  });
  it("link position is 1-based and capped at four", () => {
    expect(linkPositionOf(0)).toBe(1);
    expect(linkPositionOf(3)).toBe(4);
    expect(linkPositionOf(7)).toBe(4);
  });
  it("firstTime is true once per key", () => {
    const seen = new Set<string>();
    expect(firstTime(seen, "a")).toBe(true);
    expect(firstTime(seen, "a")).toBe(false);
    expect(firstTime(seen, "b")).toBe(true);
  });
});

describe("filter events", () => {
  it("maps brands to keys, drops empties, dedupes and caps", () => {
    const filters = {
      ...emptyFilters(),
      brand: ["SteelSeries", "Cooler Master", "steelseries", "!!!"],
      size: ["small" as const],
    };
    const props = filterSelectionProps(filters);
    expect(props.brand).toEqual(["steelseries", "cooler-master"]);
    expect(props.size).toEqual(["small"]);
    const many = {
      ...emptyFilters(),
      brand: Array.from({ length: 30 }, (_, i) => `Brand ${i}`),
    };
    expect(filterSelectionProps(many).brand).toHaveLength(ANALYTICS_COUNT_CAP);
  });

  it("a built filter_applied event passes the contract", () => {
    const filters = toggleOption(emptyFilters(), "size", "medium");
    const view = filteredView(many, filters);
    const parsed = analyticsEventSchemas.filter_applied.safeParse({
      ...resultsPageFields(1, view.active),
      source: "chips",
      ...filterSelectionProps(filters),
      count: Math.min(ANALYTICS_COUNT_CAP, view.count),
    });
    expect(parsed.success).toBe(true);
  });

  it("filtersChanged ignores selection order and an unchanged apply", () => {
    const a = {
      ...emptyFilters(),
      brand: ["A", "B"],
    };
    const b = { ...emptyFilters(), brand: ["B", "A"] };
    expect(filtersChanged(a, b)).toBe(false);
    expect(filtersChanged(a, emptyFilters())).toBe(true);
    expect(filtersChanged(emptyFilters(), emptyFilters())).toBe(false);
    expect(
      filtersChanged(
        emptyFilters(),
        toggleOption(emptyFilters(), "weight", "lt50"),
      ),
    ).toBe(true);
  });
});

describe("headerCard", () => {
  it("is the card at the rank, else the filtered first place", () => {
    const view = filteredView(many, emptyFilters());
    expect(headerCard(view, 2)?.displayRank).toBe(2);
    expect(headerCard(view, 99)?.displayRank).toBe(1);
  });
});

describe("the outbound-click events", () => {
  it("ask for PostHog to load at once, others do not", () => {
    const urgent = vi.fn();
    const track = createTrack({
      enabled: () => true,
      send: () => {},
      urgent,
    });
    const fields = resultsPageFields(1, false);
    track("details_opened", fields);
    expect(urgent).not.toHaveBeenCalled();
    track("purchase_link_clicked", {
      ...fields,
      mouse: "m",
      overallRank: 1,
      retailer: "momo",
      position: 1,
    });
    track("official_link_clicked", { ...fields, mouse: "m", kind: "brand" });
    expect(urgent).toHaveBeenCalledTimes(2);
  });

  it("a dropped event (fails the schema) does not trigger a load", () => {
    const urgent = vi.fn();
    const send = vi.fn();
    const track = createTrack({ enabled: () => true, send, urgent });
    track("official_link_clicked", {
      page: "main",
      rank: 1,
      filtered: false,
      mouse: "m",
      kind: "https://shop.example/x" as never,
    });
    expect(send).not.toHaveBeenCalled();
    expect(urgent).not.toHaveBeenCalled();
  });

  it("are only those two events", () => {
    expect([...URGENT_EVENTS].sort()).toEqual<AnalyticsEventName[]>([
      "official_link_clicked",
      "purchase_link_clicked",
    ]);
  });
});

describe("rendering", () => {
  it("sends no event while rendering, with or without the sender", () => {
    const send = vi.fn();
    renderToStaticMarkup(
      createElement(ResultsView, {
        response: many,
        language: "zh-TW",
        scanId: "00000000-0000-4000-8000-000000000000",
        analytics: { send },
        onFiltersChange: () => {},
      }),
    );
    expect(send).not.toHaveBeenCalled();
    expect(() =>
      renderToStaticMarkup(
        createElement(ResultsView, { response: many, language: "zh-TW" }),
      ),
    ).not.toThrow();
  });
});
