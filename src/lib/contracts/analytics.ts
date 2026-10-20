/**
 * Analytics contract — every product event the browser may send to PostHog,
 * and the only properties each one may carry (issue #138, Kirby 2026-10-07).
 * An event or a property that is not here cannot be sent: the client wrapper
 * parses each capture against `analyticsEventSchemas` and drops what fails.
 *
 * What may never be in an event, by hard rule 5 and the promise the UI makes:
 *   - anything derived from the hand: no millimetres, no size band, no grip,
 *     no handedness, no measurement version;
 *     (The one place a millimetre difference appears is
 *     `scan_quality.priorEffect`: how two ways of correcting the same photo
 *     differ, in four wide steps, never a length. See its comment.
 *     The one place the hand's POSTURE appears is `handPose`: whether the
 *     fingers in the photo look laid flat, in three coarse steps, never a
 *     size or a proportion of the hand. See `HAND_POSE_BUCKETS`.)
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

/**
 * Where the parallax correction's focal length came from. Mirrors
 * `FocalDiagnostics["source"]` in src/client/photo/diagnostics.ts. `none` is
 * the one that matters: no focal length, so no parallax correction and a hand
 * length that reads about 6 mm long (a simulation, 2026-10-16; the real share
 * of `none` is what `scan_quality` is for).
 */
export const FOCAL_SOURCES = ["exif", "homography", "none"] as const;

/**
 * The scan-quality buckets. They describe the PHOTO'S CONDITIONS, never the
 * hand: a bucket is a range of a number the pipeline already computes about
 * the picture or the sheet, with the cut-offs written here. All the cut-offs
 * are candidates (未拍板) and may be moved in a PR that touches only this file
 * and the client's mapping.
 *
 * - sharpness: Laplacian variance of the analysed photo against the LOW_SHARPNESS
 *   gate (50, warning only): below it, up to twice it, above that.
 * - resolution: the long edge in px of the decoded photo.
 * - edge fit: the worst side's mean edge-fit distance of the sheet in mm; the
 *   PAPER_CURLED gate is 1.5.
 *
 * The event's own properties never carry: the focal length in px (it narrows
 * down the phone model), the user agent, the device model, the exact variance,
 * any hand measurement. This is about the event's payload only: posthog-js
 * adds its own properties to every event ($raw_user_agent, $device, $os,
 * $browser_version, $screen_*, $viewport_*, $browser_language, $timezone;
 * read from the package, 2026-10-16), and this file does not remove them.
 * Whether to strip those is a decision of its own.
 *
 * Read it knowing two things. Only a scan that was measured sends it, so a
 * share such as "focal source none" is a share of successful scans, and a scan
 * that failed a gate because of it is not in it. And a frame taken from the
 * live video (`method: "canvas"`) has no EXIF, so `focalSource: "exif"` can
 * only come from `takePhoto` or `upload`: cut the shares by `method`.
 */
export const SHARPNESS_BUCKETS = ["below_gate", "near_gate", "clear"] as const;
export const RESOLUTION_BUCKETS = [
  "under_1280",
  "from_1280_to_1919",
  "from_1920",
] as const;
export const EDGE_FIT_BUCKETS = [
  "under_0_5_mm",
  "from_0_5_to_1_mm",
  "from_1_mm",
] as const;

/**
 * How far the sheet's corners are from right angles in the photo (the largest
 * deviation from 90 degrees, in degrees; `computeQuadSkew`), which is how
 * "straight on" the shot was. The auto-shutter lets a photo through up to 12
 * (`maxAngleDeviationDeg`); the audit's simulation puts that at about 15
 * degrees of tilt (not measured on a phone).
 * A candidate (未拍板), 2026-10-16: the focal estimate that has no EXIF to lean
 * on is least reliable exactly in this range, and this bucket is how the real
 * spread of shots is found out.
 */
export const PAPER_SKEW_BUCKETS = [
  "under_3",
  "from_3_to_6",
  "from_6_to_9",
  "from_9",
] as const;

/**
 * How far the sheet looks from its true shape in the photo, as a fraction:
 * the observed width over height of the sheet's four corners, against the
 * nearest supported paper (A4 0.7071, Letter 0.7727). A sheet seen straight on
 * and flat reads within a fraction of a percent; a tilted or curled one reads
 * lower or higher. A candidate (未拍板), 2026-10-17: in Kirby's own data nine
 * ordinary scans sat within 0.6 % and the one that read 26 mm short sat 6.3 %
 * off, so this is a cheap flag for a photo that deserves distrust. It
 * describes the SHEET, not the hand.
 */
export const PAPER_ASPECT_BUCKETS = [
  "under_2_pct",
  "from_2_to_4_pct",
  "from_4_pct",
] as const;

/**
 * SHADOW MODE (2026-10-16, candidate): the client works out what the hand
 * length WOULD have been if the parallax correction had used a nominal focal
 * length (a 26 mm-equivalent main camera) instead of its own estimate or no
 * correction, and reports only how that differs from the number the person
 * was shown, in four coarse steps. The number the person sees is not changed
 * by it. `lower_5_plus` is the case the simulation predicts for a frame with
 * no usable focal estimate (about 6 mm shorter); `within_2` means the two
 * agree. A difference between two ways of correcting the same photo, not a
 * length: it moves by about 3 % of the hand length at most, and the steps are
 * wide enough that the hand length cannot be read back from it.
 * `unavailable`: the shadow could not be worked out (no convergence, a
 * degenerate pose, a value that is not a number). It is its own step so that
 * such a scan still reports everything else, and so that the share of
 * `unavailable` can be read by focal source and capture method.
 */
export const PRIOR_EFFECT_BUCKETS = [
  "lower_5_plus",
  "lower_2_to_5",
  "within_2",
  "higher_2_plus",
  "unavailable",
] as const;

/**
 * How much of the sheet's worst-seen side was visible (2026-10-19, candidate):
 * the smallest per-side edge coverage of the sheet, 0 to 1. The photo gate
 * refuses a side under 0.4, so a measured photo reads at least that. It
 * describes the SHEET, not the hand: how close the hand, a sleeve or a shadow
 * came to covering an edge, which is the most common reason a photo is sent
 * back (R1, 2026-10-19).
 */
export const PAPER_COVERAGE_BUCKETS = [
  "under_0_6",
  "from_0_6_to_0_8",
  "from_0_8",
] as const;

/**
 * SHADOW MODE (2026-10-19, candidate, Kirby: anonymous summaries are fine, the
 * photo is what must never be kept): whether the fingers in the photo look laid
 * flat, worked out from the 2D landmarks of the four fingers (thumb excluded)
 * by `assessHandFlatness`, and reported in three coarse steps. Nothing is
 * refused because of it yet; it is how the real spread is found before any
 * threshold blocks a photo. The thresholds behind the steps are simulation
 * candidates (R3, 2026-10-19) and move in a PR that touches this file and the
 * client's mapping. A posture, never a size or a proportion: a hand length,
 * a width or their ratio cannot be read back from it.
 *
 * - `flat_like`: inside the candidate flat range.
 * - `borderline`: in the "would only remind" band.
 * - `extreme`: in the "would refuse" band.
 * - `unknown`: not computable (not 21 points, a non-finite value).
 */
export const HAND_POSE_BUCKETS = [
  "flat_like",
  "borderline",
  "extreme",
  "unknown",
] as const;

/**
 * How long the live preview had a sheet in view before this photo was taken
 * (2026-10-19, candidate): from the first live sample that found the sheet to
 * the capture, in seconds. A long wait means the preview was stuck on a gate,
 * which no other event shows. `unknown`: the sheet was never found live (an
 * upload, a manual shot without a detected sheet).
 */
export const LIVE_WAIT_BUCKETS = [
  "under_3_s",
  "from_3_to_10_s",
  "from_10_to_30_s",
  "from_30_s",
  "unknown",
] as const;

/** The results page's non-ready states plus `ready`. */
export const RESULTS_STATES = [
  "ready",
  "notFound",
  "rateLimited",
  "networkError",
  "serverError",
] as const;

/** The results page's screens that show no result, where 「重新掃描」 still is. */
export const RESCAN_STATES = [
  "loading",
  "notFound",
  "rateLimited",
  "networkError",
  "serverError",
  "deleted",
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

/** Where a filter change was made: the wide sidebar, the narrow sheet, a chip
 * (removing one option, or 全部清除), or the no-match block's buttons. */
export const FILTER_SOURCES = [
  "sidebar",
  "sheet",
  "chips",
  "no_match",
] as const;

/** The three share buttons: the top bar's link, the one beside the purchase
 * links (wide screens) and the one at the foot of the page. */
export const SHARE_POSITIONS = ["top", "hero", "bottom"] as const;

/** Shops a purchase link can point at; anything else is `other`. */
export const RETAILERS = [
  "pchome",
  "momo",
  "shopee",
  "yahoo",
  "biggo",
  "feebee",
  "amazon",
  "other",
] as const;
export type Retailer = (typeof RETAILERS)[number];

/** Registrable host → shop. A subdomain of a listed host counts as it. */
const RETAILER_HOSTS: readonly (readonly [string, Retailer])[] = [
  ["pchome.com.tw", "pchome"],
  ["momoshop.com.tw", "momo"],
  ["shopee.tw", "shopee"],
  ["shope.ee", "shopee"],
  ["buy.yahoo.com", "yahoo"],
  ["tw.buy.yahoo.com", "yahoo"],
  ["biggo.com.tw", "biggo"],
  ["feebee.com.tw", "feebee"],
  ["amazon.com", "amazon"],
  ["amazon.co.jp", "amazon"],
  ["amzn.to", "amazon"],
];

/**
 * The shop a purchase link points at, from its host alone. The URL never
 * leaves the browser in an event; this key does. An unknown host, or a string
 * that is not an http(s) URL, is `other`.
 */
export function retailerOf(url: string): Retailer {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      return "other";
    host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "other";
  }
  for (const [domain, retailer] of RETAILER_HOSTS) {
    if (host === domain || host.endsWith(`.${domain}`)) return retailer;
  }
  return "other";
}

/** A brand as an event value: lower case, every run of other characters one
 * dash (`SteelSeries` → `steelseries`, `Cooler Master` → `cooler-master`). */
const brandKey = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

/** The key `brandKey` accepts, from a catalogue brand name; `null` when
 * nothing is left (the caller drops that brand). */
export function analyticsBrandKey(brand: string): string | null {
  const key = brand
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return key === "" ? null : key;
}

/** A link's row in the purchase block, or how many rows it has (at most four). */
const linkPosition = z.int().min(1).max(4);

/** Carried by every results-page event: `page` is the main page (the list's
 * first place) or a detail page (places 2 to 5); `rank` is the place of the
 * mouse in the big header in the list on screen; `filtered` says whether
 * the filter is on. */
const resultsPage = {
  page: z.enum(["main", "detail"]),
  rank: z.int().min(1).max(5),
  filtered: z.boolean(),
};

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
    /** 2026-10-19, candidate: see `LIVE_WAIT_BUCKETS`. Optional until the client sends it. */
    liveWait: z.enum(LIVE_WAIT_BUCKETS).optional(),
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
    /** How straight on the shot was, when the sheet's four corners were found
     * (2026-10-16, candidate); absent otherwise. */
    paperSkew: z.enum(PAPER_SKEW_BUCKETS).optional(),
    /** 2026-10-19, candidate: see `PAPER_COVERAGE_BUCKETS`; absent without four corners. */
    paperCoverage: z.enum(PAPER_COVERAGE_BUCKETS).optional(),
    /** 2026-10-19, candidate, shadow mode: see `HAND_POSE_BUCKETS`; absent without a hand. */
    handPose: z.enum(HAND_POSE_BUCKETS).optional(),
  }),

  /** The pipeline produced measurements (the numbers themselves stay out). */
  scan_measured: z.strictObject({
    flow: z.enum(SCAN_FLOWS),
    attempt,
    paper: z.enum(["detected", "manual", "none"]),
  }),

  /** The conditions of a photo that was measured (2026-10-16, candidate), sent
   * with `scan_measured`. It answers how often the focal length is missing and
   * what the photos look like, without saying anything about the hand.
   * `edgeFit` is a bucket of the sheet's edge-fit distance; the sheet was found,
   * since the photo was measured. `parallaxCorrected` is false exactly when
   * `focalSource` is `none` today, but is its own field so a later change to
   * the correction cannot hide behind it. */
  scan_quality: z.strictObject({
    flow: z.enum(SCAN_FLOWS),
    attempt,
    method: z.enum(CAPTURE_METHODS),
    focalSource: z.enum(FOCAL_SOURCES),
    parallaxCorrected: z.boolean(),
    sharpness: z.enum(SHARPNESS_BUCKETS),
    resolution: z.enum(RESOLUTION_BUCKETS),
    edgeFit: z.enum(EDGE_FIT_BUCKETS),
    paperSkew: z.enum(PAPER_SKEW_BUCKETS),
    /** How far the sheet's observed shape is from the paper's true one (2026-10-17, candidate). */
    paperAspect: z.enum(PAPER_ASPECT_BUCKETS),
    /** What a nominal focal length would have changed, shadow mode only. */
    priorEffect: z.enum(PRIOR_EFFECT_BUCKETS),
    /** 2026-10-19, candidate: see `PAPER_COVERAGE_BUCKETS`. Optional until the client sends it. */
    paperCoverage: z.enum(PAPER_COVERAGE_BUCKETS).optional(),
    /** 2026-10-19, candidate, shadow mode: see `HAND_POSE_BUCKETS`. Optional until the client sends it. */
    handPose: z.enum(HAND_POSE_BUCKETS).optional(),
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

  /** The written analysis settled. `fallback`: the template text was shown
   * instead of the model's. */
  analysis_shown: z.strictObject({
    outcome: z.enum(["model", "fallback", "error"]),
  }),

  analysis_retry_clicked: z.strictObject({}),

  /** The scan was deleted from the results page. */
  scan_deleted: z.strictObject({}),

  // ------------------------------------------------- results page (2026-10-13)
  // Every event below carries `resultsPage`: which page, the place of the
  // mouse in the big header, and whether the filter (篩選) is on. The demo
  // page sends none of them.

  /** A results page settled once (not again on a re-render). A detail page
   * (place 2 to 5) counts too. `poorFit`: the mouse in the header scores
   * under the poor-fit notice's threshold. 2026-10-20 (fit-v3.0 candidate):
   * when the fit response's length is out of the catalogue's range the total
   * is a ranking value, not a fit, so `poorFit` is left out. */
  results_page_viewed: z.union([
    z.strictObject({
      state: z.literal("ready"),
      ...resultsPage,
      mouse: mouseSlug,
      overallRank: rank,
      poorFit: z.boolean().optional(),
    }),
    z.strictObject({
      state: z.enum(RESULTS_STATES).exclude(["ready"]),
    }),
  ]),

  /** The purchase block appeared with `count` links, once per mouse per page
   * (the impression a click rate is computed against). */
  purchase_links_shown: z.strictObject({
    ...resultsPage,
    mouse: mouseSlug,
    count: linkPosition,
  }),

  /** A purchase link was clicked. `retailer` comes from `retailerOf(url)`;
   * the URL itself is never sent. `position` is the link's row, from 1. */
  purchase_link_clicked: z.strictObject({
    ...resultsPage,
    mouse: mouseSlug,
    overallRank: rank,
    retailer: z.enum(RETAILERS),
    position: linkPosition,
  }),

  /** The maker's page link (next to the fit-band chip) was clicked. */
  official_link_clicked: z.strictObject({
    ...resultsPage,
    mouse: mouseSlug,
    kind: z.enum(["product", "brand"]),
  }),

  /** The person opened 「詳細」 (an opening for print does not count). */
  details_opened: z.strictObject({ ...resultsPage }),

  /** The first drag, zoom or tap on the 3D viewer, once per page. */
  viewer_used: z.strictObject({ ...resultsPage }),

  /** The photo of the mouse in the header was opened full size. */
  photo_zoomed: z.strictObject({ ...resultsPage, mouse: mouseSlug }),

  /** A card in 「其他推薦」 was clicked. `toRank` is the card's place in the
   * list on screen (the filtered one while filtering). */
  pick_opened: z.strictObject({
    ...resultsPage,
    toRank: rank,
    mouse: mouseSlug,
  }),

  /** 「其他滑鼠」 was opened (not closed). */
  other_mice_opened: z.strictObject({ ...resultsPage }),

  /** The similar-hands block drew something: a list or its "not enough
   * data" note. Nothing is sent while it draws nothing. */
  similar_hands_shown: z.strictObject({
    status: z.enum(["list", "unavailable"]),
  }),

  /** The applied filter changed (one event per change that reaches the
   * page, so a sheet sends one on 「套用」, not one per tap). The arrays are
   * the whole selection after the change; `count` is the number of cards it
   * leaves, clamped to the cap (0 is the no-match state). `source` is where
   * the change was made. */
  filter_applied: z.strictObject({
    ...resultsPage,
    source: z.enum(FILTER_SOURCES),
    brand: z.array(brandKey).max(ANALYTICS_COUNT_CAP),
    size: z.array(z.enum(["small", "medium", "large"])).max(3),
    weight: z.array(z.enum(["lt50", "50-69", "70-89", "gte90"])).max(4),
    shape: z.array(z.enum(["ergonomic", "symmetrical"])).max(2),
    connectivity: z.array(z.enum(["wireless", "wired"])).max(2),
    count: z.int().min(0).max(ANALYTICS_COUNT_CAP),
  }),

  /** The filter sheet (narrow screens) was opened. */
  filter_sheet_opened: z.strictObject({ ...resultsPage }),

  /** A share button was pressed. `overall`: the button said it shares the
   * overall #1 (a filtered page whose #1 is another mouse). */
  share_started: z.strictObject({
    ...resultsPage,
    position: z.enum(SHARE_POSITIONS),
    overall: z.boolean(),
  }),

  /** The share card was handed over: `ShareOutcome` from `deliverShareFile`. */
  share_finished: z.strictObject({
    ...resultsPage,
    position: z.enum(SHARE_POSITIONS),
    outcome: z.enum(["shared", "downloaded", "cancelled", "failed"]),
  }),

  /** The questionnaire reminder in the top bar was clicked. */
  survey_reminder_clicked: z.strictObject({
    ...resultsPage,
    unanswered: z.boolean(),
  }),

  /** 「重新掃描」 in the top bar was clicked. */
  rescan_clicked: z.strictObject({ ...resultsPage }),

  /** The result-feedback sheet appeared (result-feedback.ts, candidate):
   * `trigger` says which came first, the end of the ranking or the dwell. */
  result_feedback_shown: z.strictObject({
    ...resultsPage,
    trigger: z.enum(["scrolled", "dwell"]),
  }),

  /** The sheet's rating was stored (201). The stars only: the comment never
   * leaves in an event, `commented` says whether there was one. */
  result_feedback_submitted: z.strictObject({
    ...resultsPage,
    stars: z.int().min(1).max(5),
    commented: z.boolean(),
  }),

  /** The sheet was closed with 「稍後再說」 before anything was sent. */
  result_feedback_dismissed: z.strictObject({ ...resultsPage }),

  /** 「重新掃描」 (the back link or the page's button) on a results page that
   * shows no result: still loading, an error, or the scan just deleted. It has
   * no page fields, because there is no list. */
  status_rescan_clicked: z.strictObject({
    state: z.enum(RESCAN_STATES),
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
