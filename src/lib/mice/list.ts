/**
 * The all-mice page's rows and the pure rules around them (PAGE-1, candidate /
 * 未拍板). Safe on both sides of the seam: the server builds the rows, the
 * browser filters, searches and pages them.
 *
 * A row is exactly what the page shows, nothing more (see `MiceListRow`). The
 * filter is the results page's: the rows are turned into the same
 * `FilterSource` shape and go through `src/lib/results/filters.ts`, so the
 * brand list, the size groups, the half-open weight bands, the shape and
 * connection options and the null handling are one set of rules, not a copy.
 */
import type {
  Connectivity,
  FormFactor,
  Shape,
  Size,
} from "../contracts/descriptors";
import { handSizeOf } from "../fit/handType";
import {
  cardMatches,
  type FilterEntry,
  type FilterSource,
  type Filters,
  type SizeOption,
} from "../results/filters";

/** Rows shown at first, and added by each 「Show more」. */
export const MICE_PAGE_SIZE = 50;

/**
 * One row of the list, and the whole of what leaves the server for it. The
 * fields the page does not show (source address, data source, hump placement,
 * front flare, side curvature, thumb and ring-finger rests, hand
 * compatibility, photo path, timestamps, ids) are never read, so they are not
 * in the page's HTML or its RSC payload.
 */
export interface MiceListRow {
  slug: string;
  brand: string;
  model: string;
  /** Small, medium or large: the catalogue's size, fingertip counted as small (`handSizeOf`, as the results filter does). */
  size: SizeOption;
  shape: Shape | null;
  connectivity: Connectivity | null;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightG: number | null;
}

/** What the query returns for one catalogue row (the display columns only). */
export interface MiceListSource {
  slug: string;
  brand: string;
  model: string;
  size: Size;
  shape: Shape | null;
  connectivity: Connectivity | null;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightG: number | null;
}

/**
 * The form factors the list leaves out: 暫時排除，Kirby 2026-10-12.
 *
 * Vertical mice and trackballs are not on `/mice` for now. This is the ONE
 * place that says so: to bring them back, empty this array (or delete the
 * filter call in `loadMiceRows`). Nothing else changes: the 「N mice found」
 * line, the search and the filter's option counts are all computed from the
 * rows that are left, so they follow.
 *
 * `formFactor` is the catalogue's own column (`mice.form_factor`), which the
 * seed fills from a first-party fact (trackball) or from the shell's
 * height/length ratio (vertical), the same value the fit service uses to
 * exclude these devices from a comparison.
 */
export const EXCLUDED_FORM_FACTORS: readonly FormFactor[] = [
  "vertical",
  "trackball",
];

/** A catalogue row as the query returns it: the display fields plus the form factor the exclusion reads (never copied onto the page's row). */
export type MiceQueryRow = MiceListSource & { formFactor: FormFactor };

/** The rows whose form factor is not excluded (`EXCLUDED_FORM_FACTORS`, unless a test passes its own). Keeps the order of `rows`. */
export function withoutExcludedFormFactors<
  T extends { formFactor: FormFactor },
>(
  rows: readonly T[],
  excluded: readonly FormFactor[] = EXCLUDED_FORM_FACTORS,
): T[] {
  return rows.filter((row) => !excluded.includes(row.formFactor));
}

/**
 * A row for the page. Copies the display fields one by one (never spreads),
 * so a column that is added to the query later cannot reach the page by
 * accident.
 */
export function toMiceListRow(source: MiceListSource): MiceListRow {
  return {
    slug: source.slug,
    brand: source.brand,
    model: source.model,
    size: handSizeOf(source.size),
    shape: source.shape ?? null,
    connectivity: source.connectivity ?? null,
    lengthMm: source.lengthMm,
    widthMm: source.widthMm,
    heightMm: source.heightMm,
    weightG: source.weightG ?? null,
  };
}

const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

/** Brand, then model; digits compare as numbers (「G Pro 2」 before 「G Pro 10」); a full tie falls back to the slug so the order never wobbles. */
export function compareMice(a: MiceListRow, b: MiceListRow): number {
  return (
    collator.compare(a.brand, b.brand) ||
    collator.compare(a.model, b.model) ||
    (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
  );
}

/** The default order: by brand, then model. Returns a new array. */
export function sortMice(rows: readonly MiceListRow[]): MiceListRow[] {
  return [...rows].sort(compareMice);
}

/** A search text or a name made comparable: Unicode-normalised, lower case, with every kind of white space removed. */
export function normalizeSearch(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/** The text a search is matched against: brand and model. */
export function searchTextOf(
  row: Pick<MiceListRow, "brand" | "model">,
): string {
  return normalizeSearch(`${row.brand} ${row.model}`);
}

/** Whether a row matches a search: empty (or white space only) matches every row. */
export function matchesSearch(
  row: Pick<MiceListRow, "brand" | "model">,
  query: string,
): boolean {
  const q = normalizeSearch(query);
  return q === "" || searchTextOf(row).includes(q);
}

/** A row in the shape the results filter reads. */
export function toFilterEntry(row: MiceListRow): FilterEntry {
  return {
    mouse: {
      slug: row.slug,
      brand: row.brand,
      model: row.model,
      weightG: row.weightG,
      size: row.size,
      shape: row.shape,
      connectivity: row.connectivity,
    },
  };
}

/** The whole list as a `FilterSource` (for the filter's counts and brand list). It has no hand type, so nothing is marked 「Fits you」. */
export function toFilterSource(rows: readonly MiceListRow[]): FilterSource {
  return { results: rows.map(toFilterEntry) };
}

/** The rows that match a search, in the order of `rows`. */
export function searchMice(
  rows: readonly MiceListRow[],
  query: string,
): MiceListRow[] {
  return rows.filter((row) => matchesSearch(row, query));
}

/**
 * The rows the filters keep, in the order of `rows`: OR inside a filter group,
 * AND across groups (the results filter's own rule, `cardMatches`).
 */
export function filterMice(
  rows: readonly MiceListRow[],
  filters: Filters,
): MiceListRow[] {
  return rows.filter((row) => cardMatches(toFilterEntry(row), filters));
}

/** The rows the page lists: the search and the filters both applied. */
export function visibleMice(
  rows: readonly MiceListRow[],
  filters: Filters,
  query: string,
): MiceListRow[] {
  return filterMice(searchMice(rows, query), filters);
}

/** How many rows to show after `shown` rows and one more press of 「Show more」. */
export function nextShownCount(shown: number, total: number): number {
  return Math.min(total, shown + MICE_PAGE_SIZE);
}

/** A millimetre value as the page writes it: at most one decimal, no trailing zero (125, 63.5). `null` for a value that is not a number. */
export function formatMm(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return String(Math.round(value * 10) / 10);
}

/** A weight in grams as the page writes it (the same rule). */
export function formatGrams(value: number | null): string | null {
  return formatMm(value);
}

// ---------------------------------------------------------------- URL

/** The query parameter of the search (the filters have their own, in `FILTER_PARAMS`). */
export const SEARCH_PARAM = "q";
/** A longer search text in the address is cut here. */
export const MAX_SEARCH_LENGTH = 80;

/** The search text in a query string, or the empty string. */
export function parseSearchParam(input: string | URLSearchParams): string {
  const params =
    typeof input === "string"
      ? new URLSearchParams(input.startsWith("?") ? input.slice(1) : input)
      : input;
  return (params.get(SEARCH_PARAM) ?? "").slice(0, MAX_SEARCH_LENGTH);
}

/**
 * `search` with its search parameter set to `query` (removed when `query` is
 * empty or white space). Every other parameter is kept as it was. Without the
 * `?`.
 */
export function mergeSearchParam(search: string, query: string): string {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  params.delete(SEARCH_PARAM);
  if (query.trim() !== "")
    params.set(SEARCH_PARAM, query.slice(0, MAX_SEARCH_LENGTH));
  return params.toString();
}
