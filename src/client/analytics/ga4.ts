/**
 * Google Analytics 4, loaded only after the visitor accepts cookies (see
 * `src/client/consent/consent.ts`). Without `NEXT_PUBLIC_GA_ID`, or before
 * consent, nothing here touches the network and gtag.js is never requested.
 *
 * What may reach Google is narrower than what PostHog gets, on purpose:
 *   - a page view carries only the path with `redactAnalyticsPath` applied
 *     (a scan ID or learning-kit token becomes its route pattern, the query
 *     and fragment are dropped). Every event also overrides gtag's own
 *     `page_location` / `page_referrer`, which would otherwise be the real URL;
 *   - only the events in `GA4_EVENTS`, and of those only the listed properties:
 *     funnel steps and categories. No mouse, rank or fit property: a pick is
 *     derived from the hand, and Google is a third party with cookies;
 *   - ads features off: no Google signals, no ad personalisation, and the
 *     consent signals for ads are denied.
 * The GA4 admin must also have Enhanced measurement off (its outbound-click and
 * scroll events read the real URL); see the PR description.
 */
import { redactAnalyticsPath } from "@/lib/contracts/analytics";

const GA_ID_SHAPE = /^G-[A-Z0-9]{4,20}$/;

/** The measurement ID, or null when unset or not shaped like one. */
export function ga4Id(): string | null {
  const id = process.env.NEXT_PUBLIC_GA_ID;
  return id && GA_ID_SHAPE.test(id) ? id : null;
}

export const ga4Configured = (): boolean => ga4Id() !== null;

/** Which product events go to GA4, and which of their properties. */
export const GA4_EVENTS: Readonly<Record<string, readonly string[]>> = {
  home_cta_clicked: ["cta"],
  scan_entry_shown: ["flow", "device"],
  scan_submitted: ["flow"],
  scan_submit_failed: ["flow", "kind"],
  analysis_shown: ["outcome"],
  results_page_viewed: ["state"],
  purchase_link_clicked: ["retailer", "position"],
  official_link_clicked: ["kind"],
  share_finished: ["outcome"],
};

type Params = Record<string, string | number | boolean>;

/** The GA4 event for a product event, or null when it is not sent to GA4. */
export function toGa4Event(
  name: string,
  props: Record<string, unknown>,
): { name: string; params: Params } | null {
  const keep = GA4_EVENTS[name];
  if (!keep) return null;
  const params: Params = {};
  for (const key of keep) {
    const value = props[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      params[key] = value;
    }
  }
  return { name, params };
}

/** A URL as GA4 may see it: origin and redacted path, no query or fragment. */
export function redactedUrl(value: string): string | null {
  return redactAnalyticsPath(value);
}

/** The cookies GA4 sets for a measurement ID: `_ga` and `_ga_<ID without "G-">`. */
export function ga4CookieNames(id: string): string[] {
  return ["_ga", `_ga_${id.replace(/^G-/, "")}`];
}

/**
 * Expires the GA4 cookies on the host and on every parent domain: gtag sets
 * them on the broadest domain it may, so one `Domain` is not enough to find them.
 */
export function ga4CookieDeletions(id: string, hostname: string): string[] {
  const labels = hostname.split(".");
  const domains: Array<string | null> = [null];
  for (let i = 0; i < labels.length - 1; i += 1) {
    domains.push(`.${labels.slice(i).join(".")}`);
  }
  const out: string[] = [];
  for (const name of ga4CookieNames(id)) {
    for (const domain of domains) {
      out.push(
        `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ""}`,
      );
    }
  }
  return out;
}

interface Ga4Window extends Window {
  dataLayer?: unknown[];
  [disableKey: `ga-disable-${string}`]: boolean | undefined;
}

let loaded = false;

function win(): Ga4Window {
  return window as unknown as Ga4Window;
}

/** Google's own shape: gtag.js reads `arguments` objects from `dataLayer`, not arrays. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function gtag(..._args: unknown[]): void {
  const w = win();
  w.dataLayer = w.dataLayer ?? [];
  // eslint-disable-next-line prefer-rest-params
  w.dataLayer.push(arguments);
}

function currentLocation(): string {
  const { origin, pathname } = window.location;
  return redactedUrl(`${origin}${pathname}`) ?? `${origin}/`;
}

function currentReferrer(): string | undefined {
  if (!document.referrer) return undefined;
  return redactedUrl(document.referrer) ?? undefined;
}

/**
 * What GA4 should be doing for a consent state: load on "granted"; switch off
 * on "denied" and on "unset" (a choice that was cleared, say from another tab,
 * is no consent); leave alone while the state is still unknown (server render).
 */
export function ga4Step(
  consent: "granted" | "denied" | "unset" | "unknown",
): "enable" | "disable" | "idle" {
  if (!ga4Configured()) return "idle";
  if (consent === "granted") return "enable";
  return consent === "unknown" ? "idle" : "disable";
}

/** True while GA4 is loaded and not switched off. */
export function ga4Active(): boolean {
  const id = ga4Id();
  return loaded && id !== null && !win()[`ga-disable-${id}`];
}

/** Loads gtag.js once, after consent. Does nothing without a valid ID. */
export function enableGa4(): void {
  const id = ga4Id();
  if (!id || typeof window === "undefined") return;
  win()[`ga-disable-${id}`] = false;
  if (loaded) {
    gtag("consent", "update", { analytics_storage: "granted" });
    return;
  }
  loaded = true;
  gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  gtag("js", new Date());
  gtag("config", id, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_flags:
      window.location.protocol === "https:"
        ? "SameSite=Lax;Secure"
        : "SameSite=Lax",
    page_location: currentLocation(),
    page_referrer: currentReferrer(),
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

/** Switches GA4 off for this page and deletes its cookies (a withdrawn consent). */
export function disableGa4(): void {
  const id = ga4Id();
  if (!id || typeof window === "undefined") return;
  win()[`ga-disable-${id}`] = true;
  if (loaded) gtag("consent", "update", { analytics_storage: "denied" });
  // A visitor who never accepted has no GA4 cookies: nothing to delete.
  if (!document.cookie.includes("_ga")) return;
  for (const cookie of ga4CookieDeletions(id, window.location.hostname)) {
    document.cookie = cookie;
  }
}

/** A page view for the current route, with the redacted location. */
export function ga4PageView(): void {
  if (!ga4Active()) return;
  gtag("event", "page_view", {
    page_location: currentLocation(),
    page_referrer: currentReferrer(),
  });
}

/** A product event: sent only when GA4 is active and the event is on the list. */
export function sendToGa4(name: string, props: Record<string, unknown>): void {
  if (!ga4Active()) return;
  const event = toGa4Event(name, props);
  if (!event) return;
  gtag("event", event.name, {
    ...event.params,
    page_location: currentLocation(),
    page_referrer: currentReferrer(),
  });
}
