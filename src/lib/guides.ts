/**
 * The guides (`/guides/...`, SEO/GEO task 2026-10-28): their paths and dates,
 * and the catalogue figures they print, computed here (hard rule 2). Pure.
 */
import type { Shape } from "./contracts/descriptors";
import { medianOf } from "./mice/compare";
import type { MiceListRow } from "./mice/list";

export const GUIDES = [
  {
    key: "size",
    path: "/guides/mouse-size-for-hand-size",
    published: "2026-10-28",
  },
  {
    key: "shape",
    path: "/guides/symmetrical-vs-ergonomic",
    published: "2026-10-28",
  },
] as const;

export type GuideKey = (typeof GUIDES)[number]["key"];

export interface GroupStats {
  count: number;
  medianLengthMm: number | null;
  medianWidthMm: number | null;
  medianHeightMm: number | null;
  /** Over the mice with a weight only. */
  medianWeightG: number | null;
}

export function groupStats(rows: readonly MiceListRow[]): GroupStats {
  const weights = rows.flatMap((r) => (r.weightG === null ? [] : [r.weightG]));
  return {
    count: rows.length,
    medianLengthMm: medianOf(rows.map((r) => r.lengthMm)),
    medianWidthMm: medianOf(rows.map((r) => r.widthMm)),
    medianHeightMm: medianOf(rows.map((r) => r.heightMm)),
    medianWeightG: medianOf(weights),
  };
}

export const SIZE_ORDER: readonly MiceListRow["size"][] = [
  "small",
  "medium",
  "large",
];

export function statsBySize(
  rows: readonly MiceListRow[],
): Record<MiceListRow["size"], GroupStats> {
  return {
    small: groupStats(rows.filter((r) => r.size === "small")),
    medium: groupStats(rows.filter((r) => r.size === "medium")),
    large: groupStats(rows.filter((r) => r.size === "large")),
  };
}

export const SHAPES_COMPARED: readonly Extract<
  Shape,
  "symmetrical" | "ergonomic"
>[] = ["symmetrical", "ergonomic"];

export function statsByShape(
  rows: readonly MiceListRow[],
): Record<"symmetrical" | "ergonomic", GroupStats> {
  return {
    symmetrical: groupStats(rows.filter((r) => r.shape === "symmetrical")),
    ergonomic: groupStats(rows.filter((r) => r.shape === "ergonomic")),
  };
}

/**
 * The `n` lightest mice of a shape with a known weight, lightest first; ties
 * keep catalogue order. Same-brand twins of identical size and weight count
 * once (the first listed), so a list is not five colours of one shell.
 */
export function lightestOfShape(
  rows: readonly MiceListRow[],
  shape: Shape,
  n = 5,
): MiceListRow[] {
  const seen = new Set<string>();
  return rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.shape === shape && r.weightG !== null)
    .sort(
      (x, y) => (x.r.weightG as number) - (y.r.weightG as number) || x.i - y.i,
    )
    .filter(({ r }) => {
      const key = `${r.brand}|${r.lengthMm}|${r.widthMm}|${r.heightMm}|${r.weightG}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, n)
    .map(({ r }) => r);
}
