import mouseMediaFile from "../../../../../data/mouse-media.json";
import purchaseLinksFile from "../../../../../data/purchase-links.json";
import {
  LINKS_CACHE_CONTROL,
  LINKS_NOT_FOUND_CACHE_CONTROL,
  linksForMouse,
} from "../../../../../lib/results/mouseLinks";
import { parseMouseMedia } from "../../../../../lib/results/mouseMedia";
import { parsePurchaseLinks } from "../../../../../lib/results/purchaseLinks";

/**
 * `GET /api/mice/<slug>/links`: the official link and up to four purchase
 * links of one mouse (`mouseLinksSchema`). One function answers every slug,
 * and the CDN keeps each answer for a day (`CACHE_CONTROL`), so a mouse costs
 * about one function run a day. It is deliberately NOT `generateStaticParams`
 * over every slug: Vercel then lists one ~7 MB function output per mouse, 408
 * of them, 2.7 GB of every deployment's 10 GB Deployment Storage (measured
 * 2026-10-15, Kirby: option A). An unknown slug is a 404 from the handler.
 * The two files are parsed once, when the module is loaded.
 */
export const dynamic = "force-dynamic";

const media = parseMouseMedia(mouseMediaFile);
const purchase = parsePurchaseLinks(purchaseLinksFile);

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  const links = linksForMouse(media, purchase, slug);
  if (!links) {
    return Response.json(
      { error: "Not found" },
      {
        status: 404,
        headers: { "Cache-Control": LINKS_NOT_FOUND_CACHE_CONTROL },
      },
    );
  }
  return Response.json(links, {
    headers: { "Cache-Control": LINKS_CACHE_CONTROL },
  });
}
