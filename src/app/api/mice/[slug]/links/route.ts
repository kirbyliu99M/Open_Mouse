import mouseMediaFile from "../../../../../data/mouse-media.json";
import purchaseLinksFile from "../../../../../data/purchase-links.json";
import { linksForMouse } from "../../../../../lib/results/mouseLinks";
import { parseMouseMedia } from "../../../../../lib/results/mouseMedia";
import { parsePurchaseLinks } from "../../../../../lib/results/purchaseLinks";

/**
 * `GET /api/mice/<slug>/links`: the official link and up to four purchase
 * links of one mouse (`mouseLinksSchema`). Static: `generateStaticParams`
 * lists every slug in `src/data/mouse-media.json`, so the build writes one
 * small JSON file per mouse and the CDN answers it, with no function run (the
 * results response stays small). `dynamicParams = false` makes any other slug
 * a 404 from the platform. The two files are parsed once, when the module is
 * loaded.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

const media = parseMouseMedia(mouseMediaFile);
const purchase = parsePurchaseLinks(purchaseLinksFile);

export function generateStaticParams(): { slug: string }[] {
  return Object.keys(media).map((slug) => ({ slug }));
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  const links = linksForMouse(media, purchase, slug);
  if (!links) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(links);
}
