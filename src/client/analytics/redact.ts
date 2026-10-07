/**
 * The pure half of the PostHog `before_send` hook (issue #138): every
 * URL-shaped property goes through the contract's `redactAnalyticsPath`, and
 * is deleted when that returns null. Nothing here touches the network.
 */
import { redactAnalyticsPath } from "@/lib/contracts/analytics";

/** The URL-shaped properties PostHog adds by itself. */
const URL_KEYS = [
  "$current_url",
  "$pathname",
  "$referrer",
  "$initial_current_url",
  "$initial_pathname",
  "$initial_referrer",
  "$prev_pageview_pathname",
  "$prev_pageview_last_pathname",
  "$session_entry_url",
  "$session_entry_pathname",
  "$session_entry_referrer",
] as const;

/** Any other key that looks URL-shaped is treated the same way. */
const URL_KEY_SHAPE = /(url|pathname|referrer)$/i;

/** PostHog's "$direct" marker for no referrer: not a URL, kept as is. */
const NO_VALUE = "$direct";

/** Advertising click IDs: identify a click and so, through the ad network, a person. utm_* is kept. */
const CLICK_IDS = new Set([
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "ttclid",
  "twclid",
  "li_fat_id",
  "gad_source",
  "dclid",
  "igshid",
  "mc_cid",
]);
const CLICK_ID_PREFIXES = ["$initial_", "$session_entry_", "$"];

function isClickId(key: string): boolean {
  if (CLICK_IDS.has(key)) return true;
  return CLICK_ID_PREFIXES.some(
    (prefix) =>
      key.startsWith(prefix) && CLICK_IDS.has(key.slice(prefix.length)),
  );
}

type Bag = Record<string, unknown>;

function isUrlKey(key: string): boolean {
  return (
    (URL_KEYS as readonly string[]).includes(key) || URL_KEY_SHAPE.test(key)
  );
}

/** Redacts a property bag; returns a new object and never mutates. */
export function redactUrlProperties(bag: Bag): Bag {
  const out: Bag = {};
  for (const [key, value] of Object.entries(bag)) {
    if (isClickId(key)) continue;
    if (key === "$referring_domain") {
      // A bare host is kept. One that carries a path cannot be redacted by
      // the path rule (it is not a path), so it is dropped.
      if (typeof value === "string" && !value.includes("/")) out[key] = value;
      continue;
    }
    if (!isUrlKey(key)) {
      out[key] = value;
      continue;
    }
    if (typeof value !== "string") continue;
    if (value === NO_VALUE || value === "") {
      out[key] = value;
      continue;
    }
    const redacted = redactAnalyticsPath(value);
    if (redacted !== null) out[key] = redacted;
  }
  return out;
}

interface EventLike {
  properties?: Bag;
  $set?: Bag;
  $set_once?: Bag;
}

/** Applies `redactUrlProperties` to an event's properties, `$set` and `$set_once`. */
export function redactEventUrls<T extends EventLike>(event: T): T {
  const out: T = { ...event };
  if (event.properties) out.properties = redactUrlProperties(event.properties);
  if (event.$set) out.$set = redactUrlProperties(event.$set);
  if (event.$set_once) out.$set_once = redactUrlProperties(event.$set_once);
  return out;
}

/** The `before_send` hook: redacts the event, or drops it when there is none. */
export function beforeSend<T extends EventLike>(event: T | null): T | null {
  return event ? redactEventUrls(event) : null;
}
