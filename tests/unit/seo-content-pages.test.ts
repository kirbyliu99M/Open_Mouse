/**
 * The public content pages rendered end to end (SEO task, 2026-10-28): the
 * mouse page, a comparison, the comparison index, the FAQ and both guides,
 * in both languages, with the listed catalogue replaced by rows built from
 * the seed file. Checks what a crawler reads: one h1, the JSON-LD, the
 * numbers, the links staying in the page's language, and the 404s.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "../../src/lib/contracts/locale";
import { toMiceListRow, type MiceListRow } from "../../src/lib/mice/list";
import { computeSize } from "../../src/server/catalogue/size";

const SEED = JSON.parse(readFileSync("src/db/seed/catalogue.json", "utf8")) as {
  slug: string;
  brand: string;
  model: string;
  shape: MiceListRow["shape"];
  connectivity: MiceListRow["connectivity"];
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightG: number | null;
}[];
const ROWS: MiceListRow[] = SEED.map((r) =>
  toMiceListRow({
    ...r,
    size: computeSize({
      lengthMm: r.lengthMm,
      widthMm: r.widthMm,
      heightMm: r.heightMm,
    }),
  }),
);

const state: { locale: Locale; urlLocale: Locale | null } = {
  locale: "zh-TW",
  urlLocale: null,
};
vi.mock("../../src/server/i18n/getLocale", () => ({
  getLocale: async () => state.locale,
  getUrlLocale: async () => state.urlLocale,
}));
vi.mock("../../src/server/catalogue/list-mice", () => ({
  getMiceList: async () => ({ status: "ok", rows: ROWS }),
}));
vi.mock("server-only", () => ({}));
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const permanentRedirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`);
});
vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  notFound: () => notFound(),
  permanentRedirect: (to: string) => permanentRedirect(to),
}));

beforeEach(() => {
  state.locale = "zh-TW";
  state.urlLocale = null;
});
afterEach(() => vi.clearAllMocks());

async function html(el: Promise<React.ReactElement> | React.ReactElement) {
  return renderToStaticMarkup(await el);
}
const params = <T>(p: T) => ({ params: Promise.resolve(p) });

function jsonLd(markup: string): { "@type": string }[] {
  const m = markup.match(
    /<script type="application\/ld\+json">(.*?)<\/script>/,
  );
  expect(m, "JSON-LD present").not.toBeNull();
  return JSON.parse(m![1]);
}

describe("/mice/[slug]", () => {
  it("shows the specs, the hand fit, similar mice and Product JSON-LD", async () => {
    const { default: Page } = await import("../../src/app/mice/[slug]/page");
    const out = await html(Page(params({ slug: "razer-viper-v3-pro" })));
    expect(out.match(/<h1>/g)).toHaveLength(1);
    expect(out).toContain("Razer Viper V3 Pro 尺寸規格與適合手型");
    expect(out).toContain("127.1 mm");
    expect(out).toMatch(/href="\/compare\/[a-z0-9-]+-vs-[a-z0-9-]+"/);
    const types = jsonLd(out).map((o) => o["@type"]);
    expect(types).toEqual(["Product", "BreadcrumbList"]);
    writeFileSync(`${process.env.SEO_RENDER_DIR ?? "/tmp"}/mouse-zh.html`, out);
  });

  it("keeps links in English on the English page", async () => {
    state.locale = "en";
    state.urlLocale = "en";
    const { default: Page } = await import("../../src/app/mice/[slug]/page");
    const out = await html(Page(params({ slug: "razer-viper-v3-pro" })));
    expect(out).toContain("dimensions and hand size fit");
    expect(out).toMatch(/href="\/en\/compare\//);
    expect(out).not.toMatch(/href="\/compare\//);
  });

  it("is a 404 for a slug that is not listed", async () => {
    const { default: Page } = await import("../../src/app/mice/[slug]/page");
    await expect(Page(params({ slug: "no-such-mouse" }))).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });
});

describe("/compare/[pair]", () => {
  const seg = "logitech-g-pro-x-superlight-2-vs-razer-viper-v3-pro";

  it("compares both mice with computed differences", async () => {
    const { default: Page } = await import("../../src/app/compare/[pair]/page");
    const out = await html(Page(params({ pair: seg })));
    expect(out.match(/<h1>/g)).toHaveLength(1);
    // Viper (127.1) minus Superlight 2 (125): 2.1 mm longer.
    expect(out).toContain(
      "Razer Viper V3 Pro 比 Logitech G Pro X Superlight 2 長 2.1 mm。",
    );
    expect(out).toContain("+2.1 mm");
    expect(jsonLd(out).map((o) => o["@type"])).toEqual([
      "Article",
      "BreadcrumbList",
    ]);
    writeFileSync(
      `${process.env.SEO_RENDER_DIR ?? "/tmp"}/compare-zh.html`,
      out,
    );
  });

  it("redirects the other order to the canonical URL, in the URL's language", async () => {
    state.urlLocale = "en";
    const { default: Page } = await import("../../src/app/compare/[pair]/page");
    await expect(
      Page(
        params({ pair: "razer-viper-v3-pro-vs-logitech-g-pro-x-superlight-2" }),
      ),
    ).rejects.toThrow(`REDIRECT /en/compare/${seg}`);
  });

  it("indexes featured pairs and leaves arbitrary pairs noindex", async () => {
    const { generateMetadata } =
      await import("../../src/app/compare/[pair]/page");
    const featured = await generateMetadata(params({ pair: seg }));
    expect(featured.robots).toBeUndefined();
    const random = await generateMetadata(
      params({ pair: "asus-rog-chakram-vs-zowie-za13-dw" }),
    );
    expect(random.robots).toEqual({ index: false, follow: true });
  });

  it("is a 404 for an unknown or malformed pair", async () => {
    const { default: Page } = await import("../../src/app/compare/[pair]/page");
    for (const pair of ["nope-vs-razer-viper-v3-pro", "razer-viper-v3-pro"]) {
      await expect(Page(params({ pair }))).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });
});

describe("FAQ, guides and the comparison index", () => {
  it.each(["zh-TW", "en"] as const)(
    "%s: render with JSON-LD and one h1",
    async (locale) => {
      state.locale = locale;
      state.urlLocale = locale === "en" ? "en" : null;
      const pages = {
        faq: (await import("../../src/app/faq/page")).default,
        guides: (await import("../../src/app/guides/page")).default,
        size: (
          await import("../../src/app/guides/mouse-size-for-hand-size/page")
        ).default,
        shape: (
          await import("../../src/app/guides/symmetrical-vs-ergonomic/page")
        ).default,
        compare: (await import("../../src/app/compare/page")).default,
      };
      for (const [name, Page] of Object.entries(pages)) {
        const out = await html(Page());
        expect(out.match(/<h1>/g), name).toHaveLength(1);
        expect(jsonLd(out).length, name).toBeGreaterThan(0);
        writeFileSync(
          `${process.env.SEO_RENDER_DIR ?? "/tmp"}/${name}-${locale}.html`,
          out,
        );
      }
    },
  );

  it("puts every visible FAQ answer in the FAQPage data", async () => {
    const { default: Page } = await import("../../src/app/faq/page");
    const out = await html(Page());
    const faq = jsonLd(out).find(
      (o) => o["@type"] === "FAQPage",
    ) as unknown as {
      mainEntity: { name: string }[];
    };
    expect(faq.mainEntity.length).toBe(13);
    for (const q of faq.mainEntity) expect(out).toContain(`<h3>${q.name}</h3>`);
  });
});
