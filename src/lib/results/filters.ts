/**
 * The results-page filter (FILTER-1, candidate / 未拍板): every number and every
 * list the filter shows comes from this file (hard rule 2). Pure, no React, safe
 * on both sides of the seam.
 *
 * Five groups: 品牌 (brand), 尺寸 (size), 重量 (weight), 滑鼠握感 (shape) and
 * 連線方式 (connectivity). OR inside a group, AND across groups. Everything is
 * counted per card, i.e. after same-shell grouping (SHELL-1): a card is the
 * entry the server shows, and its `variants` are its other members.
 *
 * Which facts a card matches on:
 * - brand, size and shape come from the shown entry (members of one shell
 *   share them; size comes from `mouse.size`, never from the length, and the
 *   size's "fingertip" counts as small, through `handSizeOf`, the function the
 *   hand type's size uses too: B2);
 * - weight and connectivity come from any member, main or variant, and one
 *   member must satisfy both when both are chosen (B3).
 *
 * A mouse that lacks a value (null weight, null connectivity, null shape) never
 * matches that group's options and is counted by `nullCounts` instead; a guess
 * is never made. A mouse whose shape is `hybrid` has a value but no option
 * (「其他」 was dropped), so it only leaves the list when 滑鼠握感 is chosen and
 * is not counted as missing data.
 */
import type { Connectivity, Shape } from "../contracts/descriptors";
import type { FitEntry, FitResponse } from "../contracts/fit";
import { handSizeOf } from "../fit/handType";
import { TOP_PICK_COUNT } from "./rankRoutes";

export const FILTER_GROUPS = [
  "brand",
  "size",
  "weight",
  "shape",
  "connectivity",
] as const;
export type FilterGroup = (typeof FILTER_GROUPS)[number];

export const SIZE_OPTIONS = ["small", "medium", "large"] as const;
export type SizeOption = (typeof SIZE_OPTIONS)[number];

/** Half-open bands: under 50 g, 50 up to (not including) 70, 70 up to 90, 90 and over. */
export const WEIGHT_OPTIONS = ["lt50", "50-69", "70-89", "gte90"] as const;
export type WeightOption = (typeof WEIGHT_OPTIONS)[number];

export const SHAPE_OPTIONS = [
  "ergonomic",
  "symmetrical",
] as const satisfies readonly Shape[];
export type ShapeOption = (typeof SHAPE_OPTIONS)[number];

/** Display order: wireless first (無線 / 有線). */
export const CONNECTIVITY_OPTIONS = [
  "wireless",
  "wired",
] as const satisfies readonly Connectivity[];
export type ConnectivityOption = (typeof CONNECTIVITY_OPTIONS)[number];

/** Shown first, in this order; every other brand follows by count. */
export const FEATURED_BRANDS = [
  "Logitech",
  "Razer",
  "Corsair",
  "SteelSeries",
  "Pulsar",
] as const;

export interface Filters {
  brand: string[];
  size: SizeOption[];
  weight: WeightOption[];
  shape: ShapeOption[];
  connectivity: ConnectivityOption[];
  /**
   * The groups that have a selection, the one chosen first up front. A tie in
   * `suggestRelaxation` goes to the group added last.
   */
  order: FilterGroup[];
}

export function emptyFilters(): Filters {
  return {
    brand: [],
    size: [],
    weight: [],
    shape: [],
    connectivity: [],
    order: [],
  };
}

/** What a group's selection is, as plain strings. */
export function selectionOf(filters: Filters, group: FilterGroup): string[] {
  return filters[group];
}

/** The number of chosen options over all groups (the 「篩選（n）」 number). */
export function selectedCount(filters: Filters): number {
  return FILTER_GROUPS.reduce((n, g) => n + filters[g].length, 0);
}

export function isFiltering(filters: Filters): boolean {
  return selectedCount(filters) > 0;
}

/**
 * The groups that have a selection, in the order they were added (a group
 * `order` does not name comes last, in the fixed group order).
 */
export function selectedGroups(filters: Filters): FilterGroup[] {
  const named = filters.order.filter((g) => filters[g].length > 0);
  const unnamed = FILTER_GROUPS.filter(
    (g) => filters[g].length > 0 && !named.includes(g),
  );
  return [...named, ...unnamed];
}

function withSelection(
  filters: Filters,
  group: FilterGroup,
  values: readonly string[],
): Filters {
  const next = { ...filters, [group]: [...values] } as Filters;
  // A group keeps the place of its first choice; an emptied group leaves.
  next.order =
    values.length === 0
      ? filters.order.filter((g) => g !== group)
      : filters.order.includes(group)
        ? [...filters.order]
        : [...filters.order, group];
  return next;
}

/** Choose or un-choose one option. A group that gets its first option becomes the last one added. */
export function toggleOption(
  filters: Filters,
  group: FilterGroup,
  value: string,
): Filters {
  const current: readonly string[] = filters[group];
  const has = current.includes(value);
  const values = has ? current.filter((v) => v !== value) : [...current, value];
  return withSelection(filters, group, values);
}

/** Drop every option of one group. */
export function clearGroup(filters: Filters, group: FilterGroup): Filters {
  return withSelection(filters, group, []);
}

// ---------------------------------------------------------------- URL

/** The query parameter of each group. */
export const FILTER_PARAMS: Record<FilterGroup, string> = {
  brand: "brand",
  size: "size",
  weight: "weight",
  shape: "grip",
  connectivity: "conn",
};

const OPTION_LISTS: Record<Exclude<FilterGroup, "brand">, readonly string[]> = {
  size: SIZE_OPTIONS,
  weight: WEIGHT_OPTIONS,
  shape: SHAPE_OPTIONS,
  connectivity: CONNECTIVITY_OPTIONS,
};

/**
 * Filters from a query string (`?brand=Razer&conn=wireless`). Repeated keys are
 * several options of one group. Unknown parameters, unknown values and
 * duplicates are ignored; with `knownBrands` a brand the response does not
 * have is ignored too. The order the groups first appear in the query becomes
 * `order`.
 */
export function parseFilters(
  input: string | URLSearchParams,
  opts: { knownBrands?: readonly string[] } = {},
): Filters {
  const params =
    typeof input === "string"
      ? new URLSearchParams(input.startsWith("?") ? input.slice(1) : input)
      : input;
  const out = emptyFilters();
  const known = opts.knownBrands ? new Set(opts.knownBrands) : null;
  for (const [key, raw] of params.entries()) {
    const group = FILTER_GROUPS.find((g) => FILTER_PARAMS[g] === key);
    if (!group) continue;
    if (group === "brand") {
      const value = raw.trim();
      if (value === "" || value.length > 80) continue;
      if (known && !known.has(value)) continue;
      if (!out.brand.includes(value)) out.brand.push(value);
    } else {
      if (!OPTION_LISTS[group].includes(raw)) continue;
      const list = out[group] as string[];
      if (!list.includes(raw)) list.push(raw);
    }
    if (!out.order.includes(group)) out.order.push(group);
  }
  // Keep the options of a fixed list in their display order.
  for (const g of ["size", "weight", "shape", "connectivity"] as const) {
    const list = OPTION_LISTS[g];
    (out[g] as string[]).sort((a, b) => list.indexOf(a) - list.indexOf(b));
  }
  return out;
}

/** The query string for these filters, without the `?` (empty for no filter). */
export function serializeFilters(filters: Filters): string {
  const params = new URLSearchParams();
  for (const g of selectedGroups(filters)) {
    for (const v of filters[g]) params.append(FILTER_PARAMS[g], v);
  }
  return params.toString();
}

/**
 * `search` with its filter parameters replaced by `filters`'. Any other
 * parameter is kept as it was. Without the `?`.
 */
export function mergeFilterParams(search: string, filters: Filters): string {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  for (const g of FILTER_GROUPS) params.delete(FILTER_PARAMS[g]);
  const kept = params.toString();
  const own = serializeFilters(filters);
  return [kept, own].filter((p) => p !== "").join("&");
}

/** `?x=y` for a query string, or the empty string. */
export function withQuestionMark(query: string): string {
  return query === "" ? "" : `?${query}`;
}

// ---------------------------------------------------------------- matching

/** One member of a card: the shown mouse or one of its same-shell variants. */
interface Member {
  slug: string;
  model: string;
  weightG: number | null;
  connectivity: Connectivity | null;
}

function membersOf(entry: FitEntry): Member[] {
  return [
    {
      slug: entry.mouse.slug,
      model: entry.mouse.model,
      weightG: entry.mouse.weightG,
      connectivity: entry.mouse.connectivity ?? null,
    },
    ...(entry.variants ?? []).map((v) => ({
      slug: v.slug,
      model: v.model,
      weightG: v.weightG,
      connectivity: v.connectivity ?? null,
    })),
  ];
}

/** The band a weight falls in, or null for no weight. */
export function weightBandOf(weightG: number | null): WeightOption | null {
  if (weightG === null || !Number.isFinite(weightG)) return null;
  if (weightG < 50) return "lt50";
  if (weightG < 70) return "50-69";
  if (weightG < 90) return "70-89";
  return "gte90";
}

/** The size group of a mouse: `mouse.size`, fingertip counting as small. */
export function sizeGroupOf(entry: FitEntry): SizeOption {
  return handSizeOf(entry.mouse.size);
}

function memberMatches(m: Member, filters: Filters): boolean {
  if (filters.weight.length > 0) {
    const band = weightBandOf(m.weightG);
    if (band === null || !filters.weight.includes(band)) return false;
  }
  if (filters.connectivity.length > 0) {
    if (
      m.connectivity === null ||
      !filters.connectivity.includes(m.connectivity)
    )
      return false;
  }
  return true;
}

/** The members of a card that satisfy the weight and connectivity choices (all of them when neither is chosen). */
function matchingMembers(entry: FitEntry, filters: Filters): Member[] {
  return membersOf(entry).filter((m) => memberMatches(m, filters));
}

function cardMatches(entry: FitEntry, filters: Filters): boolean {
  if (filters.brand.length > 0 && !filters.brand.includes(entry.mouse.brand))
    return false;
  if (filters.size.length > 0 && !filters.size.includes(sizeGroupOf(entry)))
    return false;
  if (filters.shape.length > 0) {
    const shape = entry.mouse.shape ?? null;
    if (shape === null || !(filters.shape as readonly string[]).includes(shape))
      return false;
  }
  return matchingMembers(entry, filters).length > 0;
}

function cardsOf(response: FitResponse): FitEntry[] {
  return [...response.results].sort((a, b) => a.rank - b.rank);
}

function countMatching(response: FitResponse, filters: Filters): number {
  let n = 0;
  for (const e of response.results) if (cardMatches(e, filters)) n += 1;
  return n;
}

/** How many cards these filters keep. */
export function matchCount(response: FitResponse, filters: Filters): number {
  return countMatching(response, filters);
}

// ---------------------------------------------------------------- counts

export interface FacetOption {
  value: string;
  /** Cards you would get with the other groups' current choices plus this option. */
  count: number;
  selected: boolean;
  /** Nothing would be left and the option is not chosen. */
  disabled: boolean;
}

export interface FacetCounts {
  brand: { featured: FacetOption[]; rest: FacetOption[] };
  size: FacetOption[];
  weight: FacetOption[];
  shape: FacetOption[];
  connectivity: FacetOption[];
}

function optionCount(
  response: FitResponse,
  filters: Filters,
  group: FilterGroup,
  value: string,
): FacetOption {
  const probe = { ...filters, [group]: [value] } as Filters;
  const count = countMatching(response, probe);
  const selected = (filters[group] as readonly string[]).includes(value);
  return { value, count, selected, disabled: count === 0 && !selected };
}

/** Brands in the response: the featured five that are present, then the rest by card count (more first), then by name. */
export function brandOrder(response: FitResponse): {
  featured: string[];
  rest: string[];
} {
  const totals = new Map<string, number>();
  for (const e of response.results)
    totals.set(e.mouse.brand, (totals.get(e.mouse.brand) ?? 0) + 1);
  const featured = FEATURED_BRANDS.filter((b) => totals.has(b));
  const rest = [...totals.keys()]
    .filter((b) => !(FEATURED_BRANDS as readonly string[]).includes(b))
    .sort((a, b) => totals.get(b)! - totals.get(a)! || a.localeCompare(b));
  return { featured: [...featured], rest };
}

/**
 * Every option of every group with its count. Brands that are in the response
 * but not chosen and have no card left show as disabled; a chosen option never
 * does.
 */
export function facetCounts(
  response: FitResponse,
  filters: Filters,
): FacetCounts {
  const brands = brandOrder(response);
  const of = (group: FilterGroup, values: readonly string[]) =>
    values.map((v) => optionCount(response, filters, group, v));
  return {
    brand: {
      featured: of("brand", brands.featured),
      rest: of("brand", brands.rest),
    },
    size: of("size", SIZE_OPTIONS),
    weight: of("weight", WEIGHT_OPTIONS),
    shape: of("shape", SHAPE_OPTIONS),
    connectivity: of("connectivity", CONNECTIVITY_OPTIONS),
  };
}

export type NullGroup = "weight" | "shape" | "connectivity";

/** Whether a card has no value at all for a group. */
function lacks(entry: FitEntry, group: NullGroup): boolean {
  switch (group) {
    case "weight":
      return membersOf(entry).every((m) => weightBandOf(m.weightG) === null);
    case "shape":
      return (entry.mouse.shape ?? null) === null;
    case "connectivity":
      return membersOf(entry).every((m) => m.connectivity === null);
  }
}

/**
 * For each group that has a selection: how many cards that the other groups
 * keep have no value for it (they are not listed while it is chosen). A group
 * with no selection reports 0.
 */
export function nullCounts(
  response: FitResponse,
  filters: Filters,
): Record<NullGroup, number> {
  const out: Record<NullGroup, number> = {
    weight: 0,
    shape: 0,
    connectivity: 0,
  };
  for (const group of ["weight", "shape", "connectivity"] as const) {
    if (filters[group].length === 0) continue;
    const others = clearGroup(filters, group);
    for (const e of response.results)
      if (cardMatches(e, others) && lacks(e, group)) out[group] += 1;
  }
  return out;
}

export interface Relaxation {
  /** The whole group to drop. */
  group: FilterGroup;
  /** Cards that would show. */
  count: number;
}

/**
 * For a filter that leaves nothing: the one group whose removal shows the most
 * cards. A tie goes to the group added last, then to the fixed group order
 * (品牌, 尺寸, 重量, 滑鼠握感, 連線方式). `null` when no single group helps (every
 * removal still leaves nothing), so the page offers 「清除全部」 only.
 */
export function suggestRelaxation(
  response: FitResponse,
  filters: Filters,
): Relaxation | null {
  let best: (Relaxation & { added: number; fixed: number }) | null = null;
  for (const group of selectedGroups(filters)) {
    const count = countMatching(response, clearGroup(filters, group));
    if (count === 0) continue;
    const added = filters.order.indexOf(group);
    const fixed = FILTER_GROUPS.indexOf(group);
    const better =
      best === null ||
      count > best.count ||
      (count === best.count &&
        (added > best.added || (added === best.added && fixed < best.fixed)));
    if (better) best = { group, count, added, fixed };
  }
  return best ? { group: best.group, count: best.count } : null;
}

/**
 * The size option the scan's hand type points to (適合你), or null: no hand
 * type, or a left-hand scan (left-hand fit is not rated yet). The size comes
 * from `handType.size`, which the server takes from the same `handSizeOf` that
 * puts each mouse in its size group.
 */
export function suitableSize(response: FitResponse): SizeOption | null {
  if (!response.handType || response.hand === "left") return null;
  return response.handType.size;
}

// ---------------------------------------------------------------- the view

export interface FilteredCard {
  entry: FitEntry;
  /** 1..n in the filtered list. Display only: `entry.rank` stays the overall rank. */
  displayRank: number;
  overallRank: number;
  /** Same-shell members to name on the card: the ones that match when weight or connectivity is chosen, else all. */
  variants: NonNullable<FitEntry["variants"]>;
  /** Whether the shown mouse itself matches (a variant may be what matches). */
  headMatches: boolean;
}

export interface FilteredView {
  filters: Filters;
  active: boolean;
  /** Every kept card, in overall order, renumbered. */
  cards: FilteredCard[];
  count: number;
  /** The large card: the filtered #1. */
  large: FilteredCard | null;
  /** The filtered #2 to #5. */
  picks: FilteredCard[];
  /** The filtered #6 and later. */
  rest: FilteredCard[];
  /** `response.excluded`, hidden while filtering (they carry no facts to filter on). */
  excluded: FitResponse["excluded"];
  hiddenExcludedCount: number;
  /** The overall #1 of the response, matching or not. */
  overallTop: FitEntry | null;
  /** The large card is a different mouse from the overall #1: badge, collapsed analysis. */
  swapped: boolean;
}

function variantsFor(entry: FitEntry, filters: Filters) {
  const all = entry.variants ?? [];
  if (filters.weight.length === 0 && filters.connectivity.length === 0)
    return all;
  const matching = new Set(matchingMembers(entry, filters).map((m) => m.slug));
  return all.filter((v) => matching.has(v.slug));
}

/**
 * The page's data under `filters`: the kept cards renumbered 1..n, the large
 * card, the other picks and the rest. With no filter it is the response as it
 * is. Excluded mice are hidden while filtering. The analysis and the share
 * image never read this: they read `overallTop`.
 */
export function filteredView(
  response: FitResponse,
  filters: Filters,
): FilteredView {
  const active = isFiltering(filters);
  const ordered = cardsOf(response);
  const overallTop = ordered[0] ?? null;
  const kept = active
    ? ordered.filter((e) => cardMatches(e, filters))
    : ordered;
  const cards: FilteredCard[] = kept.map((entry, i) => ({
    entry,
    displayRank: active ? i + 1 : entry.rank,
    overallRank: entry.rank,
    variants: active ? variantsFor(entry, filters) : (entry.variants ?? []),
    headMatches: active ? memberMatches(membersOf(entry)[0]!, filters) : true,
  }));
  const large = cards[0] ?? null;
  return {
    filters,
    active,
    cards,
    count: cards.length,
    large,
    picks: cards.filter(
      (c) => c.displayRank >= 2 && c.displayRank <= TOP_PICK_COUNT,
    ),
    rest: cards.filter((c) => c.displayRank > TOP_PICK_COUNT),
    excluded: active ? [] : response.excluded,
    hiddenExcludedCount: active ? response.excluded.length : 0,
    overallTop,
    swapped:
      active &&
      large !== null &&
      overallTop !== null &&
      large.entry !== overallTop,
  };
}

/** The other picks on a page: the view's top five without the card the page is about. */
export function viewOtherPicks(
  view: FilteredView,
  currentDisplayRank: number,
): FilteredCard[] {
  return view.cards.filter(
    (c) =>
      c.displayRank <= TOP_PICK_COUNT && c.displayRank !== currentDisplayRank,
  );
}

export type ViewDetailTarget =
  { kind: "detail"; card: FilteredCard } | { kind: "main" };

/**
 * What `/results/[scanId]/m/[slug]` shows under the filters: the card with that
 * slug when it is the filtered #2 to #5 (whatever its overall rank), the main
 * page for the filtered #1 and for anything else (a mouse that does not match,
 * a slug that is not ranked). With no filter this is the old rule: ranks 2 to 5.
 */
export function resolveViewDetail(
  view: FilteredView,
  slug: string,
): ViewDetailTarget {
  const card = view.cards.find((c) => c.entry.mouse.slug === slug);
  return card && card.displayRank >= 2 && card.displayRank <= TOP_PICK_COUNT
    ? { kind: "detail", card }
    : { kind: "main" };
}

// ---------------------------------------------------------------- sheet

/**
 * The filter sheet edits a draft: opening copies the applied filters, 「查看 N
 * 款滑鼠」 applies the draft, and ✕, Esc and dragging down throw it away.
 */
export interface SheetState {
  applied: Filters;
  draft: Filters;
}

export function openSheet(applied: Filters): SheetState {
  return { applied, draft: applied };
}

export function editDraft(state: SheetState, draft: Filters): SheetState {
  return { ...state, draft };
}

/** What the page holds after the sheet closes: `apply` keeps the draft, otherwise the draft is discarded. */
export function closeSheet(state: SheetState, apply: boolean): Filters {
  return apply ? state.draft : state.applied;
}
