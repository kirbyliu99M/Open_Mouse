/**
 * Analytics contract — every product event the browser may send to PostHog,
 * and the only properties each one may carry (issue #138, Kirby 2026-10-07).
 * An event or a property that is not here cannot be sent: the client wrapper
 * parses each capture against `analyticsEventSchemas` and drops what fails.
 *
 * What may never be in an event, by hard rule 5 and the promise the UI makes:
 *   - anything derived from the hand: no millimetres, no size band, no grip,
 *     no handedness, no measurement version;
 *   - an identifier that leads back to a scan or a person: no scan ID, no
 *     session ID, no learning-kit token, no user ID or email. Mouse slugs are
 *     catalogue identifiers and are allowed;
 *   - free text or a free number. A string property is an enum or a short
 *     upper-case code; a number property is a small integer with a cap.
 *
 * Properties PostHog adds by itself (`$current_url`, `$pathname`,
 * `$referrer`, `$initial_current_url`, ...) are not described here. The
 * client must pass every URL-shaped one through `redactAnalyticsPath` before
 * an event leaves the browser, and drop the property when it returns null.
 *
 * Change this file only in a PR of its own.
 */
import { z } from "zod";

/** Where a scan was started. `easy` is `/scan/easy`; `sheet` is `/scan`. */
export const SCAN_FLOWS = ["easy", "sheet"] as const;
export type ScanFlow = (typeof SCAN_FLOWS)[number];

/** Mirrors `DeviceFit` in src/client/camera/deviceFit.ts. */
export const ANALYTICS_DEVICES = ["phone", "desktop", "in-app"] as const;

/** Mirrors `AttemptMethod` in src/client/camera/attemptLog.ts. */
export const CAPTURE_METHODS = ["takePhoto", "canvas", "upload"] as const;

/** Mirrors `SubmitScanErrorKind` in src/client/scan/submitScan.ts. */
export const SUBMIT_FAILURE_KINDS = [
  "invalid",
  "tooLarge",
  "rateLimited",
  "network",
  "server",
] as const;

/** The results page's non-ready states plus `ready`. */
export const RESULTS_STATES = [
  "ready",
  "notFound",
  "rateLimited",
  "networkError",
  "serverError",
] as const;

/** Upper bound for every count property. The schemas refuse a larger count,
 * so the client clamps to this before it captures. */
export const ANALYTICS_COUNT_CAP = 20;

/** A UUID, with or without its dashes. */
const UUID_SHAPE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

/** A pipeline issue code such as `HAND_NOT_DETECTED`. Never a message. */
const issueCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,47}$/);
/** A catalogue slug. Never a scan ID: those are UUIDs, refused below. */
const mouseSlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,79}$/)
  .refine((s) => !UUID_SHAPE.test(s), "a UUID is not a mouse slug");
/** The 1-based attempt number on this page, clamped to the cap. */
const attempt = z.int().min(1).max(ANALYTICS_COUNT_CAP);
const rank = z.int().min(1).max(100);

export const analyticsEventSchemas = {
  /** A page view, captured on every App Router navigation. No properties of
   * its own: the path comes from PostHog's redacted `$current_url`. */
  $pageview: z.strictObject({}),

  /** A call to action on the home page. */
  home_cta_clicked: z.strictObject({
    cta: z.enum(["scan", "how_it_works", "sign_in"]),
  }),

  /** The scan page settled on what to show this device first: the camera
   * (phone) or the entry screen with the QR code (desktop, in-app). */
  scan_entry_shown: z.strictObject({
    flow: z.enum(SCAN_FLOWS),
    device: z.enum(ANALYTICS_DEVICES),
  }),

  /** The camera request settled. `noCamera`: no getUserMedia, an insecure
   * context, or no rear camera. */
  camera_permission_result: z.strictObject({
    flow: z.enum(SCAN_FLOWS),
    result: z.enum(["granted", "denied", "noCamera", "error"]),
  }),

  /** A photo went into the pipeline. `attempt` counts this page's attempts,
   * starting at 1. */
  scan_capture_attempted: z.strictObject({
    flow: z.enum(SCAN_FLOWS),
    method: z.enum(CAPTURE_METHODS),
    attempt,
  }),

  /** The pipeline refused the photo. `codes` are its issue codes, at most 8,
   * deduplicated. */
  scan_rejected: z.strictObject({
    flow: z.enum(SCAN_FLOWS),
    attempt,
    codes: z
      .array(issueCode)
      .max(8)
      .refine((c) => new Set(c).size === c.length, "codes repeat"),
  }),

  /** The pipeline produced measurements (the numbers themselves stay out). */
  scan_measured: z.strictObject({
    flow: z.enum(SCAN_FLOWS),
    attempt,
    paper: z.enum(["detected", "manual", "none"]),
  }),

  /** The submission was stored (201). */
  scan_submitted: z.strictObject({
    flow: z.enum(SCAN_FLOWS),
  }),

  /** The submission failed. */
  scan_submit_failed: z.strictObject({
    flow: z.enum(SCAN_FLOWS),
    kind: z.enum(SUBMIT_FAILURE_KINDS),
  }),

  /** The results page settled once (not again on a re-render). */
  results_viewed: z.union([
    z.strictObject({
      state: z.literal("ready"),
      topPick: mouseSlug,
      noGoodFit: z.boolean(),
    }),
    z.strictObject({
      state: z.enum(RESULTS_STATES).exclude(["ready"]),
    }),
  ]),

  /** The written analysis settled. `fallback`: the template text was shown
   * instead of the model's. */
  analysis_shown: z.strictObject({
    outcome: z.enum(["model", "fallback", "error"]),
  }),

  analysis_retry_clicked: z.strictObject({}),

  /** The "other ranked mice" or "excluded mice" list was opened (not closed). */
  results_list_opened: z.strictObject({
    list: z.enum(["ranked", "excluded"]),
  }),

  /** The first drag, zoom or tap on the 3D viewer, once per page. */
  viewer_interacted: z.strictObject({}),

  /** "Scan again" (or the back link) from the results page. */
  retake_clicked: z.strictObject({
    from: z.enum(["results"]),
  }),

  /** The scan was deleted from the results page. */
  scan_deleted: z.strictObject({}),

  /**
   * Reserved for the where-to-buy section (not built yet; its own issue).
   * `retailer` is the store's key, `rank` the mouse's place in the list.
   */
  outbound_clicked: z.strictObject({
    mouse: mouseSlug,
    rank,
    retailer: z.enum([
      "official",
      "pchome",
      "momo",
      "shopee",
      "yahoo",
      "biggo",
      "feebee",
    ]),
  }),
} as const;

export type AnalyticsEventName = keyof typeof analyticsEventSchemas;
export type AnalyticsEventProps<E extends AnalyticsEventName> = z.infer<
  (typeof analyticsEventSchemas)[E]
>;

/**
 * Pages whose second path segment identifies something: `/results/<scanId>`
 * and `/l/<version>/<token>`. Matched without regard to case, because a
 * mistyped `/Results/<id>` still carries the ID.
 */
const RESULTS_SEGMENT = "results";
const KIT_SEGMENT = "l";
/** A segment this long is treated as an opaque identifier wherever it is. */
const OPAQUE_SEGMENT_MIN = 20;

function redactSegments(segments: readonly string[]): string[] {
  const first = segments[0]?.split(";")[0]?.toLowerCase();
  if (first === RESULTS_SEGMENT && segments.length > 1) {
    const only = segments.length === 2 && segments[1] === "demo";
    return only ? ["results", "demo"] : ["results", "[scanId]"];
  }
  if (first === KIT_SEGMENT && segments.length > 1) {
    return segments.length > 2
      ? ["l", segments[1] === "v1" ? "v1" : "[version]", "[token]"]
      : ["l", "[token]"];
  }
  return segments.map((s) =>
    UUID_SHAPE.test(s) || s.length >= OPAQUE_SEGMENT_MIN ? "[id]" : s,
  );
}

/**
 * The redaction rule, as a pure function. It takes a path or an http(s) URL
 * and returns the same shape with the query and fragment removed, repeated
 * slashes collapsed, and every identifying segment replaced: anything below
 * `/results/` other than exactly `/results/demo`, anything below `/l/`, and
 * any segment shaped like a UUID or at least `OPAQUE_SEGMENT_MIN` long. Any
 * other scheme (`mailto:`, `data:`, ...) or an unparsable string returns
 * `null`, and the caller drops the property.
 */
export function redactAnalyticsPath(value: string): string | null {
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (hasScheme && !/^https?:/i.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, "https://redact.invalid");
  } catch {
    return null;
  }
  const segments = url.pathname.split("/").filter((s) => s !== "");
  const kept = redactSegments(segments);
  const path = `/${kept.join("/")}`;
  return hasScheme ? `${url.origin}${path}` : path;
}
