/**
 * The browser side of the error-photo routes (candidate 未拍板,
 * src/lib/contracts/error-photo.ts): the metadata, built and checked against
 * the contract before anything is sent, and the two requests. Same-origin
 * only (`connect-src 'self'`). Nothing here logs, stores or reports a value or
 * a code.
 */
import {
  ERROR_PHOTO_CONSENT_VERSION,
  ERROR_PHOTO_DELETE_PATH,
  ERROR_PHOTO_PATH,
  errorPhotoMetaSchema,
  errorPhotoResponseSchema,
  type ErrorPhotoMeta,
} from "../../lib/contracts/error-photo";
import { generateDeleteCode, webCryptoBytes } from "../../lib/error-photo/code";

type Mm = { readonly handLengthMm?: number; readonly palmWidthMm?: number };

export interface ErrorPhotoMetaInput {
  readonly trigger: ErrorPhotoMeta["trigger"];
  readonly reference: ErrorPhotoMeta["reference"];
  readonly hand?: "left" | "right";
  /** The first failure code shown, on a failure screen. */
  readonly failureCode?: string;
  readonly measured?: {
    readonly handLengthMm: number;
    readonly palmWidthMm: number;
  };
  readonly expected?: Mm;
  readonly measurementModelVersion?: string;
  readonly deviceClass?: ErrorPhotoMeta["deviceClass"];
  readonly captureMode?: ErrorPhotoMeta["captureMode"];
  readonly widthPx: number;
  readonly heightPx: number;
}

/** Whole millimetres (privacy review 2026-11-08: the hand sample's precision). */
const roundMm = (v: number) => Math.round(v);

/**
 * The upload's metadata: measured and expected values rounded to whole mm,
 * empty `expected` dropped, then parsed by the contract's strict schema.
 * `null` if it does not pass (the upload is then not offered).
 */
export function buildErrorPhotoMeta(
  input: ErrorPhotoMetaInput,
): ErrorPhotoMeta | null {
  const expected: { handLengthMm?: number; palmWidthMm?: number } = {};
  if (input.expected?.handLengthMm !== undefined)
    expected.handLengthMm = roundMm(input.expected.handLengthMm);
  if (input.expected?.palmWidthMm !== undefined)
    expected.palmWidthMm = roundMm(input.expected.palmWidthMm);
  const candidate = {
    consent: ERROR_PHOTO_CONSENT_VERSION,
    trigger: input.trigger,
    reference: input.reference,
    ...(input.hand ? { hand: input.hand } : {}),
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    ...(input.measured
      ? {
          measured: {
            handLengthMm: roundMm(input.measured.handLengthMm),
            palmWidthMm: roundMm(input.measured.palmWidthMm),
          },
        }
      : {}),
    ...(Object.keys(expected).length > 0 ? { expected } : {}),
    ...(input.measurementModelVersion
      ? { measurementModelVersion: input.measurementModelVersion }
      : {}),
    ...(input.deviceClass ? { deviceClass: input.deviceClass } : {}),
    ...(input.captureMode ? { captureMode: input.captureMode } : {}),
    widthPx: input.widthPx,
    heightPx: input.heightPx,
  };
  const parsed = errorPhotoMetaSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** A typed value in cm (one decimal is fine) as mm, or `null` for empty, `"invalid"` outside 5 to 40 cm. */
export function parseExpectedCm(raw: string): number | null | "invalid" {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return "invalid";
  const cm = Number(text);
  if (!(cm >= 5 && cm <= 40)) return "invalid";
  return Math.round(cm * 10);
}

export type SendOutcome =
  /** 201 (stored now) or 200 (this code was already stored: a retry). */
  | { readonly ok: true; readonly deleteCode: string }
  /**
   * No answer in time: the photo MAY have been stored, so the code is still
   * the person's way to delete it, and a retry with it stores nothing twice.
   */
  | {
      readonly ok: false;
      readonly reason: "timeout";
      readonly deleteCode: string;
    }
  | {
      readonly ok: false;
      readonly reason: "too-many" | "unavailable" | "failed";
    };

/** How long the upload may take before the sheet gives up (review H1). */
export const ERROR_PHOTO_UPLOAD_TIMEOUT_MS = 30_000;

/**
 * Sends the prepared copy with the deletion code the browser made (review
 * #241 round 3). Never throws, and never waits longer than `timeoutMs`: the
 * request is aborted then and the answer is `timeout` (with the code), even
 * from a fetch that ignores the abort.
 */
export async function sendErrorPhoto(
  photo: Blob,
  meta: ErrorPhotoMeta,
  code: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = ERROR_PHOTO_UPLOAD_TIMEOUT_MS,
): Promise<SendOutcome> {
  const controller = new AbortController();
  const timeout: SendOutcome = {
    ok: false,
    reason: "timeout",
    deleteCode: code,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<SendOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(timeout);
    }, timeoutMs);
  });
  const attempt = (async (): Promise<SendOutcome> => {
    try {
      const form = new FormData();
      form.set("meta", JSON.stringify(meta));
      form.set("code", code);
      form.set("photo", photo, "photo.jpg");
      const res = await fetchImpl(ERROR_PHOTO_PATH, {
        method: "POST",
        body: form,
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      });
      if (res.status === 201 || res.status === 200) {
        const parsed = errorPhotoResponseSchema.safeParse(await res.json());
        return parsed.success && parsed.data.deleteCode === code
          ? { ok: true, deleteCode: code }
          : { ok: false, reason: "failed" };
      }
      if (res.status === 429) return { ok: false, reason: "too-many" };
      if (res.status === 503 || res.status === 404)
        return { ok: false, reason: "unavailable" };
      return { ok: false, reason: "failed" };
    } catch {
      return controller.signal.aborted
        ? timeout
        : { ok: false, reason: "failed" };
    }
  })();
  try {
    return await Promise.race([attempt, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One sheet's upload: its deletion code is made once, on the device, and
 * every try (a retry after a timeout or a failure) sends the same code with
 * the same bytes, so the server keeps at most one photo for it.
 */
export interface UploadSession {
  readonly code: string;
  send(meta: ErrorPhotoMeta): Promise<SendOutcome>;
}

export function createUploadSession(
  photo: Blob,
  deps: {
    readonly randomBytes?: (size: number) => Uint8Array;
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
  } = {},
): UploadSession {
  const code = generateDeleteCode(deps.randomBytes ?? webCryptoBytes);
  return {
    code,
    send: (meta) =>
      sendErrorPhoto(
        photo,
        meta,
        code,
        deps.fetchImpl ?? fetch,
        deps.timeoutMs ?? ERROR_PHOTO_UPLOAD_TIMEOUT_MS,
      ),
  };
}
export type DeleteOutcome =
  "deleted" | "not-found" | "invalid" | "too-many" | "failed";

/** Checked against the contract's code format first: a malformed code is never sent. */
export function normaliseDeleteCode(raw: string): string | null {
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-HJ-NP-Z2-9]{12}$/.test(code) ? code : null;
}

export async function deleteErrorPhoto(
  raw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeleteOutcome> {
  const code = normaliseDeleteCode(raw);
  if (!code) return "invalid";
  try {
    const res = await fetchImpl(ERROR_PHOTO_DELETE_PATH, {
      method: "POST",
      body: JSON.stringify({ code }),
      headers: { "content-type": "application/json" },
      credentials: "omit",
      cache: "no-store",
    });
    if (res.status === 204) return "deleted";
    if (res.status === 404) return "not-found";
    if (res.status === 400) return "invalid";
    if (res.status === 429) return "too-many";
    return "failed";
  } catch {
    return "failed";
  }
}
