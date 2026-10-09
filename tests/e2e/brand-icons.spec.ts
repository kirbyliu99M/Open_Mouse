import { expect, test, type APIRequestContext } from "@playwright/test";
import { SITE_NAME, SITE_URL } from "../../src/lib/site";

/**
 * Brand icons and share-preview metadata (Palmate). The image routes come from
 * Next's file convention in src/app/, which puts a content hash in the href, so
 * the hrefs are read from the page rather than written here. The og and twitter
 * image URLs must be absolute. `npm run dev` swaps `metadataBase` for the local
 * origin, so only a production build (`next build` + `next start`) puts
 * SITE_URL in them: run with BRAND_EXPECT_SITE_URL=1 against one to check that.
 * The image request goes to the local server on the same path either way.
 */
const EXPECT_SITE_URL = process.env.BRAND_EXPECT_SITE_URL === "1";

/** An absolute URL, and under SITE_URL when checking a production build. */
function expectAbsolute(url: string | null, label: string) {
  expect(url, label).toBeTruthy();
  expect(url!, label).toMatch(/^https?:\/\/[^/]+\//);
  if (EXPECT_SITE_URL)
    expect(url!.startsWith(`${SITE_URL}/`), label).toBe(true);
}

/**
 * Reads one <meta> value by attribute name (`property` or `name`). Not scoped
 * to <head>: Next streams metadata for a browser user agent, so the tags can
 * land in <body> (crawlers get them in <head>).
 */
async function metaContent(
  page: import("@playwright/test").Page,
  attr: "property" | "name",
  key: string,
): Promise<string | null> {
  return page.locator(`meta[${attr}="${key}"]`).first().getAttribute("content");
}

async function expectImage(
  request: APIRequestContext,
  pathAndQuery: string,
  contentType: RegExp,
) {
  const res = await request.get(pathAndQuery);
  expect(res.status(), pathAndQuery).toBe(200);
  expect(res.headers()["content-type"], pathAndQuery).toMatch(contentType);
  expect((await res.body()).length, pathAndQuery).toBeGreaterThan(0);
}

function localPath(href: string): string {
  const url = new URL(href, SITE_URL);
  return url.pathname + url.search;
}

test.describe("brand icons and share preview", () => {
  test("head links the icons, and each one is served as an image", async ({
    page,
    request,
  }) => {
    await page.goto("/");

    const iconHrefs = await page
      .locator('head link[rel="icon"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("href") ?? ""));
    expect(iconHrefs.length).toBeGreaterThan(0);
    expect(iconHrefs.some((h) => h.includes("favicon.ico"))).toBe(true);
    for (const href of iconHrefs) {
      await expectImage(request, localPath(href), /^image\//);
    }

    const apple = await page
      .locator('head link[rel="apple-touch-icon"]')
      .first()
      .getAttribute("href");
    expect(apple).toBeTruthy();
    await expectImage(request, localPath(apple!), /^image\/png/);

    // The bare /favicon.ico path browsers request on their own.
    await expectImage(
      request,
      "/favicon.ico",
      /^image\/(x-icon|vnd\.microsoft\.icon)/,
    );
  });

  test("head carries the Open Graph and Twitter card tags", async ({
    page,
    request,
  }) => {
    await page.goto("/");

    expect(await metaContent(page, "property", "og:title")).toBe(SITE_NAME);
    expect(await metaContent(page, "property", "og:site_name")).toBe(SITE_NAME);
    expect(await metaContent(page, "property", "og:type")).toBe("website");

    const ogImage = await metaContent(page, "property", "og:image");
    expectAbsolute(ogImage, "og:image");
    await expectImage(request, localPath(ogImage!), /^image\/png/);

    expect(await metaContent(page, "name", "twitter:card")).toBe(
      "summary_large_image",
    );
    expect(await metaContent(page, "name", "twitter:title")).toBe(SITE_NAME);
    const twitterImage = await metaContent(page, "name", "twitter:image");
    expectAbsolute(twitterImage, "twitter:image");
    await expectImage(request, localPath(twitterImage!), /^image\/png/);
  });

  test("a link-preview crawler gets the share tags inside <head>", async ({
    request,
  }) => {
    const res = await request.get("/", {
      headers: { "user-agent": "facebookexternalhit/1.1" },
    });
    expect(res.status()).toBe(200);
    const html = await res.text();
    const head = html.slice(html.indexOf("<head"), html.indexOf("</head>"));
    expect(head).toContain(`property="og:title" content="${SITE_NAME}"`);
    expect(head).toMatch(
      /property="og:image" content="https?:\/\/[^"]+\/opengraph-image\.png/,
    );
    expect(head).toContain('name="twitter:card" content="summary_large_image"');
    if (EXPECT_SITE_URL) {
      expect(head).toContain(`content="${SITE_URL}/opengraph-image.png`);
    }
    expect(head).toContain('rel="apple-touch-icon"');
    expect(head).toContain('name="robots" content="noindex, nofollow"');
  });

  test("the site is still noindex", async ({ page }) => {
    await page.goto("/");
    const robots = await metaContent(page, "name", "robots");
    expect(robots).toContain("noindex");
  });
});
