/**
 * Error-photo contract (candidate, 未拍板; Kirby 2026-11-08).
 *
 * Photos stay on the phone by default. The ONLY way a photo reaches the server
 * is this route: on a scan-failure screen or the "numbers look wrong?" link of
 * the confirm screen, the person taps "send this photo", reads the notice,
 * ticks consent, and the browser uploads a prepared copy. It is kept for
 * `ERROR_PHOTO_RETENTION_DAYS` and then deleted automatically; the person gets
 * a deletion code that removes it earlier.
 *
 * What the browser MUST do before upload (all on-device):
 *   - crop to the hand + reference (paper or card) bounding box plus a margin;
 *     nothing outside it is sent;
 *   - in card mode, fill the detected card quadrilateral with solid black; when
 *     no card outline was detected, the upload is not offered at all;
 *   - re-encode through a canvas as JPEG (no EXIF/GPS/maker notes survive), long
 *     side at most `ERROR_PHOTO_MAX_SIDE_PX`, body at most `ERROR_PHOTO_MAX_BYTES`.
 *
 * What the server MUST do:
 *   - accept only `image/jpeg` that starts with SOI and contains no APP1 (EXIF/XMP)
 *     segment; refuse anything else with 400;
 *   - store it in a PRIVATE Blob store under a random path (never a scan id, IP
 *     or user id), `allowOverwrite: false`;
 *   - keep only the hash of the deletion code (`sha256`), never the code;
 *   - rate-limit per client IP before writing;
 *   - delete every photo older than the retention window in the daily cron, and
 *     the photo + its row on a valid deletion code;
 *   - never log or send to Sentry the metadata values.
 *
 * No link: the row has no `scan_id`, `session_id` or `user_id`; deleting a scan
 * or an account does not remove the photo (the deletion code does). The upload
 * metadata repeats the measured values it is about, so an engineer can replay
 * the case without a link to the scan.
 *
 * Change this file only in a PR of its own.
 */
import { z } from "zod";

export const ERROR_PHOTO_CONSENT_VERSION = "error-photo-consent-v1-draft";
export const ERROR_PHOTO_RETENTION_DAYS = 183; // ≈ 6 months (Kirby 2026-11-08)
export const ERROR_PHOTO_MAX_BYTES = 1_500_000;
export const ERROR_PHOTO_MAX_SIDE_PX = 2048;

/** `POST` multipart/form-data: `photo` (image/jpeg) + `meta` (JSON string). */
export const ERROR_PHOTO_PATH = "/api/error-photos";
/** `POST` JSON `{ code }` → 204; unknown code → 404. */
export const ERROR_PHOTO_DELETE_PATH = "/api/error-photos/delete";

export const ERROR_PHOTO_TRIGGERS = ["scan-failed", "numbers-wrong"] as const;
/** Paper sizes of `PAPER_SIZES_MM` plus the card (pinned by a unit test). */
export const ERROR_PHOTO_REFERENCES = ["a4", "letter", "card"] as const;

/** Failure codes the scan screens already distinguish (free of user text). */
export const errorPhotoFailureCode = z.string().regex(/^[A-Z0-9_]{2,40}$/);

const mm = z.number().finite().min(0).max(400);

export const errorPhotoMetaSchema = z.strictObject({
  consent: z.literal(ERROR_PHOTO_CONSENT_VERSION),
  trigger: z.enum(ERROR_PHOTO_TRIGGERS),
  reference: z.enum(ERROR_PHOTO_REFERENCES),
  hand: z.enum(["left", "right"]).optional(),
  failureCode: errorPhotoFailureCode.optional(),
  /** What the app measured, when it got that far (numbers-wrong). */
  measured: z.strictObject({ handLengthMm: mm, palmWidthMm: mm }).optional(),
  /** What the person says is right, optional, numbers only. */
  expected: z
    .strictObject({
      handLengthMm: mm.optional(),
      palmWidthMm: mm.optional(),
    })
    .optional(),
  measurementModelVersion: z.string().max(40).optional(),
  /** Same coarse buckets as the analytics contract; no user agent string. */
  deviceClass: z.enum(["phone", "tablet", "desktop", "unknown"]).optional(),
  captureMode: z.enum(["camera", "upload"]).optional(),
  /** Crop size actually sent, for replay; never the original's. */
  widthPx: z.number().int().min(64).max(ERROR_PHOTO_MAX_SIDE_PX),
  heightPx: z.number().int().min(64).max(ERROR_PHOTO_MAX_SIDE_PX),
});

export type ErrorPhotoMeta = z.infer<typeof errorPhotoMetaSchema>;

/** 201 body. The code is shown once and never stored in clear. */
export const errorPhotoResponseSchema = z.strictObject({
  deleteCode: z.string().regex(/^[A-HJ-NP-Z2-9]{12}$/),
});

export const errorPhotoDeleteSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.string().regex(/^[A-HJ-NP-Z2-9]{12}$/)),
});
