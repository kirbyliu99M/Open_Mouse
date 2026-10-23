import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GA4_EVENTS,
  ga4Active,
  ga4CookieDeletions,
  ga4CookieNames,
  ga4Id,
  redactedUrl,
  sendToGa4,
  toGa4Event,
} from "@/client/analytics/ga4";
import { createTrack } from "@/client/analytics/track";
import { parseConsent } from "@/client/consent/consent";
import { analyticsEventSchemas } from "@/lib/contracts/analytics";
import { en, zhTW } from "@/lib/copy/cookie-consent";

const UUID = "3f2b8c1e-5d4a-4e6f-9a0b-1c2d3e4f5a6b";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ga4Id", () => {
  it("is null when unset or not shaped like a measurement ID", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_ID", "");
    expect(ga4Id()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_GA_ID", "UA-123456-1");
    expect(ga4Id()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_GA_ID", "G-AB12;alert(1)");
    expect(ga4Id()).toBeNull();
  });

  it("returns a valid ID", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_ID", "G-ABCD123456");
    expect(ga4Id()).toBe("G-ABCD123456");
  });
});

describe("toGa4Event", () => {
  it("sends only the listed properties of a listed event", () => {
    expect(
      toGa4Event("purchase_link_clicked", {
        page: "main",
        rank: 1,
        filtered: false,
        mouse: "logitech-g-pro-x-superlight-2",
        overallRank: 1,
        retailer: "amazon",
        position: 2,
      }),
    ).toEqual({
      name: "purchase_link_clicked",
      params: { retailer: "amazon", position: 2 },
    });
  });

  it("leaves out every mouse, rank and fit property", () => {
    const event = toGa4Event("results_page_viewed", {
      state: "ready",
      page: "main",
      rank: 1,
      filtered: false,
      mouse: "x",
      overallRank: 1,
      poorFit: true,
    });
    expect(event?.params).toEqual({ state: "ready" });
  });

  it("drops events that are not on the list", () => {
    expect(toGa4Event("scan_measured", { anything: 1 })).toBeNull();
    expect(toGa4Event("$pageview", {})).toBeNull();
  });

  it("only lists events and properties that exist in the analytics contract", () => {
    for (const [name, keys] of Object.entries(GA4_EVENTS)) {
      const schema =
        analyticsEventSchemas[name as keyof typeof analyticsEventSchemas];
      expect(schema, name).toBeDefined();
      // Every kept key is a key of the event's schema (a union event: of any member).
      const shapes =
        "options" in schema
          ? (schema.options as unknown as Array<{
              shape: Record<string, unknown>;
            }>)
          : [schema as unknown as { shape: Record<string, unknown> }];
      const known = new Set(shapes.flatMap((s) => Object.keys(s.shape)));
      for (const key of keys)
        expect(known.has(key), `${name}.${key}`).toBe(true);
    }
  });

  it("never lists a property that carries a scan, a person or a measurement", () => {
    const banned = /mm|mouse|rank|poorFit|grip|hand|band|scan.?id|user|email/i;
    for (const keys of Object.values(GA4_EVENTS)) {
      for (const key of keys) expect(key).not.toMatch(banned);
    }
  });
});

describe("redactedUrl", () => {
  it("replaces ids and drops query and fragment", () => {
    expect(redactedUrl(`https://x.test/results/${UUID}?utm=1#top`)).toBe(
      "https://x.test/results/[scanId]",
    );
  });
});

describe("GA4 cookies", () => {
  it("names _ga and _ga_<ID without G->", () => {
    expect(ga4CookieNames("G-ABCD123456")).toEqual(["_ga", "_ga_ABCD123456"]);
  });

  it("expires each cookie on the host and on every parent domain", () => {
    const out = ga4CookieDeletions("G-ABCD123456", "www.palmate.example");
    expect(out).toContain("_ga=; Max-Age=0; Path=/");
    expect(out).toContain(
      "_ga=; Max-Age=0; Path=/; Domain=.www.palmate.example",
    );
    expect(out).toContain("_ga=; Max-Age=0; Path=/; Domain=.palmate.example");
    expect(out).toContain(
      "_ga_ABCD123456=; Max-Age=0; Path=/; Domain=.palmate.example",
    );
    // A bare public suffix such as ".example" is not tried: it is the last label.
    expect(out.some((c) => c.endsWith("Domain=.example"))).toBe(false);
  });
});

describe("before consent, nothing happens", () => {
  it("is not active and sending is a no-op (no window needed)", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_ID", "G-ABCD123456");
    expect(ga4Active()).toBe(false);
    expect(() => sendToGa4("home_cta_clicked", { cta: "scan" })).not.toThrow();
  });
});

describe("createTrack with a mirror", () => {
  const baseDeps = (over: object = {}) => {
    const send = vi.fn();
    const mirror = vi.fn();
    return {
      send,
      mirror,
      track: createTrack({
        enabled: () => true,
        send,
        mirror,
        mirrorEnabled: () => true,
        ...over,
      }),
    };
  };

  it("hands the same parsed props to both destinations", () => {
    const { track, send, mirror } = baseDeps();
    track("home_cta_clicked", { cta: "scan" });
    expect(send).toHaveBeenCalledWith("home_cta_clicked", { cta: "scan" });
    expect(mirror).toHaveBeenCalledWith("home_cta_clicked", { cta: "scan" });
  });

  it("works with no PostHog key: the mirror still gets the event", () => {
    const { track, send, mirror } = baseDeps({ enabled: () => false });
    track("home_cta_clicked", { cta: "scan" });
    expect(send).not.toHaveBeenCalled();
    expect(mirror).toHaveBeenCalledTimes(1);
  });

  it("skips the mirror when it is not enabled (no consent)", () => {
    const { track, send, mirror } = baseDeps({ mirrorEnabled: () => false });
    track("home_cta_clicked", { cta: "scan" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(mirror).not.toHaveBeenCalled();
  });

  it("sends nothing anywhere for props the schema refuses", () => {
    const { track, send, mirror } = baseDeps();
    // @ts-expect-error a property the contract does not have
    track("home_cta_clicked", { cta: "scan", mm: 183 });
    expect(send).not.toHaveBeenCalled();
    expect(mirror).not.toHaveBeenCalled();
  });

  it("a throwing mirror does not stop PostHog or the app", () => {
    const { track, send } = baseDeps({
      mirror: () => {
        throw new Error("boom");
      },
    });
    expect(() => track("home_cta_clicked", { cta: "scan" })).not.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("parseConsent", () => {
  it("accepts only the two choices", () => {
    expect(parseConsent("granted")).toBe("granted");
    expect(parseConsent("denied")).toBe("denied");
    expect(parseConsent("yes")).toBeNull();
    expect(parseConsent("")).toBeNull();
    expect(parseConsent(null)).toBeNull();
  });
});

describe("cookie statement copy", () => {
  it("has no empty string in either language", () => {
    for (const table of [zhTW, en]) {
      for (const [key, value] of Object.entries(table)) {
        expect(value.trim(), key).not.toBe("");
      }
    }
  });

  it("says in both languages that photos and measurements are not sent", () => {
    expect(zhTW.detailsSent).toContain("不含照片、手部量測值");
    expect(en.detailsSent).toContain("No photos, hand measurements");
  });
});
