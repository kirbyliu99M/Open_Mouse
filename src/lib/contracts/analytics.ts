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
 * client must pass every URL-shaped one through `redactAnalyticsPath`'s rule
 * before an event leaves the browser: a path matching an entry of
 * `ANALYTICS_REDACTED_ROUTES` is replaced by that entry's pattern, query and
 * fragment dropped.
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

/** Upper bound for every count property: a larger count is sent as this. */
export const ANALYTICS_COUNT_CAP = 20;

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A pipeline issue code such as `HAND_NOT_DETECTED`. Never a message. */
const issueCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,47}$/);
/** A catalogue slug. Never a scan ID: those are UUIDs, refused below. */
const mouseSlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,79}$/)
  .refine((s) => !UUID_SHAPE.test(s), "a UUID is not a mouse slug");
const count = z.int().min(0).max(ANALYTICS_COUNT_CAP);
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
    attempt: count,
  }),

  /** The pipeline refused the photo. `codes` are its issue codes, at most 8,
   * deduplicated. */
  scan_rejected: z.strictObject({
    flow: z.enum(SCAN_FLOWS),
    attempt: count,
    codes: z.array(issueCode).max(8),
  }),

  /** The pipeline produced measurements (the numbers themselves stay out). */
  scan_measured: z.strictObject({
    flow: z.enum(SCAN_FLOWS),
    attempt: count,
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
  results_viewed: z.strictObject({
    state: z.enum(RESULTS_STATES),
    /** Present only when `state` is `ready`. */
    topPick: mouseSlug.optional(),
    noGoodFit: z.boolean().optional(),
  }),

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
 * Paths that carry an identifier, and what they are sent as. The first
 * pattern that matches wins; any other path is sent as is, minus its query
 * and fragment.
 */
export const ANALYTICS_REDACTED_ROUTES = [
  { match: /^\/results\/(?!demo(?:\/|$))[^/]+/, as: "/results/[scanId]" },
  { match: /^\/l\/v1\/[^/]+/, as: "/l/v1/[token]" },
] as const;

/**
 * The redaction rule, as a pure function: takes a path or an absolute URL and
 * returns the same shape with the query and fragment removed and an
 * identifying segment replaced. A string that is not a parsable URL or path
 * comes back as `null`, and the caller drops the property.
 */
export function redactAnalyticsPath(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value, "https://redact.invalid");
  } catch {
    return null;
  }
  const route = ANALYTICS_REDACTED_ROUTES.find((r) =>
    r.match.test(url.pathname),
  );
  const path = route
    ? url.pathname.replace(route.match, route.as)
    : url.pathname;
  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(value);
  return isAbsolute ? `${url.origin}${path}` : path;
}
