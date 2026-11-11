/**
 * `ErrorPhotoRepo` over the `error_photos` table (migration 0015). Covered
 * end to end against PGlite by tests/unit/error-photos-db.test.ts.
 */
import "server-only";
import { asc, eq, inArray, lt } from "drizzle-orm";
import type { getDb } from "../../db/client";
import { errorPhotos } from "../../db/schema";
import type { ErrorPhotoRepo } from "./repo";

type Db = ReturnType<typeof getDb>;

/** `db` may be a factory, so nothing touches the database before a route has let the request through. */
export function createDrizzleErrorPhotoRepo(
  db: Db | (() => Db),
): ErrorPhotoRepo {
  const handle = () => (typeof db === "function" ? db() : db);
  return {
    async insert(row) {
      await handle().insert(errorPhotos).values({
        consentVersion: row.consentVersion,
        blobPathname: row.blobPathname,
        deleteCodeSha256: row.deleteCodeSha256,
        meta: row.meta,
        bytes: row.bytes,
        createdOn: row.createdOn,
      });
    },
    async findByCodeHash(deleteCodeSha256) {
      const [row] = await handle()
        .select({
          id: errorPhotos.id,
          blobPathname: errorPhotos.blobPathname,
        })
        .from(errorPhotos)
        .where(eq(errorPhotos.deleteCodeSha256, deleteCodeSha256))
        .limit(1);
      return row ?? null;
    },
    async deleteById(id) {
      await handle().delete(errorPhotos).where(eq(errorPhotos.id, id));
    },
    async listCreatedBefore(cutoff, limit) {
      return handle()
        .select({
          id: errorPhotos.id,
          blobPathname: errorPhotos.blobPathname,
        })
        .from(errorPhotos)
        .where(lt(errorPhotos.createdOn, cutoff))
        .orderBy(asc(errorPhotos.createdOn), asc(errorPhotos.id))
        .limit(limit);
    },
    async deleteByIds(ids) {
      if (ids.length === 0) return 0;
      const deleted = await handle()
        .delete(errorPhotos)
        .where(inArray(errorPhotos.id, [...ids]))
        .returning({ id: errorPhotos.id });
      return deleted.length;
    },
    async existingPathnames(pathnames) {
      if (pathnames.length === 0) return [];
      const rows = await handle()
        .select({ blobPathname: errorPhotos.blobPathname })
        .from(errorPhotos)
        .where(inArray(errorPhotos.blobPathname, [...pathnames]));
      return rows.map((r) => r.blobPathname);
    },
  };
}
