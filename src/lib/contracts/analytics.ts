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

  /** @deprecated Replaced by `results_page_viewed`; removed once no caller sends it. */
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

  /** @deprecated Replaced by `other_mice_opened`; removed once no caller sends it. */
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

  /** @deprecated Never sent; replaced by `purchase_link_clicked`. */
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

  // ------------------------------------------------- results page (2026-10-13)
  // Every event below carries `resultsPage`: which page, the place of the
  // mouse in the big header, and whether the filter (篩選) is on. The demo
  // page sends none of them.

  /** A results page settled once (not again on a re-render). A detail page
   * (place 2 to 5) counts too. `poorFit`: the mouse in the header scores
   * under the poor-fit notice's threshold. */
  results_page_viewed: z.union([
    z.strictObject({
      state: z.literal("ready"),
      ...resultsPage,
      mouse: mouseSlug,
      overallRank: rank,
      poorFit: z.boolean(),
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
