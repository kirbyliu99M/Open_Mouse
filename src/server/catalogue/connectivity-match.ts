/**
 * Pure matching for CAT-2: which EloShapes source row (dataset CSV row or
 * saved compare page) belongs to an approved candidate, and what a saved page
 * says. `scripts/import-catalogue.ts` only does the file I/O and calls these.
 * An ambiguous match is a miss (undefined / null), never a guess.
 */

/** Loose key, the same one build_candidates.py matched rows with. */
export const looseKey = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]/g, "");

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "");

/** One row of the EloShapes dataset CSV, the columns this module needs. */
export interface DatasetRow {
  Brand: string;
  Model: string;
  Connectivity: string;
}

export interface CsvIndex {
  byBrandModel: Map<string, string[]>;
  byModel: Map<string, string[]>;
}

/**
 * The dataset spells Endgame Gear as brand "Endgame" and model "Gear XM2w…";
 * build_candidates.py drops the "Gear " prefix, so the index does too, and
 * only for that brand.
 */
export function datasetModel(row: Pick<DatasetRow, "Brand" | "Model">): string {
  return looseKey(row.Brand) === "endgame"
    ? row.Model.replace(/^Gear\s+/, "")
    : row.Model;
}

export function buildCsvIndex(rows: readonly DatasetRow[]): CsvIndex {
  const byBrandModel = new Map<string, string[]>();
  const byModel = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
  };
  for (const r of rows) {
    const model = looseKey(datasetModel(r));
    push(byBrandModel, `${looseKey(r.Brand)}|${model}`, r.Connectivity);
    push(byModel, model, r.Connectivity);
  }
  return { byBrandModel, byModel };
}

/** The single value every matching row agrees on, else undefined. */
const agreed = (values: readonly string[] | undefined): string | undefined =>
  values && values.length > 0 && new Set(values).size === 1
    ? values[0]
    : undefined;

/**
 * Brand + model first (all matching rows must agree); else model alone, only
 * when every same-model row in the dataset agrees. Undefined when there is no
 * match or the rows conflict.
 */
export function lookupCsvConnectivity(
  index: CsvIndex,
  brand: string,
  model: string,
): string | undefined {
  const key = looseKey(model);
  return (
    agreed(index.byBrandModel.get(`${looseKey(brand)}|${key}`)) ??
    agreed(index.byModel.get(key))
  );
}

export interface SiteTitle {
  title: string;
  slug: string;
}

/**
 * The saved-page slug for a candidate. A title equal to "brand model" wins;
 * otherwise a title whose last words are exactly the model's words and that
 * has at least one more word before them (a word-boundary suffix: "Mini" never
 * matches "Xmini", and a title that merely ends the model's name does not
 * match a longer model). Needs exactly one hit; zero or several is null.
 */
export function matchSiteTitle(
  titles: readonly SiteTitle[],
  brand: string,
  model: string,
): string | null {
  const full = looseKey(`${brand} ${model}`);
  const exact = titles.filter((t) => looseKey(t.title) === full);
  if (exact.length > 0) return exact.length === 1 ? exact[0]!.slug : null;
  const m = words(model);
  if (m.length === 0) return null;
  const suffix = titles.filter((t) => {
    const w = words(t.title);
    return (
      w.length > m.length &&
      m.every((word, i) => w[w.length - m.length + i] === word)
    );
  });
  return suffix.length === 1 ? suffix[0]!.slug : null;
}

/** Visible text lines of a saved EloShapes page. */
export const pageTextLines = (html: string): string[] =>
  html
    .replace(/<!---->/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
