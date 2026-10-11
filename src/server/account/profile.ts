import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { mice, users } from "../../db/schema";
import { mouseNamesFromRows } from "../../app/account/profile-model";

/**
 * The signed-in person's own e-mail address, for the profile page only. The
 * session that reaches the server and the browser carries no e-mail (see
 * `toPublicSession`), so the page reads it here, by the user id from the
 * session, and renders it for its owner alone. Null when the row has none.
 */
export async function readAccountEmail(
  userId: string,
  db = getDb(),
): Promise<string | null> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.email ?? null;
}

/**
 * Catalogue slug -> "Brand Model" for every mouse, unlisted ones included (a
 * person may have rated one that was hidden later). Only these three columns
 * are read.
 */
export async function readMouseNames(
  db = getDb(),
): Promise<Record<string, string>> {
  const rows = await db
    .select({ slug: mice.slug, brand: mice.brand, model: mice.model })
    .from(mice);
  return mouseNamesFromRows(rows);
}
