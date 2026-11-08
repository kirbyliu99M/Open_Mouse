/**
 * `POST /api/tester/check` and `POST /api/tester/shots` (candidate 未拍板;
 * contract src/lib/contracts/tester.ts). Everything is injected (the codes,
 * the limiter, the table, the Blob store, the random path and the clock), so
 * it is unit-tested with no network: tests/unit/tester-service.test.ts.
 *
 * Both routes: `TESTER_CODES` unset -> 404, before anything is read. A code
 * that is malformed or not configured -> 404 too (one answer for "no such
 * page" and "wrong code"). Codes are compared in constant time (./codes.ts).
 *
 * Check, in order: 413 (body over 1 KB) -> 429 (per-IP, key prefix
 * `tester-check:`) -> JSON `{ code }` -> 404 or 200 `{ participant }`.
 *
 * Shot, in order: 413 (declared, then counted while streaming) -> 429 (per
 * IP, `tester-shot:`) -> multipart -> `code` (404) -> `record` must pass
 * `testerRecordSchema` and its phone model the survey comment filter
 * (`commentText`: no e-mail, phone number or control characters; and no URL)
 * -> 400 -> the photo, when `record.photo` says one is sent: exactly the
 * error photo's checks (image/jpeg, at most `ERROR_PHOTO_MAX_BYTES`, SOI, no
 * APP1, no comment, nothing after EOI, frame exactly `record.photo`'s size)
 * -> 400; a photo part without `record.photo` (or the reverse) -> 400; a
 * photo with no Blob token -> 503. Then the idempotency key: a `shotId`
 * already stored -> 200 and nothing new. Else the photo goes to the PRIVATE
 * store at `tester/<uuid>.jpg`, never overwriting, and the row is inserted
 * with the participant id only (`P07`) and the Asia/Taipei day; a concurrent
 * repeat that won the unique `shot_id` -> its blob is deleted and 200; an
 * insert that fails deletes the blob just written (the daily orphan sweep
 * takes it if that fails too) -> 500. New -> 201 `{ shotId }`.
 *
 * Nothing here logs or returns a record value, the photo or a code: a 500's
 * log line names only the operation and the error's class (src/server/log.ts),
 * and nothing is rethrown, so no body reaches Sentry either.
 */
import {
  ERROR_PHOTO_MAX_BYTES,
  ERROR_PHOTO_MAX_SIDE_PX,
} from "../../lib/contracts/error-photo";
import {
  participantOf,
  testerCheckResponseSchema,
  testerCheckSchema,
  testerRecordSchema,
  testerShotResponseSchema,
  type TesterRecord,
} from "../../lib/contracts/tester";
import { checkErrorPhotoJpeg } from "../../lib/error-photo/jpeg";
import { phoneModelAllowed } from "../../lib/tester/phoneModel";
import {
  BodyTooLargeError,
  declaredTooLarge,
  isRateLimited,
  readLimitedBytes,
  type ErrorPhotoBlobStore,
} from "../error-photos/service";
import { log } from "../log";
import type { RateLimiter } from "../scans/rate-limit-config";
import { matchTesterCode } from "./codes";
import { taipeiDay } from "./day";
import type { TesterShotRepo } from "./repo";

export const TESTER_CHECK_MAX_BODY_BYTES = 1024;
/** The photo, plus the record and the multipart framing. */
export const TESTER_SHOT_MAX_BODY_BYTES = ERROR_PHOTO_MAX_BYTES + 32 * 1024;
/** The `record` field as JSON text: the strict schema's largest record is far below this. */
export const TESTER_RECORD_MAX_CHARS = 8192;
/** The store folder every tester photo lives in (the purge lists it). */
export const TESTER_PHOTO_PREFIX = "tester/";
export const TESTER_LOG_ROUTE = "/api/tester";

/**
 * Per IP (candidates 未拍板): a code guesser gets 30 tries an hour; a tester
 * on a busy evening sends far fewer than 120 shots an hour.
 */
export const TESTER_CHECK_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 30 };
export const TESTER_SHOT_RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 120 };

export interface TesterDeps {
  /** `parseTesterCodes(process.env.TESTER_CODES)`: null means the feature is off. */
  readonly codes: readonly string[] | null;
  /** Whether `BLOB_READ_WRITE_TOKEN` is set. */
  readonly blobConfigured: boolean;
  /** Built only once the codes let the request through. */
  readonly limiter: () => RateLimiter;
  readonly repo: () => TesterShotRepo;
  readonly blob: Pick<ErrorPhotoBlobStore, "put" | "del">;
  readonly randomUUID: () => string;
  readonly now?: () => Date;
}

const NO_STORE = { "cache-control": "no-store" } as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...NO_STORE },
  });
}

const NOT_FOUND = () => json(404, { error: "Not found." });
const TOO_LARGE = () => json(413, { error: "Request body too large." });
const TOO_MANY = () =>
  json(429, { error: "Too many requests. Try again later." });
const INVALID = (what: string) => json(400, { error: `Invalid ${what}.` });

function logTesterFailure(op: "check" | "shot", error: unknown): Response {
  log.error("tester.failed", { route: TESTER_LOG_ROUTE, op, error });
  return json(500, { error: "Something went wrong. Try again in a moment." });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `tester/<uuid>.jpg`; refuses anything that is not a UUID. */
export function testerPhotoPathname(uuid: string): string {
  if (!UUID.test(uuid)) throw new RangeError("Not a UUID.");
  return `${TESTER_PHOTO_PREFIX}${uuid.toLowerCase()}.jpg`;
}

async function readBody(
  request: Request,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | "too-large"> {
  try {
    return await readLimitedBytes(request, max);
  } catch (error) {
    if (error instanceof BodyTooLargeError) return "too-large";
    throw error;
  }
}

export async function handleTesterCheck(
  request: Request,
  deps: TesterDeps,
): Promise<Response> {
  if (!deps.codes) return NOT_FOUND();
  try {
    if (declaredTooLarge(request, TESTER_CHECK_MAX_BODY_BYTES))
      return TOO_LARGE();
    if (await isRateLimited(request, deps.limiter())) return TOO_MANY();
    const body = await readBody(request, TESTER_CHECK_MAX_BODY_BYTES);
    if (body === "too-large") return TOO_LARGE();
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return NOT_FOUND();
    }
    const parsed = testerCheckSchema.safeParse(payload);
    const code = matchTesterCode(
      parsed.success ? parsed.data.code : null,
      deps.codes,
    );
    if (!code) return NOT_FOUND();
    return json(
      200,
      testerCheckResponseSchema.parse({ participant: participantOf(code) }),
    );
  } catch (error) {
    return logTesterFailure("check", error);
  }
}

function parseRecord(text: FormDataEntryValue | null): TesterRecord | null {
  if (typeof text !== "string" || text.length > TESTER_RECORD_MAX_CHARS)
    return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  // The issues are not echoed: they could quote a value.
  const parsed = testerRecordSchema.safeParse(raw);
  if (!parsed.success || !phoneModelAllowed(parsed.data.phoneModel))
    return null;
  return parsed.data;
}

export async function handleTesterShot(
  request: Request,
  deps: TesterDeps,
): Promise<Response> {
  if (!deps.codes) return NOT_FOUND();
  try {
    if (declaredTooLarge(request, TESTER_SHOT_MAX_BODY_BYTES))
      return TOO_LARGE();
    if (await isRateLimited(request, deps.limiter())) return TOO_MANY();
    const body = await readBody(request, TESTER_SHOT_MAX_BODY_BYTES);
    if (body === "too-large") return TOO_LARGE();

    const contentType = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data\s*;/i.test(contentType)) return INVALID("form");
    let form: FormData;
    try {
      form = await new Response(body, {
        headers: { "content-type": contentType },
      }).formData();
    } catch {
      return INVALID("form");
    }

    const code = matchTesterCode(form.get("code"), deps.codes);
    if (!code) return NOT_FOUND();

    const record = parseRecord(form.get("record"));
    if (!record) return INVALID("record");

    const photoPart = form.get("photo");
    let photo: Uint8Array | null = null;
    if (record.photo) {
      if (
        !(photoPart instanceof Blob) ||
        photoPart.type !== "image/jpeg" ||
        photoPart.size === 0 ||
        photoPart.size > ERROR_PHOTO_MAX_BYTES
      )
        return INVALID("photo");
      const bytes = new Uint8Array(await photoPart.arrayBuffer());
      const problem = checkErrorPhotoJpeg(
        bytes,
        record.photo,
        ERROR_PHOTO_MAX_SIDE_PX,
      );
      if (problem) return json(400, { error: "Invalid photo.", problem });
      if (!deps.blobConfigured)
        return json(503, { error: "Photo storage is not available." });
      photo = bytes;
    } else if (photoPart !== null) {
      return INVALID("photo");
    }

    const repo = deps.repo();
    const stored = () =>
      json(200, testerShotResponseSchema.parse({ shotId: record.shotId }));
    // Idempotent retry: this shot is already stored.
    if (await repo.hasShot(record.shotId)) return stored();

    const pathname = photo ? testerPhotoPathname(deps.randomUUID()) : null;
    const now = (deps.now ?? (() => new Date()))();
    if (photo && pathname) await deps.blob.put(pathname, photo);
    const removeBlob = async () => {
      if (!pathname) return;
      try {
        await deps.blob.del([pathname]);
      } catch (cleanupError) {
        log.error("tester.orphan_cleanup_failed", {
          route: TESTER_LOG_ROUTE,
          op: "shot",
          error: cleanupError,
        });
      }
    };
    let inserted: boolean;
    try {
      inserted = await repo.insert({
        shotId: record.shotId,
        participant: participantOf(code),
        day: taipeiDay(now),
        record,
        photoPathname: pathname,
      });
    } catch (error) {
      await removeBlob();
      throw error;
    }
    if (!inserted) {
      // A concurrent request with the same shotId got there first: its row
      // (and photo) is the one kept.
      await removeBlob();
      return stored();
    }
    return json(201, testerShotResponseSchema.parse({ shotId: record.shotId }));
  } catch (error) {
    return logTesterFailure("shot", error);
  }
}
