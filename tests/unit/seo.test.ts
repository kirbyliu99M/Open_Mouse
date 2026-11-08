import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import robots from "../../src/app/robots";
import sitemap from "../../src/app/sitemap";
import {
  SITEMAP_PATHS,
  absoluteUrl,
  isIndexableDeployment,
  siteRobots,
} from "../../src/lib/seo";
import { LEGACY_HOST, SITE_URL } from "../../src/lib/site";

// The sitemap reads the listed catalogue (server-only, a database); two rows
// stand in for it.
vi.mock("../../src/server/seo/catalogue", () => ({
  listedMice: async () => [
    {
      slug: "brand-a",
      brand: "Brand",
      model: "A",
      size: "medium",
      shape: "symmetrical",
      connectivity: "wireless",
      lengthMm: 120,
      widthMm: 62,
      heightMm: 38,
      weightG: 55,
    },
    {
      slug: "brand-b",
      brand: "Brand",
      model: "B",
      size: "medium",
      shape: "symmetrical",
      connectivity: "wireless",
      lengthMm: 122,
      widthMm: 63,
      heightMm: 39,
      weightG: 60,
    },
  ],
}));

afterEach(() => vi.unstubAllEnvs());

describe("which deployments are indexable", () => {
  it("indexes production and an unset VERCEL_ENV (local, e2e)", () => {
    expect(isIndexableDeployment("production")).toBe(true);
    expect(isIndexableDeployment(undefined)).toBe(true);
    expect(siteRobots("production")).toEqual({ index: true, follow: true });
  });

  it("keeps every preview and development deployment out", () => {
    for (const env of ["preview", "development"]) {
      expect(isIndexableDeployment(env)).toBe(false);
      expect(siteRobots(env)).toEqual({ index: false, follow: false });
    }
  });
});

describe("robots.txt", () => {
  it("points at the sitemap on SITE_URL and closes only machine endpoints", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const r = robots();
    expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.disallow).toEqual(["/api/", "/ingest/", "/monitoring"]);
    // A private page must stay crawlable so its noindex is read.
    for (const path of ["/results", "/l/", "/account"]) {
      expect(JSON.stringify(rule.disallow)).not.toContain(path);
    }
  });

  it("blocks everything on a preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});

describe("sitemap.xml", () => {
  it("lists every public page in both languages on SITE_URL, each once", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.slice(0, 4)).toEqual([
      SITE_URL,
      `${SITE_URL}/en`,
      `${SITE_URL}/scan/easy`,
      `${SITE_URL}/en/scan/easy`,
    ]);
    // The fixed pages, both mice and their one comparison, in two languages.
    expect(urls).toHaveLength((SITEMAP_PATHS.length + 3) * 2);
    expect(urls).toContain(`${SITE_URL}/en/mice/brand-a`);
    expect(urls).toContain(`${SITE_URL}/compare/brand-a-vs-brand-b`);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("names every language version of each page, x-default unprefixed", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const mice = (await sitemap()).filter((e) => e.url.endsWith("/mice"));
    expect(mice).toHaveLength(2);
    for (const entry of mice) {
      expect(entry.alternates?.languages).toEqual({
        "zh-TW": `${SITE_URL}/mice`,
        en: `${SITE_URL}/en/mice`,
        "x-default": `${SITE_URL}/mice`,
      });
    }
  });

  it("never lists a private, demo or closed route", () => {
    for (const path of SITEMAP_PATHS) {
      expect(path).not.toMatch(
        /^\/(api|results|l|account|sheet|ingest|monitoring)(\/|$)|^\/scan$|demo|preview|\/kit/,
      );
    }
    expect(absoluteUrl("/")).toBe(SITE_URL);
  });

  it("is empty on a preview", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(await sitemap()).toEqual([]);
  });
});

describe("next.config.ts redirects()", () => {
  async function legacyRule() {
    const redirects = nextConfig.redirects;
    if (!redirects) throw new Error("next.config.ts defines no redirects()");
    return (await redirects()).find((r) =>
      r.has?.some((h) => h.type === "host" && h.value === LEGACY_HOST),
    );
  }

  it("moves the first address to SITE_URL permanently, path and all", async () => {
    const rule = await legacyRule();
    expect(rule).toBeDefined();
    expect(rule!.permanent).toBe(true);
    expect(rule!.destination).toBe(`${SITE_URL}/:path`);
    expect(LEGACY_HOST).not.toBe(new URL(SITE_URL).host);
  });

  it("leaves /api alone (cron calls and API clients get no redirect)", async () => {
    const rule = await legacyRule();
    const re = new RegExp(
      `^${rule!.source.replace(/:path/, "")}$`.replace("^/", "^/"),
    );
    expect(re.test("/api/health")).toBe(false);
    expect(re.test("/api")).toBe(false);
    expect(re.test("/apiary")).toBe(true);
    expect(re.test("/mice")).toBe(true);
  });
});
