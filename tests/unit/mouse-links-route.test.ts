import { describe, expect, it } from "vitest";
import * as route from "../../src/app/api/mice/[slug]/links/route";
import { GET, dynamic } from "../../src/app/api/mice/[slug]/links/route";
import { mouseLinksSchema } from "../../src/lib/contracts/commerce";
import {
  LINKS_CACHE_CONTROL,
  LINKS_NOT_FOUND_CACHE_CONTROL,
  linksForMouse,
  mouseLinksPath,
} from "../../src/lib/results/mouseLinks";
import { parseMouseMedia } from "../../src/lib/results/mouseMedia";
import { parsePurchaseLinks } from "../../src/lib/results/purchaseLinks";
import mouseMediaFile from "../../src/data/mouse-media.json";
import purchaseLinksFile from "../../src/data/purchase-links.json";

const MEDIA = parseMouseMedia({
  a: {
    officialUrl: "https://maker.example/a",
    officialKind: "product",
    image: "/images/mice/a.webp",
  },
  b: {
    officialUrl: "https://maker.example/lineup",
    officialKind: "brand",
    image: null,
  },
});
const PURCHASE = parsePurchaseLinks({
  a: [
    { label: "Shop A", url: "https://shop.example/a" },
    { label: "Shop B", url: "https://shop.example/b" },
  ],
  zzz: [{ label: "Other", url: "https://shop.example/z" }],
});

describe("linksForMouse", () => {
  it("gives the official link, its kind and the shop links of that mouse", () => {
    expect(linksForMouse(MEDIA, PURCHASE, "a")).toEqual({
      officialUrl: "https://maker.example/a",
      officialKind: "product",
      purchaseLinks: PURCHASE.a,
    });
  });

  it("gives an empty shop list, not a missing one, when the mouse has no shops", () => {
    expect(linksForMouse(MEDIA, PURCHASE, "b")).toEqual({
      officialUrl: "https://maker.example/lineup",
      officialKind: "brand",
      purchaseLinks: [],
    });
  });

  it("gives nothing for a slug that is not in the media file, even when it has shops", () => {
    expect(linksForMouse(MEDIA, PURCHASE, "zzz")).toBeNull();
    expect(linksForMouse(MEDIA, PURCHASE, "ghost")).toBeNull();
  });

  it("never reads the prototype", () => {
    expect(linksForMouse(MEDIA, PURCHASE, "constructor")).toBeNull();
    expect(linksForMouse(MEDIA, PURCHASE, "toString")).toBeNull();
  });

  it("builds the path the page asks for", () => {
    expect(mouseLinksPath("logitech-g502-hero")).toBe(
      "/api/mice/logitech-g502-hero/links",
    );
  });
});

describe("the route /api/mice/[slug]/links", () => {
  const media = parseMouseMedia(mouseMediaFile);
  const slugs = Object.keys(media);

  it("is one function for every slug, not one output per mouse (Deployment Storage)", () => {
    expect(dynamic).toBe("force-dynamic");
    // `generateStaticParams` makes Vercel list a ~7 MB function output per
    // slug (408 of them, 2.7 GB per deployment, measured 2026-10-15).
    expect(Object.keys(route)).not.toContain("generateStaticParams");
    expect(Object.keys(route)).not.toContain("dynamicParams");
    expect(Object.keys(route).sort()).toEqual(["GET", "dynamic"]);
  });

  it("has a media file with at least one slug", () => {
    expect(slugs.length).toBeGreaterThan(0);
  });

  it("pins the exact Cache-Control values the CDN is told", () => {
    expect(LINKS_CACHE_CONTROL).toBe(
      "public, s-maxage=86400, stale-while-revalidate=604800",
    );
    expect(LINKS_NOT_FOUND_CACHE_CONTROL).toBe("public, s-maxage=3600");
  });

  it("answers every slug of the media file with a body that passes mouseLinksSchema and is that mouse's own, and tells the CDN to keep it", async () => {
    const purchase = parsePurchaseLinks(purchaseLinksFile);
    for (const slug of slugs) {
      const res = await GET(new Request("http://x/api/mice/x/links"), {
        params: Promise.resolve({ slug }),
      });
      expect(res.status, slug).toBe(200);
      expect(res.headers.get("cache-control"), slug).toBe(LINKS_CACHE_CONTROL);
      const body = mouseLinksSchema.parse(await res.json());
      expect(body.officialUrl, slug).toBe(media[slug]!.officialUrl);
      expect(body.officialKind, slug).toBe(media[slug]!.officialKind);
      expect(body.purchaseLinks, slug).toEqual(purchase[slug] ?? []);
    }
  });

  it("answers an unknown slug with 404, no links, and a shorter cache", async () => {
    for (const slug of ["ghost-mouse", "constructor", "__proto__"]) {
      const res = await GET(new Request("http://x/api/mice/x/links"), {
        params: Promise.resolve({ slug }),
      });
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe(
        LINKS_NOT_FOUND_CACHE_CONTROL,
      );
      expect(JSON.stringify(await res.json())).not.toContain("officialUrl");
    }
  });

  it("keeps a 404 shorter than an answer", () => {
    const age = (v: string) => Number(/s-maxage=(\d+)/.exec(v)![1]);
    expect(age(LINKS_NOT_FOUND_CACHE_CONTROL)).toBeLessThan(
      age(LINKS_CACHE_CONTROL),
    );
  });
});
