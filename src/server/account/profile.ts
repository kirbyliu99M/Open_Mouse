import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { mice, scanSessions, scans, users } from "../../db/schema";
import { mouseNamesFromRows } from "../../app/account/profile-model";
import type { CatalogueChoice } from "../../app/account/questionnaire-model";
import { ownershipPredicate } from "../scans/drizzle-repo";

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

/**
 * The mice the questionnaire's picker offers: the rows listed for the public
 * (`listed`), as slug, brand and model. Unlisted rows are left out here, while
 * `readMouseNames` keeps them so an old answer still shows its name.
 */
export async function readCatalogueChoices(
  db = getDb(),
): Promise<CatalogueChoice[]> {
  return db
    .select({ slug: mice.slug, brand: mice.brand, model: mice.model })
    .from(mice)
    .where(eq(mice.listed, true));
}

/**
 * The newest scan of the anonymous scan session this browser's cookie names,
 * or null: no cookie, an unknown session, one that expired, or one that was
 * claimed by an account (then it is that account's scan, not the cookie's: the
 * ownership rule in `routes.ts`, reused from `ownershipPredicate`). The id goes
 * only into the page of the browser that holds the cookie, so it is its own
 * owner's id and nobody else's.
 */
export async function readSessionLatestScanId(
  sessionId: string | null,
  now = new Date(),
  db = getDb(),
): Promise<string | null> {
  if (sessionId === null) return null;
  const ownership = ownershipPredicate({
    userId: null,
    cookieSessionId: sessionId,
    now,
  });
  const rows = await db
    .select({ scanId: scans.id })
    .from(scans)
    .innerJoin(scanSessions, eq(scans.sessionId, scanSessions.id))
    .where(ownership)
    .orderBy(desc(scans.createdAt))
    .limit(1);
  return rows[0]?.scanId ?? null;
}
