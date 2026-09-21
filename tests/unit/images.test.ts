import { describe, expect, it } from "vitest";
import {
  parseLogitechGalleryImages,
  resourceHostFor,
} from "../../src/server/classification/images";

const G_URL =
  "https://www.logitechg.com/en-us/shop/p/pro-x2-superlight-wireless-mouse";
const CONSUMER_URL = "https://www.logitech.com/en-us/shop/p/mx-master-3s";

/** Mirrors the real `variants` object literal embedded in Logitech pages. */
function page(variantBody: string): string {
  return `<script>x={variants:{"910-006636":{name:"Test",${variantBody}},"910-999999":{name:"Other colour",productImages:[{path:"/other-colour.png"}],lifestyleImages:[]}}}</script>`;
}

describe("parseLogitechGalleryImages", () => {
  it("reads the first variant's productImages and prefixes the resource host", () => {
    const html = page(
      'productImages:[{path:"/content/dam/gaming/en/products/x/top-angle-white-gallery-1.png"},' +
        '{path:"/content/dam/gaming/en/products/x/profile-left-angle-white-gallery-4.png"}],' +
        'lifestyleImages:[{path:"/content/dam/gaming/en/products/x/lifestyle-gallery-2.png"}]',
    );
    expect(parseLogitechGalleryImages(html, G_URL)).toEqual([
      "https://resource.logitechg.com/c_fill,q_auto,f_auto,dpr_1.0/d_transparent.gif/content/dam/gaming/en/products/x/top-angle-white-gallery-1.png",
      "https://resource.logitechg.com/c_fill,q_auto,f_auto,dpr_1.0/d_transparent.gif/content/dam/gaming/en/products/x/profile-left-angle-white-gallery-4.png",
      "https://resource.logitechg.com/c_fill,q_auto,f_auto,dpr_1.0/d_transparent.gif/content/dam/gaming/en/products/x/lifestyle-gallery-2.png",
    ]);
  });

  it("prefers product shots over lifestyle images when capped by limit", () => {
    const html = page(
      'productImages:[{path:"/p1.png"},{path:"/p2.png"}],' +
        'lifestyleImages:[{path:"/l1.png"},{path:"/l2.png"}]',
    );
    expect(parseLogitechGalleryImages(html, G_URL, 3)).toEqual([
      "https://resource.logitechg.com/c_fill,q_auto,f_auto,dpr_1.0/d_transparent.gif/p1.png",
      "https://resource.logitechg.com/c_fill,q_auto,f_auto,dpr_1.0/d_transparent.gif/p2.png",
      "https://resource.logitechg.com/c_fill,q_auto,f_auto,dpr_1.0/d_transparent.gif/l1.png",
    ]);
  });

  it("drops video thumbnails", () => {
    const html = page(
      'productImages:[{path:"/p1.png"},{path:"/video-thumb.png",video:"aBcD123"}],' +
        "lifestyleImages:[]",
    );
    expect(parseLogitechGalleryImages(html, G_URL)).toEqual([
      "https://resource.logitechg.com/c_fill,q_auto,f_auto,dpr_1.0/d_transparent.gif/p1.png",
    ]);
  });

  it("caps at 8 images by default", () => {
    const paths = Array.from({ length: 12 }, (_, i) => `{path:"/p${i}.png"}`);
    const html = page(`productImages:[${paths.join(",")}],lifestyleImages:[]`);
    expect(parseLogitechGalleryImages(html, G_URL)).toHaveLength(8);
  });

  it("reads only the first variant, ignoring the second colour's images", () => {
    const html = page('productImages:[{path:"/p1.png"}],lifestyleImages:[]');
    const urls = parseLogitechGalleryImages(html, G_URL);
    expect(urls.some((u) => u.includes("other-colour"))).toBe(false);
  });

  it("resolves the consumer-site resource host", () => {
    const html = page('productImages:[{path:"/p1.png"}],lifestyleImages:[]');
    expect(parseLogitechGalleryImages(html, CONSUMER_URL)).toEqual([
      "https://resource.logitech.com/c_fill,q_auto,f_auto,dpr_1.0/d_transparent.gif/p1.png",
    ]);
  });

  it("returns no images when the page has no variants block", () => {
    expect(parseLogitechGalleryImages("<p>nothing here</p>", G_URL)).toEqual(
      [],
    );
  });
});

describe("resourceHostFor", () => {
  it("rejects hosts with no known resource domain", () => {
    expect(() => resourceHostFor("https://example.com/mouse")).toThrow(
      "No resource host",
    );
  });
});
