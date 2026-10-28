/**
 * The pure rules behind the public mouse pages (`/mice/[slug]`), the
 * comparison pages (`/compare/[pair]`) and the size guide (SEO task,
 * 2026-10-28). Every number those pages print is computed here, from the
 * catalogue row or from the fit engine's own coefficients, never written by
 * hand and never by a model (hard rule 2).
 *
 * The hand lengths are the inverse of the engine's length target
 * (`LENGTH_FACTOR`, `src/server/fit/coefficients.ts`): the hand whose target
 * for a grip is exactly this mouse's length. The coefficients are provisional
 * (`ENGINE_IS_PROVISIONAL`), and the pages say so.
 */
import type { GripStyle } from "../contracts/fit";
import {
  ENGINE_IS_PROVISIONAL,
  LENGTH_FACTOR,
} from "../../server/fit/coefficients";
import type { MiceListRow } from "./list";

export { ENGINE_IS_PROVISIONAL };

export const GRIPS: readonly GripStyle[] = ["palm", "claw", "fingertip"];

/** The hand length (mm, whole) whose target for `grip` is a mouse this long. */
export function idealHandLengthMm(
  mouseLengthMm: number,
  grip: GripStyle,
): number {
  return Math.round(mouseLengthMm / LENGTH_FACTOR[grip]);
}

/** The target mouse length (mm, whole) for a hand this long and a grip. */
export function targetMouseLengthMm(
  handLengthMm: number,
  grip: GripStyle,
): number {
  return Math.round(handLengthMm * LENGTH_FACTOR[grip]);
}

export interface SizeChartRow {
  handLengthMm: number;
  /** Target mouse length per grip, mm. */
  target: Record<GripStyle, number>;
}

/** Hand lengths from `fromMm` to `toMm` in `stepMm` steps, with each grip's target. */
export function handSizeChart(
  fromMm = 160,
  toMm = 210,
  stepMm = 5,
): SizeChartRow[] {
  const rows: SizeChartRow[] = [];
  for (let h = fromMm; h <= toMm; h += stepMm) {
    rows.push({
      handLengthMm: h,
      target: {
        palm: targetMouseLengthMm(h, "palm"),
        claw: targetMouseLengthMm(h, "claw"),
        fingertip: targetMouseLengthMm(h, "fingertip"),
      },
    });
  }
  return rows;
}

/** One decimal, the way the pages print millimetres (no trailing `.0`). */
export function formatMm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * How far apart two shells are in size: length, width and height differences
 * scaled by the engine's sigmas for the same parts (6, 5 and 3 mm), so 1.0 is
 * "one sigma away". Shape counts too: a symmetrical and an ergonomic shell
 * are kept apart by a fixed penalty.
 */
export function shellDistance(a: MiceListRow, b: MiceListRow): number {
  const dl = (a.lengthMm - b.lengthMm) / 6;
  const dw = (a.widthMm - b.widthMm) / 5;
  const dh = (a.heightMm - b.heightMm) / 3;
  const shapePenalty =
    a.shape !== null && b.shape !== null && a.shape !== b.shape ? 2 : 0;
  return Math.sqrt(dl * dl + dw * dw + dh * dh) + shapePenalty;
}

/** Same brand, same three dimensions: an "SE", wired or colour twin. */
function sameShell(a: MiceListRow, b: MiceListRow): boolean {
  return (
    a.brand === b.brand &&
    a.lengthMm === b.lengthMm &&
    a.widthMm === b.widthMm &&
    a.heightMm === b.heightMm
  );
}

/**
 * The `n` mice closest in size to `mouse` (`shellDistance`). A twin of the
 * mouse itself is left out, and of several twins among the results only the
 * closest (then first listed) stays, so the list is not one shell under
 * several names. Ties keep catalogue order.
 */
export function similarMice(
  rows: readonly MiceListRow[],
  mouse: MiceListRow,
  n = 6,
): MiceListRow[] {
  const ranked = rows
    .filter((r) => r.slug !== mouse.slug && !sameShell(r, mouse))
    .map((r, i) => ({ r, i, d: shellDistance(mouse, r) }))
    .sort((x, y) => x.d - y.d || x.i - y.i)
    .map((x) => x.r);
  const out: MiceListRow[] = [];
  for (const r of ranked) {
    if (out.length === n) break;
    if (!out.some((o) => sameShell(o, r))) out.push(r);
  }
  return out;
}

const PAIR_SEPARATOR = "-vs-";

/** The one URL segment of a pair: both slugs in alphabetical order. */
export function pairSegment(a: string, b: string): string {
  const [first, second] = a < b ? [a, b] : [b, a];
  return `${first}${PAIR_SEPARATOR}${second}`;
}

/**
 * The two slugs of a pair segment, or null when it is not one. No catalogue
 * slug contains `-vs-` (a unit test checks the seed), so the split is
 * unambiguous.
 */
export function parsePairSegment(
  segment: string,
): { a: string; b: string; canonical: string } | null {
  const parts = segment.split(PAIR_SEPARATOR);
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(b)
  ) {
    return null;
  }
  if (a === b) return null;
  return { a, b, canonical: pairSegment(a, b) };
}

/**
 * Hand-picked pairs people search for, each written in canonical order. A pair
 * whose mouse is not listed in the catalogue is skipped by the pages.
 */
export const FEATURED_PAIRS: readonly (readonly [string, string])[] = [
  ["logitech-g-pro-x-superlight-2", "razer-viper-v3-pro"],
  ["logitech-g-pro-x-superlight-2", "razer-deathadder-v3-pro"],
  ["razer-deathadder-v3-pro", "zowie-ec2-dw"],
  ["razer-deathadder-v3-pro", "razer-viper-v3-pro"],
  ["logitech-g-pro-x-superlight-2", "wlmouse-beast-x-pro"],
  ["endgame-gear-op1-8k", "razer-viper-v3-pro"],
  ["lamzu-atlantis-mini-pro", "pulsar-x2-v3-mini"],
  ["vaxee-xe-s-wireless-4k", "zowie-s2-dw"],
  ["zowie-ec2-dw", "zowie-fk2-dw"],
  ["logitech-g502-x-plus", "razer-basilisk-v3-pro"],
  ["logitech-g-pro-x-superlight-2", "logitech-g-pro-x-superlight-2-dex"],
  ["glorious-model-o-2-wireless", "razer-viper-v3-pro"],
];

export interface PairDiff {
  /** b minus a, mm (one decimal). */
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  /** b minus a, g; null when either weight is unknown. */
  weightG: number | null;
}

const oneDecimal = (v: number) => Math.round(v * 10) / 10;

export function pairDiff(a: MiceListRow, b: MiceListRow): PairDiff {
  return {
    lengthMm: oneDecimal(b.lengthMm - a.lengthMm),
    widthMm: oneDecimal(b.widthMm - a.widthMm),
    heightMm: oneDecimal(b.heightMm - a.heightMm),
    weightG:
      a.weightG === null || b.weightG === null
        ? null
        : oneDecimal(b.weightG - a.weightG),
  };
}

/**
 * The pairs that go in the sitemap: the featured ones plus, for every mouse,
 * its closest `perMouse` neighbours. Deduplicated, canonical segments, both
 * mice present in `rows`.
 */
export function indexablePairs(
  rows: readonly MiceListRow[],
  perMouse = 3,
): string[] {
  const present = new Set(rows.map((r) => r.slug));
  const out = new Set<string>();
  for (const [a, b] of FEATURED_PAIRS) {
    if (present.has(a) && present.has(b)) out.add(pairSegment(a, b));
  }
  for (const mouse of rows) {
    for (const other of similarMice(rows, mouse, perMouse)) {
      out.add(pairSegment(mouse.slug, other.slug));
    }
  }
  return [...out];
}

/**
 * Whether one pair is in `indexablePairs(rows, perMouse)`, without building
 * the whole list: featured, or either mouse among the other's closest.
 */
export function isIndexablePair(
  rows: readonly MiceListRow[],
  a: MiceListRow,
  b: MiceListRow,
  perMouse = 3,
): boolean {
  const segment = pairSegment(a.slug, b.slug);
  if (FEATURED_PAIRS.some(([x, y]) => pairSegment(x, y) === segment))
    return true;
  return (
    similarMice(rows, a, perMouse).some((r) => r.slug === b.slug) ||
    similarMice(rows, b, perMouse).some((r) => r.slug === a.slug)
  );
}

/** Summary numbers of a set of mice, for the guides. Null on an empty set. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : oneDecimal((s[mid - 1] + s[mid]) / 2);
}
