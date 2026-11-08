/**
 * `POST /api/error-photos` and `POST /api/error-photos/delete` (candidate
 * 未拍板; contract src/lib/contracts/error-photo.ts, whose MUST lists are the
 * acceptance criteria here). The one way a photo reaches the server: a person
 * taps "send this photo" on a scan failure or the "numbers look wrong?" link,
 * reads the notice, ticks consent, and the browser uploads a cropped,
 * re-encoded copy. Everything here is injected (the limiter, the table, the
 * Blob store, the random path and the clock), so it is unit-tested with no
 * network: tests/unit/error-photos-service.test.ts.
 *
 * Upload, in order:
 *   flag off -> 404; no Blob token -> 503 (nothing read, nothing stored);
 *   declared body over the cap -> 413 (before any byte is read);
 *   per-IP limit -> 429 (before anything is parsed or written);
 *   body read with the same cap counted while streaming -> 413;
 *   `meta` must pass `errorPhotoMetaSchema` -> else 400;
 *   `photo` must be image/jpeg, at most `ERROR_PHOTO_MAX_BYTES`, start with
 *   SOI, hold no APP1 (Exif/XMP), no comment, nothing after EOI, and its frame
 *   must be exactly `meta.widthPx` x `meta.heightPx` (at most
 *   `ERROR_PHOTO_MAX_SIDE_PX`) -> else 400;
 *   `code`, the 12-character deletion code the BROWSER made, must pass
 *   `errorPhotoCodeSchema` -> else 400; only its SHA-256 is kept, and it is
 *   the upload's idempotency key (review #241 round 3): a hash already stored
 *   -> 200 with the same code and nothing stored again (checked before any
 *   write); else the photo goes to the PRIVATE store at
 *   `error-photos/<uuid>.jpg` (a fresh random UUID: never a scan id, an IP or
 *   a user id), never overwriting; the row is inserted with `created_on` = the
 *   start of the UTC day; if the insert fails, the blob just written is
 *   deleted (no orphan), and if that was because a concurrent request with the
 *   same code got there first (the unique hash), the answer is that one's 200;
 *   201 `{ deleteCode }` for a new photo.
 *
 * Delete: flag / token as above; 413 / 429; `{ code }` must pass
 * `errorPhotoDeleteSchema` -> else 400; an unknown code -> 404; else the blob,
 * then the row, are deleted -> 204.
 *
 * Nothing here logs or returns the metadata values, the photo or a code. A
 * failure is a 500 whose log line names only the operation and the error's
 * class (src/server/log.ts); nothing is rethrown, so no request body or query
 * parameter reaches Sentry through an unhandled error either.
 */
import { createHash } from "node:crypto";
import {
  ERROR_PHOTO_MAX_BYTES,
  ERROR_PHOTO_MAX_SIDE_PX,
  errorPhotoDeleteSchema,
  errorPhotoMetaSchema,
  errorPhotoCodeSchema,
  errorPhotoResponseSchema,
  type ErrorPhotoMeta,
} from "../../lib/contracts/error-photo";
import { checkErrorPhotoJpeg } from "../../lib/error-photo/jpeg";
import { UNKNOWN_IP_KEY, resolveClientIp } from "../analysis/ip";
import { log } from "../log";
import type { RateLimiter } from "../scans/rate-limit-config";
import { startOfUtcDay } from "../survey/profile";
import type { ErrorPhotoRepo } from "./repo";

/** The photo, plus room for the metadata and the multipart framing. */
export const ERROR_PHOTO_MAX_BODY_BYTES = ERROR_PHOTO_MAX_BYTES + 16 * 1024;
/** The `meta` field, as JSON text: the strict schema's largest object is far below this. */
export const ERROR_PHOTO_META_MAX_CHARS = 4096;
/** `{ "code": "XXXXXXXXXXXX" }` with room for whitespace. */
export const ERROR_PHOTO_DELETE_MAX_BODY_BYTES = 1024;
/** The store folder every error photo lives in (the purge lists it). */
export const ERROR_PHOTO_PREFIX = "error-photos/";
export const ERROR_PHOTO_LOG_ROUTE = "/api/error-photos";

/** The private Blob store, as these routes and the purge use it. */
export interface ErrorPhotoBlobStore {
  /** `access: "private"`, `addRandomSuffix: false`, `allowOverwrite: false`. */
  put(pathname: string, body: Uint8Array): Promise<void>;
  del(pathnames: readonly string[]): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{
    blobs: readonly { pathname: string; uploadedAt: Date }[];
    cursor?: string;
    hasMore: boolean;
  }>;
}

export interface ErrorPhotoDeps {
  /** `NEXT_PUBLIC_ERROR_PHOTO_ENABLED === "1"`. */
  readonly enabled: boolean;
  /** Whether `BLOB_READ_WRITE_TOKEN` is set. */
  readonly blobConfigured: boolean;
  /** Built only once the flag and the token let the request through. */
  readonly limiter: () => RateLimiter;
  readonly repo: () => ErrorPhotoRepo;
  readonly blob: ErrorPhotoBlobStore;
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

export class BodyTooLargeError extends Error {}

/** The declared length alone already exceeds `max`. */
export function declaredTooLarge(request: Request, max: number): boolean {
  const declared = request.headers.get("content-length");
  if (declared === null) return false;
  const n = Number(declared);
  return Number.isFinite(n) && n > max;
}

/** Reads the body as bytes, counting while streaming: a missing or understated length is no way past the cap. */
export async function readLimitedBytes(
  request: Request,
  max: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (declaredTooLarge(request, max)) throw new BodyTooLargeError();
  if (!request.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) throw new BodyTooLargeError();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** The metadata as stored: everything but `consent`, which has its own column. */
export function withoutConsent(
  meta: ErrorPhotoMeta,
): Omit<ErrorPhotoMeta, "consent"> {
  const stored: Partial<ErrorPhotoMeta> = { ...meta };
  delete stored.consent;
  return stored as Omit<ErrorPhotoMeta, "consent">;
}

/** Lower-case hex SHA-256 of a deletion code (the only form stored). */
export function hashDeleteCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `error-photos/<uuid>.jpg`; refuses anything that is not a UUID. */
export function errorPhotoPathname(uuid: string): string {
  if (!UUID.test(uuid)) throw new RangeError("Not a UUID.");
  return `${ERROR_PHOTO_PREFIX}${uuid.toLowerCase()}.jpg`;
}

export async function isRateLimited(
  request: Request,
  limiter: RateLimiter,
): Promise<boolean> {
  // As the fit, survey and feedback routes: no usable IP (local dev, e2e)
  // skips the limit; on Vercel the platform always sets the header.
  const clientIp = resolveClientIp(request.headers);
  if (clientIp === UNKNOWN_IP_KEY) return false;
  return !(await limiter.allow(clientIp));
}

/** The 500 of either route; the log line names only the operation and the error's class. */
export function logErrorPhotoFailure(
  op: "upload" | "delete" | "purge",
  error: unknown,
): Response {
  log.error("error_photo.failed", { route: ERROR_PHOTO_LOG_ROUTE, op, error });
  return json(500, { error: "Something went wrong. Try again in a moment." });
}

const NOT_FOUND = () => json(404, { error: "Not found." });
const UNAVAILABLE = () =>
  json(503, { error: "Photo storage is not available." });
const TOO_LARGE = () => json(413, { error: "Request body too large." });
const TOO_MANY = () =>
  json(429, { error: "Too many requests. Try again later." });

export async function handleErrorPhotoUpload(
  request: Request,
  deps: ErrorPhotoDeps,
): Promise<Response> {
  if (!deps.enabled) return NOT_FOUND();
  if (!deps.blobConfigured) return UNAVAILABLE();
  try {
    if (declaredTooLarge(request, ERROR_PHOTO_MAX_BODY_BYTES))
      return TOO_LARGE();
    if (await isRateLimited(request, deps.limiter())) return TOO_MANY();

    let body: Uint8Array<ArrayBuffer>;
    try {
      body = await readLimitedBytes(request, ERROR_PHOTO_MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) return TOO_LARGE();
      throw error;
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data\s*;/i.test(contentType))
      return json(400, { error: "Expected multipart/form-data." });
    let form: FormData;
    try {
      form = await new Response(body, {
        headers: { "content-type": contentType },
      }).formData();
    } catch {
      return json(400, { error: "Malformed form." });
    }

    const metaText = form.get("meta");
    if (
      typeof metaText !== "string" ||
      metaText.length > ERROR_PHOTO_META_MAX_CHARS
    )
      return json(400, { error: "Invalid metadata." });
    let metaJson: unknown;
    try {
      metaJson = JSON.parse(metaText);
    } catch {
      return json(400, { error: "Invalid metadata." });
    }
    // The issues are not echoed: they could quote a value.
    const meta = errorPhotoMetaSchema.safeParse(metaJson);
    if (!meta.success) return json(400, { error: "Invalid metadata." });

    const photo = form.get("photo");
    if (
      !(photo instanceof Blob) ||
      photo.type !== "image/jpeg" ||
      photo.size === 0 ||
      photo.size > ERROR_PHOTO_MAX_BYTES
    )
      return json(400, { error: "Invalid photo." });
    const bytes = new Uint8Array(await photo.arrayBuffer());
    const problem = checkErrorPhotoJpeg(
      bytes,
      meta.data,
      ERROR_PHOTO_MAX_SIDE_PX,
    );
    if (problem) return json(400, { error: "Invalid photo.", problem });

    // The code is the browser's (made before sending, shown even without a
    // response). Never echoed back unless it passes the contract's format.
    const codeField = form.get("code");
    const parsedCode = errorPhotoCodeSchema.safeParse(codeField);
    if (!parsedCode.success) return json(400, { error: "Invalid code." });
    const code = parsedCode.data;
    const codeHash = hashDeleteCode(code);
    const repo = deps.repo();
    const stored = () =>
      json(200, errorPhotoResponseSchema.parse({ deleteCode: code }));
    // Idempotent retry: this code's photo is already stored.
    if (await repo.findByCodeHash(codeHash)) return stored();

    const pathname = errorPhotoPathname(deps.randomUUID());
    const now = (deps.now ?? (() => new Date()))();
    await deps.blob.put(pathname, bytes);
    try {
      await repo.insert({
        consentVersion: meta.data.consent,
        blobPathname: pathname,
        deleteCodeSha256: codeHash,
        // Consent has its own column; the stored meta is the rest.
        meta: withoutConsent(meta.data),
        bytes: bytes.byteLength,
        createdOn: startOfUtcDay(now),
      });
    } catch (error) {
      // No row means no way to delete it by code and no purge by date: the
      // blob goes now. If that fails too, the daily orphan sweep takes it.
      try {
        await deps.blob.del([pathname]);
      } catch (cleanupError) {
        log.error("error_photo.orphan_cleanup_failed", {
          route: ERROR_PHOTO_LOG_ROUTE,
          op: "upload",
          error: cleanupError,
        });
      }
      // A concurrent request with the same code won the unique hash: its photo
      // is the one kept, and this retry is answered as one.
      if (await repo.findByCodeHash(codeHash).catch(() => null))
        return stored();
      throw error;
    }
    // Parsed, not just typed: a code that ever broke the contract's format
    // would be a 500 here, never a code the delete route cannot accept.
    return json(201, errorPhotoResponseSchema.parse({ deleteCode: code }));
  } catch (error) {
    return logErrorPhotoFailure("upload", error);
  }
}

export async function handleErrorPhotoDelete(
  request: Request,
  deps: ErrorPhotoDeps,
): Promise<Response> {
  if (!deps.enabled) return NOT_FOUND();
  if (!deps.blobConfigured) return UNAVAILABLE();
  try {
    if (declaredTooLarge(request, ERROR_PHOTO_DELETE_MAX_BODY_BYTES))
      return TOO_LARGE();
    if (await isRateLimited(request, deps.limiter())) return TOO_MANY();
    let body: Uint8Array<ArrayBuffer>;
    try {
      body = await readLimitedBytes(request, ERROR_PHOTO_DELETE_MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) return TOO_LARGE();
      throw error;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return json(400, { error: "Request body must be valid JSON." });
    }
    const parsed = errorPhotoDeleteSchema.safeParse(payload);
    if (!parsed.success) return json(400, { error: "Invalid code." });

    const repo = deps.repo();
    const found = await repo.findByCodeHash(hashDeleteCode(parsed.data.code));
    if (!found) return NOT_FOUND();
    // The photo first: if that fails the row stays, so the same code works
    // again. A row left after its blob is gone is removed by the purge.
    await deps.blob.del([found.blobPathname]);
    await repo.deleteById(found.id);
    return new Response(null, { status: 204, headers: NO_STORE });
  } catch (error) {
    return logErrorPhotoFailure("delete", error);
  }
}
