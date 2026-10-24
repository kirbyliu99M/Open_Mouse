import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// enableGa4 / disableGa4 / sendToGa4 / ga4PageView decide what reaches Google,
// and the e2e that exercises them only runs with a GA ID set (not in CI). These
// run them against a fake window and document, so a change to the consent
// signals, the redaction or the switch-off fails here.
const ID = "G-ABCD123456";
const UUID = "3f2b8c1e-5d4a-4e6f-9a0b-1c2d3e4f5a6b";

interface Fake {
  mod: typeof import("@/client/analytics/ga4");
  win: Record<string, unknown>;
  scripts: Array<{ src?: string; async?: boolean }>;
  cookieWrites: string[];
  calls: () => unknown[][];
}

async function load(cookie = ""): Promise<Fake> {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_GA_ID", ID);
  const scripts: Fake["scripts"] = [];
  const cookieWrites: string[] = [];
  const win: Record<string, unknown> = {
    location: {
      origin: "https://palmate.test",
      pathname: `/results/${UUID}`,
      protocol: "https:",
      hostname: "palmate.test",
    },
  };
  const doc = {
    referrer: `https://other.test/a?token=secret`,
    head: { appendChild: (el: { src?: string }) => scripts.push(el) },
    createElement: () => ({}),
  };
  Object.defineProperty(doc, "cookie", {
    get: () => cookie,
    set: (value: string) => cookieWrites.push(value),
  });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
  const mod = await import("@/client/analytics/ga4");
  return {
    mod,
    win,
    scripts,
    cookieWrites,
    calls: () =>
      ((win.dataLayer as ArrayLike<unknown>[] | undefined) ?? []).map((entry) =>
        Array.from(entry),
      ),
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("before enableGa4", () => {
  it("loads nothing and sends nothing", async () => {
    const g = await load();
    g.mod.ga4PageView();
    g.mod.sendToGa4("home_cta_clicked", { cta: "scan" });
    expect(g.scripts).toEqual([]);
    expect(g.calls()).toEqual([]);
    expect(g.mod.ga4Active()).toBe(false);
  });
});

describe("enableGa4", () => {
  it("loads gtag once, with the ads signals denied and no automatic page view", async () => {
    const g = await load();
    g.mod.enableGa4();
    g.mod.enableGa4();
    expect(g.scripts).toHaveLength(1);
    expect(g.scripts[0]!.src).toBe(
      `https://www.googletagmanager.com/gtag/js?id=${ID}`,
    );
    const consent = g
      .calls()
      .find((c) => c[0] === "consent" && c[1] === "default");
    expect(consent?.[2]).toEqual({
      analytics_storage: "granted",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    const config = g.calls().find((c) => c[0] === "config");
    expect(config?.[1]).toBe(ID);
    expect(config?.[2]).toMatchObject({
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_flags: "SameSite=Lax;Secure",
      page_location: "https://palmate.test/results/[scanId]",
    });
    expect(g.mod.ga4Active()).toBe(true);
  });

  it("never hands the real scan ID or the referrer's query to gtag", async () => {
    const g = await load();
    g.mod.enableGa4();
    g.mod.ga4PageView();
    g.mod.sendToGa4("purchase_link_clicked", {
      retailer: "amazon",
      position: 1,
      mouse: "g-pro",
    });
    const all = JSON.stringify(g.calls());
    expect(all).not.toContain(UUID);
    expect(all).not.toContain("secret");
  });
});

describe("sending", () => {
  it("sends a listed event with the redacted location and only its listed properties", async () => {
    const g = await load();
    g.mod.enableGa4();
    g.mod.sendToGa4("purchase_link_clicked", {
      retailer: "amazon",
      position: 2,
      mouse: "g-pro",
      rank: 1,
    });
    const event = g.calls().find((c) => c[1] === "purchase_link_clicked");
    expect(event?.[0]).toBe("event");
    expect(event?.[2]).toEqual({
      retailer: "amazon",
      position: 2,
      page_location: "https://palmate.test/results/[scanId]",
      page_referrer: "https://other.test/a",
    });
  });

  it("drops events that are not on the list", async () => {
    const g = await load();
    g.mod.enableGa4();
    const before = g.calls().length;
    g.mod.sendToGa4("scan_measured", { mm: 183 });
    expect(g.calls()).toHaveLength(before);
  });
});

describe("disableGa4 (a withdrawn consent)", () => {
  it("stops page views and events on this page and denies analytics storage", async () => {
    const g = await load();
    g.mod.enableGa4();
    g.mod.disableGa4();
    const before = g.calls().length;
    g.mod.ga4PageView();
    g.mod.sendToGa4("home_cta_clicked", { cta: "scan" });
    const after = g.calls();
    expect(after.slice(before)).toEqual([]);
    expect(g.mod.ga4Active()).toBe(false);
    expect(
      after.filter((c) => c[0] === "consent" && c[1] === "update").at(-1)?.[2],
    ).toEqual({
      analytics_storage: "denied",
    });
    expect(g.win[`ga-disable-${ID}`]).toBe(true);
  });

  it("deletes the GA4 cookies when there are some", async () => {
    const g = await load("_ga=GA1.1.1; theme=dark");
    g.mod.disableGa4();
    expect(g.cookieWrites).toContain("_ga=; Max-Age=0; Path=/");
    expect(g.cookieWrites.some((c) => c.startsWith("_ga_ABCD123456="))).toBe(
      true,
    );
  });

  it("touches no cookie when there are none", async () => {
    const g = await load("theme=dark");
    g.mod.disableGa4();
    expect(g.cookieWrites).toEqual([]);
  });

  it("accepting again re-enables without loading gtag twice", async () => {
    const g = await load();
    g.mod.enableGa4();
    g.mod.disableGa4();
    g.mod.enableGa4();
    expect(g.scripts).toHaveLength(1);
    expect(g.mod.ga4Active()).toBe(true);
    expect(
      g
        .calls()
        .filter((c) => c[0] === "consent" && c[1] === "update")
        .at(-1)?.[2],
    ).toEqual({
      analytics_storage: "granted",
    });
  });
});

describe("ga4Step", () => {
  it("enables on granted, switches off on denied and unset, waits on unknown", async () => {
    const g = await load();
    expect(g.mod.ga4Step("granted")).toBe("enable");
    expect(g.mod.ga4Step("denied")).toBe("disable");
    expect(g.mod.ga4Step("unset")).toBe("disable");
    expect(g.mod.ga4Step("unknown")).toBe("idle");
  });

  it("does nothing at all without a measurement ID", async () => {
    const g = await load();
    vi.stubEnv("NEXT_PUBLIC_GA_ID", "");
    for (const state of ["granted", "denied", "unset", "unknown"] as const) {
      expect(g.mod.ga4Step(state)).toBe("idle");
    }
  });
});

describe("the event list is pinned", () => {
  it("is exactly the nine events, so a new one needs a deliberate edit here", async () => {
    const g = await load();
    expect(Object.keys(g.mod.GA4_EVENTS).sort()).toEqual(
      [
        "analysis_shown",
        "home_cta_clicked",
        "official_link_clicked",
        "purchase_link_clicked",
        "results_page_viewed",
        "scan_entry_shown",
        "scan_submit_failed",
        "scan_submitted",
        "share_finished",
      ].sort(),
    );
    expect(g.mod.GA4_EVENTS).toEqual({
      home_cta_clicked: ["cta"],
      scan_entry_shown: ["flow", "device"],
      scan_submitted: ["flow"],
      scan_submit_failed: ["flow", "kind"],
      analysis_shown: ["outcome"],
      results_page_viewed: ["state"],
      purchase_link_clicked: ["retailer", "position"],
      official_link_clicked: ["kind"],
      share_finished: ["outcome"],
    });
  });
});
