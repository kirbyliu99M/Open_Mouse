/**
 * Data-tester contract (candidate, 未拍板; Kirby 2026-11-09).
 *
 * A hidden page, `/scan/tester`, for people Kirby invites to build the
 * accuracy ground truth: they type their tape-measure values, run the normal
 * scan, and the page stores the tape values, what the app measured, how the
 * attempt went, and (by default, with consent) a prepared photo — in one
 * record, so nothing is copied by hand between the scan and a spreadsheet.
 *
 * Access:
 *   - The page and both routes answer 404 unless the server env
 *     `TESTER_CODES` is set (comma-separated tester codes). No build flag: the
 *     page is a server component that checks the env at request time.
 *   - A tester code is `P<2–3 digits>-<6 chars of TESTER_CODE_ALPHABET>`, e.g.
 *     `P07-K7Q2M9`. Kirby hands one code to each person. The server stores ONLY
 *     the participant id (`P07`), never the secret part, and compares codes in
 *     constant time.
 *   - `noindex, nofollow`, not in the sitemap, disallowed in robots.txt, no
 *     link from any public page.
 *
 * What is stored per shot (`tester_shots`):
 *   - participant id, consent version, the DAY (Asia/Taipei date) — no time;
 *   - tape values exactly as typed (mm, one decimal), hand, measurer count;
 *   - phone model as typed (≤ 40 chars, filtered like survey comments: no
 *     e-mail, phone numbers or URLs), surface, lighting, reference, card type;
 *   - outcome: first-try success, attempts, failure codes seen, gave-up flag;
 *   - what the app measured + model version + calibration method + capture mode;
 *   - optional photo: the SAME on-device preparation as error photos (crop to
 *     hand + reference, card quadrilateral filled black, canvas re-encode, no
 *     EXIF, ≤ `ERROR_PHOTO_MAX_SIDE_PX`, ≤ `ERROR_PHOTO_MAX_BYTES`), stored in
 *     the private Blob store under `tester/<random>.jpg`.
 *   Never: name, e-mail, IP, user agent, account id, scan id, session id.
 *
 * Retention: photos are deleted after `TESTER_PHOTO_RETENTION_DAYS` by the
 * existing daily expire cron; the numeric rows stay until Kirby deletes them
 * or the participant asks (then every row of that participant id goes, with
 * its photos — `scripts/tester-delete.ts P07`).
 *
 * Testers' scans do NOT go through `/api/scans` and create no hand-sample
 * copy, no fit results and no analytics events with values.
 *
 * Change this file only in a PR of its own.
 */
import { z } from "zod";

export const TESTER_CONSENT_VERSION = "tester-consent-v1-draft";
export const TESTER_PHOTO_RETENTION_DAYS = 180;

export const TESTER_PAGE_PATH = "/scan/tester";
/** `POST` JSON `{ code }` → 200 `{ participant }`; bad/unknown code → 404. */
export const TESTER_CHECK_PATH = "/api/tester/check";
/**
 * `POST` multipart/form-data: `code` (tester code), `record` (JSON string,
 * `testerRecordSchema`), optional `photo` (image/jpeg, same checks as
 * `/api/error-photos`). `record.shotId` is browser-generated and is the
 * idempotency key: a repeat answers 200 and stores nothing new. 201 new.
 */
export const TESTER_SHOT_PATH = "/api/tester/shots";

/** Same alphabet as deletion codes: no 0/O/1/I. */
export const TESTER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const testerCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^P\d{2,3}-[A-HJ-NP-Z2-9]{6}$/));
export const testerParticipantSchema = z.string().regex(/^P\d{2,3}$/);

/** `P07-K7Q2M9` → `P07`. Call only on a code that passed `testerCodeSchema`. */
export function participantOf(code: string): string {
  return code.slice(0, code.indexOf("-"));
}

export const TESTER_SURFACES = [
  "white",
  "wood",
  "dark",
  "patterned",
  "other",
] as const;
export const TESTER_LIGHTING = ["daylight", "indoor-warm", "dim"] as const;
export const TESTER_REFERENCES = ["a4", "letter", "card"] as const;
export const TESTER_CARD_TYPES = [
  "transit",
  "bank-back-covered",
  "id-size-other",
] as const;
export const TESTER_CAPTURE_MODES = ["camera", "upload"] as const;

/** Tape value as typed, millimetres, one decimal. */
const tapeMm = z
  .number()
  .finite()
  .min(50)
  .max(300)
  .refine((v) => Math.abs(Math.round(v * 10) - v * 10) < 1e-6, "one decimal at most");

/** One measurer's two readings. */
const tapePair = z.strictObject({ first: tapeMm, second: tapeMm });

export const testerTapeSchema = z.strictObject({
  hand: z.enum(["left", "right"]),
  /** Wrist crease (nearest the palm) to middle fingertip. */
  handLength: z.strictObject({ a: tapePair, b: tapePair.optional() }),
  /** Index knuckle base to little-finger knuckle base (the app's definition). */
  palmWidth: z.strictObject({ a: tapePair, b: tapePair.optional() }),
  /** Optional: widest edge-to-edge palm width, measurer A once. */
  palmWidthEdge: tapeMm.optional(),
});

const appMm = z.number().finite().min(0).max(400);

export const testerRecordSchema = z
  .strictObject({
    consent: z.literal(TESTER_CONSENT_VERSION),
    /** Browser-generated UUID v4, the idempotency key. */
    shotId: z.string().uuid(),
    tape: testerTapeSchema,
    phoneModel: z.string().trim().min(1).max(40),
    surface: z.enum(TESTER_SURFACES),
    lighting: z.enum(TESTER_LIGHTING),
    reference: z.enum(TESTER_REFERENCES),
    cardType: z.enum(TESTER_CARD_TYPES).optional(),
    /** Deliberately non-ideal shot (dark, tilted) asked for by the protocol. */
    deliberatelyPoor: z.boolean(),
    captureMode: z.enum(TESTER_CAPTURE_MODES),
    /** 1 = the first attempt produced a measurement. */
    attempts: z.number().int().min(1).max(50),
    firstTryOk: z.boolean(),
    /** Failure codes the scan screens showed, in order, at most 50. */
    failureCodes: z
      .array(z.string().regex(/^[A-Z0-9_]{2,40}$/))
      .max(50),
    /** The tester stopped without a measurement. */
    gaveUp: z.boolean(),
    /** Absent only when `gaveUp`. */
    measured: z
      .strictObject({
        handLengthMm: appMm,
        palmWidthMm: appMm,
        measurementModelVersion: z.string().max(40),
        calibrationMethod: z.string().max(40),
      })
      .optional(),
    /** Present when a photo part is sent; crop size actually sent. */
    photo: z
      .strictObject({
        widthPx: z.number().int().min(64).max(2048),
        heightPx: z.number().int().min(64).max(2048),
      })
      .optional(),
  })
  .refine((r) => r.gaveUp === (r.measured === undefined), {
    message: "measured is required unless gaveUp, and absent when gaveUp",
  })
  .refine((r) => (r.reference === "card") === (r.cardType !== undefined), {
    message: "cardType is required for card and only for card",
  })
  .refine((r) => r.firstTryOk === (r.attempts === 1 && !r.gaveUp), {
    message: "firstTryOk means one attempt that measured",
  });

export type TesterRecord = z.infer<typeof testerRecordSchema>;

export const testerCheckSchema = z.strictObject({ code: testerCodeSchema });
export const testerCheckResponseSchema = z.strictObject({
  participant: testerParticipantSchema,
});
export const testerShotResponseSchema = z.strictObject({
  shotId: z.string().uuid(),
});
