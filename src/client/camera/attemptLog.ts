/**
 * A local record of every scan attempt, kept in this browser only.
 *
 * Why: the debug panel's numbers live in page memory, so a reload lost them,
 * and when Kirby's scans were rejected there was nothing to look at afterwards
 * (2026-10-06: a perfect live preview and a rejected photo, with no way to say
 * why). Every analysis, from the camera or from an uploaded file, now leaves one
 * record here: what was captured, what the preview was, what the pipeline
 * concluded and the numbers its gates looked at.
 *
 * Privacy, by construction: a record is numbers, booleans and short strings.
 * `sanitizeAttempt` is the only way one is made or read back, and it rebuilds
 * the record field by field: every number is finite and rounded, every string
 * is cut short and stripped of data URLs, the lists are capped, and anything it
 * does not know is dropped. There is no field a photo could be put in. The
 * record never leaves the device (nothing here touches the network); the only
 * way out is Kirby copying the debug JSON himself. The newest 20 are kept.
 *
 * Everything but `readAttempts` / `writeAttempts` is pure. Those two take a
 * storage object and swallow every error: a page without storage (private
 * browsing, a blocked or full store) works the same, it just remembers nothing
 * between reloads.
 */
import type { PipelineResult } from "../photo/pipeline";
import type { StorageLike } from "./easyScanPreferences";
import { aspectOfSize, compareFov } from "./previewConstraints";

export const ATTEMPT_LOG_KEY = "openMouse.easyScan.attempts.v1";
export const MAX_ATTEMPTS = 20;

const MAX_ERRORS = 8;
const MAX_CODES = 8;
const MAX_CODE_LENGTH = 48;
const MAX_MESSAGE_LENGTH = 200;
const MAX_USER_AGENT_LENGTH = 80;
const MAX_TIME_LENGTH = 40;

export type AttemptMethod = "takePhoto" | "canvas" | "upload";

export interface AttemptError {
  readonly code: string;
  readonly message: string;
}

export interface AttemptRecord {
  /** The shape of this record, so a later change can tell old ones apart. */
  readonly v: 1;
  /** ISO 8601, UTC. */
  readonly at: string;
  readonly method: AttemptMethod | null;
  /** The photo as it came from the camera or the file. */
  readonly photo: {
    readonly width: number | null;
    readonly height: number | null;
    readonly kb: number | null;
  };
  /** The live preview it was taken from (`null` sizes for an upload). */
  readonly preview: {
    readonly width: number | null;
    readonly height: number | null;
    /** (preview - photo) / photo in long over short; positive when the preview was the narrower view. */
    readonly aspectDiff: number | null;
    /** The two differ in shape by more than 2 %, so they did not show the same field of view. */
    readonly fovMismatch: boolean | null;
  };
  readonly result: "ok" | "error";
  /** Every error the pipeline reported, not only the first. */
  readonly errors: readonly AttemptError[];
  /** Non-blocking issues of a measured scan (a soft photo), by code. */
  readonly warnings: readonly string[];
  /** What the paper gates saw; `null` when no sheet was looked for (a scan with a typed hand length) or the run stopped first. */
  readonly paper: {
    readonly cornersSeen: number;
    readonly widthFraction: number | null;
    readonly heightFraction: number | null;
    readonly edgeFitResidualMm: number | null;
    readonly minSideCoverage: number;
    /** The paper gates that failed, whether or not the result reported them first. */
    readonly gateFailures: readonly string[];
  } | null;
  /** Laplacian variance of the analysed photo. */
  readonly sharpness: number | null;
  readonly hand: {
    readonly detected: boolean | null;
    readonly confidence: number | null;
    readonly handedness: "left" | "right" | null;
  };
  /** The picture the gates looked at; `crop` is set when the photo was cut down to the preview's field of view. */
  readonly analysed: {
    readonly width: number | null;
    readonly height: number | null;
    readonly crop: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    } | null;
  };
  readonly parallaxCorrected: boolean | null;
  readonly timingMs: {
    readonly decode: number | null;
    readonly paper: number | null;
    readonly hand: number | null;
    readonly total: number | null;
  };
  readonly userAgent: string;
}

// ── Sanitising: the only door into a record ───────────────────────────────

/** A string cut to `max`, with anything shaped like a data URL taken out. `null` for a non-string. */
function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return value
    .replace(/data:[^\s"']*/gi, "[data removed]")
    .replace(/[\u0000-\u001f]/g, " ")
    .slice(0, max);
}

function cleanNumber(value: unknown, digits: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

const cleanBool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanList<T>(
  value: unknown,
  max: number,
  clean: (item: unknown) => T | null,
): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    if (out.length >= max) break;
    const cleaned = clean(item);
    if (cleaned !== null) out.push(cleaned);
  }
  return out;
}

/**
 * Rebuilds `value` as an `AttemptRecord`, or `null` when it is not one (no
 * usable time, no result). Whatever it is given, what comes out holds only
 * finite rounded numbers, booleans, short strings and short lists.
 */
export function sanitizeAttempt(value: unknown): AttemptRecord | null {
  const raw = asObject(value);
  if (!raw) return null;
  const at = cleanString(raw.at, MAX_TIME_LENGTH);
  if (at === null || !Number.isFinite(Date.parse(at))) return null;
  if (raw.result !== "ok" && raw.result !== "error") return null;

  const photo = asObject(raw.photo);
  const preview = asObject(raw.preview);
  const paper = asObject(raw.paper);
  const hand = asObject(raw.hand);
  const analysed = asObject(raw.analysed);
  const crop = asObject(analysed?.crop);
  const timing = asObject(raw.timingMs);
  const handedness = hand?.handedness;
  const method = raw.method;

  return {
    v: 1,
    at,
    method:
      method === "takePhoto" || method === "canvas" || method === "upload"
        ? method
        : null,
    photo: {
      width: cleanNumber(photo?.width, 0),
      height: cleanNumber(photo?.height, 0),
      kb: cleanNumber(photo?.kb, 0),
    },
    preview: {
      width: cleanNumber(preview?.width, 0),
      height: cleanNumber(preview?.height, 0),
      aspectDiff: cleanNumber(preview?.aspectDiff, 4),
      fovMismatch: cleanBool(preview?.fovMismatch),
    },
    result: raw.result,
    errors: cleanList(raw.errors, MAX_ERRORS, (item) => {
      const error = asObject(item);
      const code = cleanString(error?.code, MAX_CODE_LENGTH);
      if (code === null) return null;
      return {
        code,
        message: cleanString(error?.message, MAX_MESSAGE_LENGTH) ?? "",
      };
    }),
    warnings: cleanList(raw.warnings, MAX_CODES, (item) =>
      cleanString(item, MAX_CODE_LENGTH),
    ),
    paper: paper
      ? {
          cornersSeen: cleanNumber(paper.cornersSeen, 0) ?? 0,
          widthFraction: cleanNumber(paper.widthFraction, 4),
          heightFraction: cleanNumber(paper.heightFraction, 4),
          edgeFitResidualMm: cleanNumber(paper.edgeFitResidualMm, 3),
          minSideCoverage: cleanNumber(paper.minSideCoverage, 3) ?? 0,
          gateFailures: cleanList(paper.gateFailures, MAX_CODES, (item) =>
            cleanString(item, MAX_CODE_LENGTH),
          ),
        }
      : null,
    sharpness: cleanNumber(raw.sharpness, 2),
    hand: {
      detected: cleanBool(hand?.detected),
      confidence: cleanNumber(hand?.confidence, 3),
      handedness:
        handedness === "left" || handedness === "right" ? handedness : null,
    },
    analysed: {
      width: cleanNumber(analysed?.width, 0),
      height: cleanNumber(analysed?.height, 0),
      crop: crop
        ? {
            x: cleanNumber(crop.x, 0) ?? 0,
            y: cleanNumber(crop.y, 0) ?? 0,
            width: cleanNumber(crop.width, 0) ?? 0,
            height: cleanNumber(crop.height, 0) ?? 0,
          }
        : null,
    },
    parallaxCorrected: cleanBool(raw.parallaxCorrected),
    timingMs: {
      decode: cleanNumber(timing?.decode, 0),
      paper: cleanNumber(timing?.paper, 0),
      hand: cleanNumber(timing?.hand, 0),
      total: cleanNumber(timing?.total, 0),
    },
    userAgent: cleanString(raw.userAgent, MAX_USER_AGENT_LENGTH) ?? "",
  };
}

// ── The ring buffer ───────────────────────────────────────────────────────

/** `list` with `record` added at the end, and only the newest `max` kept. A `record` that is not one is not added. */
export function appendAttempt(
  list: readonly AttemptRecord[],
  record: unknown,
  max: number = MAX_ATTEMPTS,
): AttemptRecord[] {
  const clean = sanitizeAttempt(record);
  const next = clean ? [...list, clean] : [...list];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** What was stored, as records: anything that does not parse, is not a list or is not a record is left out; at most the newest 20. */
export function parseAttempts(raw: string | null | undefined): AttemptRecord[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const records: AttemptRecord[] = [];
  for (const item of parsed) {
    const record = sanitizeAttempt(item);
    if (record) records.push(record);
  }
  return records.length > MAX_ATTEMPTS
    ? records.slice(records.length - MAX_ATTEMPTS)
    : records;
}

export function serialiseAttempts(list: readonly AttemptRecord[]): string {
  return JSON.stringify(list);
}

/** The stored attempts, or `null` where storage is missing or throws. */
export function readAttempts(
  storage: StorageLike | null,
): AttemptRecord[] | null {
  if (!storage) return null;
  try {
    return parseAttempts(storage.getItem(ATTEMPT_LOG_KEY));
  } catch {
    return null;
  }
}

export function writeAttempts(
  storage: StorageLike | null,
  list: readonly AttemptRecord[],
): void {
  try {
    storage?.setItem(ATTEMPT_LOG_KEY, serialiseAttempts(list));
  } catch {
    // Best-effort: a full or blocked store must never break a scan.
  }
}

/**
 * Adds `record` to what is stored (read again each time, so two tabs do not
 * overwrite each other) and returns the new list. Where storage is not
 * available `fallback`, the page's own copy, is what is added to, so the debug
 * panel still shows this session's attempts.
 */
export function recordAttempt(
  storage: StorageLike | null,
  record: unknown,
  fallback: readonly AttemptRecord[] = [],
): AttemptRecord[] {
  const base = readAttempts(storage) ?? fallback;
  const next = appendAttempt(base, record);
  writeAttempts(storage, next);
  return next;
}

// ── Making a record from a run ────────────────────────────────────────────

export interface AttemptCapture {
  readonly method: AttemptMethod | null;
  readonly photoWidth: number | null;
  readonly photoHeight: number | null;
  readonly photoKb: number | null;
  /** The live preview's frame at the moment of capture; `null` for an upload. */
  readonly previewWidth: number | null;
  readonly previewHeight: number | null;
}

export type AttemptOutcome =
  | { readonly kind: "result"; readonly result: PipelineResult }
  /** The pipeline threw (the detector would not load, an unexpected failure). */
  | {
      readonly kind: "thrown";
      readonly code: string;
      readonly message: string;
    };

/**
 * The record for one analysis. The output has been through `sanitizeAttempt`,
 * so it is safe to store whatever the pipeline put in its result.
 */
export function buildAttemptRecord(input: {
  readonly at: Date | string;
  readonly userAgent: string;
  readonly capture: AttemptCapture;
  readonly outcome: AttemptOutcome;
}): AttemptRecord {
  const { capture, outcome } = input;
  const at = input.at instanceof Date ? input.at.toISOString() : input.at;

  const photoAspect = aspectOfSize(capture.photoWidth, capture.photoHeight);
  const fov =
    photoAspect !== null &&
    capture.previewWidth !== null &&
    capture.previewHeight !== null
      ? compareFov(
          { width: capture.previewWidth, height: capture.previewHeight },
          photoAspect,
        )
      : null;

  let result: "ok" | "error" = "error";
  let errors: readonly AttemptError[] = [];
  let warnings: readonly string[] = [];
  let diagnostics: PipelineResultDiagnostics | undefined;
  if (outcome.kind === "thrown") {
    errors = [{ code: outcome.code, message: outcome.message }];
  } else {
    const pipeline = outcome.result;
    diagnostics = pipeline.diagnostics;
    if (pipeline.status === "ok") {
      result = "ok";
      warnings = pipeline.warnings.map((warning) => warning.code);
    } else if (pipeline.status === "error") {
      errors = pipeline.errors.map((error) => ({
        code: error.code,
        message: error.message,
      }));
    } else {
      // "needsManualCard" cannot happen without a printed sheet; the screen says "UNEXPECTED".
      errors = [{ code: "UNEXPECTED", message: "Something went wrong." }];
    }
  }

  const record = sanitizeAttempt({
    v: 1,
    at,
    method: capture.method,
    photo: {
      width: capture.photoWidth,
      height: capture.photoHeight,
      kb: capture.photoKb,
    },
    preview: {
      width: capture.previewWidth,
      height: capture.previewHeight,
      aspectDiff: fov?.aspectDiff ?? null,
      fovMismatch: fov?.fovMismatch ?? null,
    },
    result,
    errors,
    warnings,
    paper: diagnostics?.paper ?? null,
    sharpness: diagnostics?.laplacianVariance ?? null,
    hand: diagnostics?.hand ?? {
      detected: null,
      confidence: null,
      handedness: null,
    },
    analysed: {
      width: diagnostics?.analysed?.width ?? null,
      height: diagnostics?.analysed?.height ?? null,
      crop: diagnostics?.fovCrop ?? null,
    },
    parallaxCorrected: diagnostics?.parallaxCorrected ?? null,
    timingMs: {
      decode: diagnostics?.decodeMs ?? null,
      paper: diagnostics?.paperMs ?? null,
      hand: diagnostics?.handMs ?? null,
      total: diagnostics?.totalMs ?? null,
    },
    userAgent: input.userAgent,
  });
  // `result` and `at` are set above, so the record is always valid; the
  // fallback only keeps the type honest.
  return (
    record ?? {
      v: 1,
      at: new Date(0).toISOString(),
      method: null,
      photo: { width: null, height: null, kb: null },
      preview: {
        width: null,
        height: null,
        aspectDiff: null,
        fovMismatch: null,
      },
      result: "error",
      errors: [],
      warnings: [],
      paper: null,
      sharpness: null,
      hand: { detected: null, confidence: null, handedness: null },
      analysed: { width: null, height: null, crop: null },
      parallaxCorrected: null,
      timingMs: { decode: null, paper: null, hand: null, total: null },
      userAgent: "",
    }
  );
}

type PipelineResultDiagnostics = NonNullable<PipelineResult["diagnostics"]>;

// ── For the debug panel ───────────────────────────────────────────────────

const pct = (value: number | null) =>
  value === null ? "?" : `${Math.round(value * 100)}%`;

/** One line for the panel: when, how, what happened and the numbers that matter. */
export function describeAttempt(record: AttemptRecord): string {
  const time = record.at.slice(11, 19);
  const photo =
    record.photo.width && record.photo.height
      ? `${record.photo.width}×${record.photo.height}`
      : "?×?";
  const outcome =
    record.result === "ok"
      ? "ok"
      : record.errors.map((error) => error.code).join("+") || "error";
  const parts = [time, record.method ?? "?", photo, outcome];
  if (record.paper)
    parts.push(
      `paper ${pct(record.paper.widthFraction)}×${pct(record.paper.heightFraction)}`,
      `resid ${record.paper.edgeFitResidualMm ?? "?"} mm`,
    );
  if (record.preview.fovMismatch) parts.push("FOV mismatch");
  if (record.analysed.crop) parts.push("cropped");
  return parts.join(" · ");
}
