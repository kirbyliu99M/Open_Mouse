/**
 * The real dependencies of the tester routes. Read at request time (no build
 * flag): `TESTER_OPEN` and `TESTER_CODES` both unset -> both routes answer
 * 404 without touching the
 * database. Everything that needs the database is built lazily.
 */
import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "../../db/client";
import { createDrizzleRateLimiter } from "../analysis/drizzle-rate-limiter";
import { createVercelErrorPhotoBlobStore } from "../error-photos/blob-store";
import { testerOpenConfigured } from "../../lib/tester/enabled";
import { parseTesterCodes } from "./codes";
import { createDrizzleTesterShotRepo } from "./drizzle-repo";
import {
  TESTER_CHECK_RATE_LIMIT,
  TESTER_SHOT_RATE_LIMIT,
  type TesterDeps,
} from "./service";

export function testerRouteDeps(op: "check" | "shot"): TesterDeps {
  const limit =
    op === "check" ? TESTER_CHECK_RATE_LIMIT : TESTER_SHOT_RATE_LIMIT;
  return {
    open: testerOpenConfigured(process.env.TESTER_OPEN),
    codes: parseTesterCodes(process.env.TESTER_CODES),
    blobConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    limiter: () =>
      createDrizzleRateLimiter({
        windowMs: limit.windowMs,
        limit: limit.max,
        keyPrefix: `tester-${op}:`,
      }),
    repo: () => createDrizzleTesterShotRepo(getDb),
    // The same private store as the error photos, under its own folder.
    blob: createVercelErrorPhotoBlobStore(),
    randomUUID: () => randomUUID(),
  };
}

/** Whether the tester page is on (the page's own `notFound()` check). */
export function testerPageEnabled(): boolean {
  return (
    testerOpenConfigured(process.env.TESTER_OPEN) ||
    parseTesterCodes(process.env.TESTER_CODES) !== null
  );
}

/** Open mode: the page skips the code step (anonymous id instead). */
export function testerPageOpen(): boolean {
  return testerOpenConfigured(process.env.TESTER_OPEN);
}
