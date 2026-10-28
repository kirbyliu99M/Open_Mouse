import "server-only";
import mouseMedia from "@/data/mouse-media.json";
import type { MiceListRow } from "@/lib/mice/list";
import { mediaForSlug, type MouseMediaEntry } from "@/lib/results/mouseMedia";
import { getMiceList } from "@/server/catalogue/list-mice";

/**
 * The listed catalogue for the public mouse, comparison and guide pages: the
 * same cached read as `/mice` (`getMiceList`), so every page agrees on which
 * mice exist. An unreadable catalogue is an empty list.
 */
export async function listedMice(): Promise<MiceListRow[]> {
  const list = await getMiceList();
  return list.status === "ok" ? list.rows : [];
}

export function findMouse(
  rows: readonly MiceListRow[],
  slug: string,
): MiceListRow | null {
  return rows.find((r) => r.slug === slug) ?? null;
}

/** The mouse's official link and photo (`src/data/mouse-media.json`), or null. */
export function mouseMediaFor(slug: string): MouseMediaEntry | null {
  return mediaForSlug(mouseMedia, slug);
}

export function mouseName(row: Pick<MiceListRow, "brand" | "model">): string {
  return `${row.brand} ${row.model}`;
}
