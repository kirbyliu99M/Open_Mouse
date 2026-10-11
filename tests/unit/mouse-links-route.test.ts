import { describe, expect, it } from "vitest";
import {
  GET,
  dynamic,
  dynamicParams,
  generateStaticParams,
} from "../../src/app/api/mice/[slug]/links/route";
import { mouseLinksSchema } from "../../src/lib/contracts/commerce";
import {
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

describe("the static route /api/mice/[slug]/links", () => {
  const params = generateStaticParams();
  const media = parseMouseMedia(mouseMediaFile);

  it("is static, and a slug it does not list is a 404", () => {
    expect(dynamic).toBe("force-static");
    expect(dynamicParams).toBe(false);
  });

  it("lists exactly the 406 slugs of the media file, each once", () => {
    expect(params).toHaveLength(406);
    expect(new Set(params.map((p) => p.slug)).size).toBe(406);
    expect(params.map((p) => p.slug).sort()).toEqual(Object.keys(media).sort());
  });

  it("answers every listed slug with a body that passes mouseLinksSchema and is that mouse's own", async () => {
    const purchase = parsePurchaseLinks(purchaseLinksFile);
    for (const { slug } of params) {
      const res = await GET(new Request("http://x/api/mice/x/links"), {
        params: Promise.resolve({ slug }),
      });
      expect(res.status, slug).toBe(200);
      const body = mouseLinksSchema.parse(await res.json());
      expect(body.officialUrl, slug).toBe(media[slug]!.officialUrl);
      expect(body.officialKind, slug).toBe(media[slug]!.officialKind);
      expect(body.purchaseLinks, slug).toEqual(purchase[slug] ?? []);
    }
  });

  it("answers an unknown slug with 404 and no links", async () => {
    for (const slug of ["ghost-mouse", "constructor", "__proto__"]) {
      const res = await GET(new Request("http://x/api/mice/x/links"), {
        params: Promise.resolve({ slug }),
      });
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain("officialUrl");
    }
  });
});
