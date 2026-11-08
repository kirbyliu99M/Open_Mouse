/**
 * The real `ErrorPhotoBlobStore`: the private Vercel Blob store, through
 * `@vercel/blob` (the token is read by the SDK from `BLOB_READ_WRITE_TOKEN`).
 * Every write is private, at exactly the given pathname, and never replaces
 * an existing blob. Not unit-tested (network); the routes' logic is, with a
 * fake (tests/unit/error-photos-service.test.ts).
 */
import "server-only";
import { del, list, put } from "@vercel/blob";
import type { ErrorPhotoBlobStore } from "./service";

export function createVercelErrorPhotoBlobStore(): ErrorPhotoBlobStore {
  return {
    async put(pathname, body) {
      await put(pathname, Buffer.from(body), {
        access: "private",
        contentType: "image/jpeg",
        addRandomSuffix: false,
        allowOverwrite: false,
      });
    },
    async del(pathnames) {
      if (pathnames.length === 0) return;
      await del([...pathnames]);
    },
    async list({ prefix, cursor }) {
      const page = await list({ prefix, ...(cursor ? { cursor } : {}) });
      return {
        blobs: page.blobs.map((b) => ({
          pathname: b.pathname,
          uploadedAt: b.uploadedAt,
        })),
        cursor: page.cursor,
        hasMore: page.hasMore,
      };
    },
  };
}
