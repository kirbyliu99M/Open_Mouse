/**
 * Product gallery image discovery for Logitech's own storefronts.
 *
 * Both `logitechg.com` and `logitech.com` render a `variants` object into the
 * page (see `src/server/catalogue/logitech-specs.ts` for the sibling
 * `productDimensions` parser). Each variant embeds two ordered arrays:
 *
 *   productImages:[{path:"/content/dam/.../top-angle-white-gallery-1.png"},
 *                  {path:"/content/dam/.../video-thumb.png",video:"H1G0T1..."}]
 *   lifestyleImages:[{path:"/content/dam/.../lifestyle-gallery-2.png"}]
 *
 * We take the first variant's `productImages` only (the default colourway)
 * and drop entries that carry a `video` key (a video thumbnail, not a product
 * render). `lifestyleImages` is never read — marketing scenes are not the
 * rubric's "manufacturer's own product renders", and mixing them in would
 * feed a scene shot to the vision classifier as if it were a square-on render.
 * If a page has fewer product images than `limit`, fewer are returned; we
 * never pad with lifestyle images to make up the count.
 *
 * `path` is host-relative; the resolved image URL is served from
 * `resource.<host>` with a Cloudinary-style transform prefix, confirmed
 * against both storefronts on 2026-09-21.
 */

const RESOURCE_TRANSFORM = "c_fill,q_auto,f_auto,dpr_1.0/d_transparent.gif";

export function resourceHostFor(url: string): string {
  const host = new URL(url).hostname;
  if (host.endsWith("logitechg.com")) return "resource.logitechg.com";
  if (host.endsWith("logitech.com")) return "resource.logitech.com";
  throw new Error(`No resource host for ${host}`);
}

interface RawImage {
  path: string;
  isVideo: boolean;
}

/**
 * Returns the substring strictly inside the first top-level `[...]` found
 * starting at `openIdx` (which must point at `[`), tracking bracket depth so
 * a nested object never ends the scan early.
 */
function bracketedBody(html: string, openIdx: number): string | null {
  let depth = 0;
  for (let i = openIdx; i < html.length; i++) {
    if (html[i] === "[") depth++;
    else if (html[i] === "]") {
      depth--;
      if (depth === 0) return html.slice(openIdx + 1, i);
    }
  }
  return null;
}

const IMAGE_OBJECT = /\{path:"([^"]+)"([^}]*)\}/g;

function parseImageArray(html: string, key: string): RawImage[] {
  const marker = `${key}:[`;
  const start = html.indexOf(marker);
  if (start < 0) return [];
  const body = bracketedBody(html, start + key.length);
  if (body === null) return [];
  const out: RawImage[] = [];
  for (const m of body.matchAll(IMAGE_OBJECT)) {
    out.push({ path: m[1]!, isVideo: /video:"/.test(m[2]!) });
  }
  return out;
}

/**
 * Extracts up to `limit` product gallery image URLs from a Logitech product
 * page's embedded page data. Pure — no network. Only `productImages` is
 * read (never `lifestyleImages` — see the module doc); video thumbnails are
 * dropped, and only the first variant's array is read (mirrors
 * `parseLogitechDimensions` stopping at the first labelled group). Returns
 * fewer than `limit` URLs if the page has fewer product images — it never
 * pads the count with anything else.
 */
export function parseLogitechGalleryImages(
  html: string,
  url: string,
  limit = 8,
): string[] {
  const host = resourceHostFor(url);
  const product = parseImageArray(html, "productImages").filter(
    (i) => !i.isVideo,
  );
  const urls = product.map(
    (i) => `https://${host}/${RESOURCE_TRANSFORM}${i.path}`,
  );
  return Array.from(new Set(urls)).slice(0, limit);
}

/** Fetches one product page and parses its gallery image URLs. */
export async function discoverGalleryImages(
  url: string,
  limit = 8,
): Promise<{ images: string[]; status: number }> {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (Open_Mouse image discovery)" },
  });
  if (!res.ok) return { images: [], status: res.status };
  return {
    images: parseLogitechGalleryImages(await res.text(), url, limit),
    status: res.status,
  };
}

export interface FetchedImage {
  url: string;
  bytes: Uint8Array;
  mimeType: string;
}

/** Downloads image bytes for Gemini inline-data input. */
export async function fetchImageBytes(url: string): Promise<FetchedImage> {
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`Failed to fetch image ${url}: HTTP ${res.status}`);
  const mimeType = res.headers.get("content-type") ?? "image/png";
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { url, bytes, mimeType };
}
