import "server-only";
import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { getDb } from "../../db/client";
import { mice } from "../../db/schema";
import {
  sortMice,
  toMiceListRow,
  withoutExcludedFormFactors,
  type MiceListRow,
  type MiceQueryRow,
} from "../../lib/mice/list";
import { log } from "../log";

/** The all-mice page (`/mice`), candidate / 未拍板. */
const LOG_ROUTE = "/mice";

/** How long the list is reused before the next request reads it again. */
export const MICE_LIST_REVALIDATE_S = 60 * 60;
/** Tag for `revalidateTag`, should the catalogue be re-seeded and the page need to catch up sooner. */
export const MICE_LIST_TAG = "mice-list";

export type MiceListResult =
  | { status: "ok"; rows: MiceListRow[] }
  /** The catalogue could not be read (or came back empty): the page shows an empty list, not an error page. */
  | { status: "unavailable"; rows: [] };

/** The database handle the read needs: just `select`, so a test can fake it. */
type Db = Pick<ReturnType<typeof getDb>, "select">;

/**
 * The listed catalogue, as the page shows it. "Listed" is the one rule the
 * fit service uses (`listedOnly`: `mice.listed`, false hides a row
 * everywhere), so this list and the results agree on which mice exist.
 *
 * It selects the display columns and nothing else: no source address, data
 * source, descriptor values or photo path is read, so none can reach the page
 * (hard rule 1 and the "only what is shown" rule). `toMiceListRow` then copies
 * the fields one by one. Sorted by brand, then model.
 *
 * Vertical mice and trackballs are left out for now (`EXCLUDED_FORM_FACTORS`,
 * 暫時排除，Kirby 2026-10-12): the form factor is read only to decide that, and
 * is not copied onto the row. Everything the page counts comes from what is left.
 */
export async function loadMiceRows(db: Db = getDb()): Promise<MiceListRow[]> {
  const rows: MiceQueryRow[] = await db
    .select({
      slug: mice.slug,
      brand: mice.brand,
      model: mice.model,
      size: mice.size,
      shape: mice.shape,
      connectivity: mice.connectivity,
      lengthMm: mice.lengthMm,
      widthMm: mice.widthMm,
      heightMm: mice.heightMm,
      weightG: mice.weightG,
      formFactor: mice.formFactor,
    })
    .from(mice)
    .where(eq(mice.listed, true));
  return sortMice(withoutExcludedFormFactors(rows).map(toMiceListRow));
}

/**
 * `loadMiceRows` through Next's data cache: one database read an hour (and
 * after `revalidateTag(MICE_LIST_TAG)`), shared by every request, instead of
 * one per visit. The page itself is rendered per request (it reads the
 * visitor's language), so `next build` never calls this and needs no
 * database. A read that throws, or returns no row, is not stored: the next
 * request tries again.
 */
const cachedMiceRows = unstable_cache(
  async () => {
    const rows = await loadMiceRows();
    if (rows.length === 0) throw new Error("empty catalogue");
    return rows;
  },
  ["mice-list-v1"],
  { revalidate: MICE_LIST_REVALIDATE_S, tags: [MICE_LIST_TAG] },
);

/** What the page calls. Never throws: a failed read is an empty, `unavailable` result. */
export async function getMiceList(
  read: () => Promise<MiceListRow[]> = cachedMiceRows,
): Promise<MiceListResult> {
  try {
    return { status: "ok", rows: await read() };
  } catch {
    log.warn("mice_list_unavailable", { route: LOG_ROUTE });
    return { status: "unavailable", rows: [] };
  }
}
