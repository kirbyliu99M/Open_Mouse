/**
 * The real dependencies of the error-photo routes. Everything that needs the
 * database is built lazily, so a flag-off deploy answers 404 (and a deploy
 * without the Blob token 503) without `DATABASE_URL`.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "../../db/client";
import { errorPhotoFlag } from "../../lib/flags";
import { createDrizzleRateLimiter } from "../analysis/drizzle-rate-limiter";
import {
  ERROR_PHOTO_DELETE_RATE_LIMIT_MAX,
  ERROR_PHOTO_DELETE_RATE_LIMIT_WINDOW_MS,
  ERROR_PHOTO_RATE_LIMIT_MAX,
  ERROR_PHOTO_RATE_LIMIT_WINDOW_MS,
} from "../scans/rate-limit-config";
import { createVercelErrorPhotoBlobStore } from "./blob-store";
import { createDrizzleErrorPhotoRepo } from "./drizzle-repo";
import type { ErrorPhotoDeps } from "./service";

export function errorPhotoRouteDeps(op: "upload" | "delete"): ErrorPhotoDeps {
  return {
    // Fixed at build time: next.config.ts defines the variable for every
    // build (review F1), so changing it needs a rebuild and redeploy.
    enabled: errorPhotoFlag(process.env.NEXT_PUBLIC_ERROR_PHOTO_ENABLED),
    blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    limiter: () =>
      createDrizzleRateLimiter(
        op === "upload"
          ? {
              windowMs: ERROR_PHOTO_RATE_LIMIT_WINDOW_MS,
              limit: ERROR_PHOTO_RATE_LIMIT_MAX,
              keyPrefix: "error-photo:",
            }
          : {
              windowMs: ERROR_PHOTO_DELETE_RATE_LIMIT_WINDOW_MS,
              limit: ERROR_PHOTO_DELETE_RATE_LIMIT_MAX,
              keyPrefix: "error-photo-delete:",
            },
      ),
    repo: () => createDrizzleErrorPhotoRepo(getDb),
    blob: createVercelErrorPhotoBlobStore(),
    randomUUID: () => randomUUID(),
  };
}
