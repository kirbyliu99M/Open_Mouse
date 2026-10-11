import type { Locale } from "@/lib/contracts/locale";
import type { PurchaseLink } from "@/lib/contracts/commerce";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { ExternalLinkIcon } from "./ExternalLinkIcon";

/**
 * Where to buy, for one mouse: a plain list of rows under the heading 「購買」
 * ("Buy"), shop name on the left and the external-link icon on the right. The
 * links come from the caller: `ResultsView` passes `useMouseLinks(slug)`'s
 * `purchaseLinks`, which the browser fetches from the static route
 * `/api/mice/<slug>/links` (built from `src/data/purchase-links.json`, which
 * another team maintains). This component never reads the file, so the file
 * stays out of the client bundle. With no links, or before they arrive, it
 * renders nothing: no box, no placeholder text. There is no
 * visible note; each link still says "opens in a new tab" to a screen reader
 * and keeps `rel="sponsored noopener"`. A long shop name wraps, it is never
 * cut. Links never touch rank or score.
 */
export function PurchaseSlot({
  links,
  language,
}: {
  links: readonly PurchaseLink[] | null | undefined;
  language: Locale;
}) {
  if (!links || links.length === 0) return null;
  const copy = RESULTS_PAGE_COPY[language];
  return (
    <section
      className="results-purchase"
      aria-labelledby="results-purchase-heading"
    >
      <h2 id="results-purchase-heading" className="results-purchase-heading">
        {copy.purchaseHeading}
      </h2>
      <ul className="results-purchase-links">
        {links.slice(0, 4).map((link) => (
          <li key={`${link.label}|${link.url}`}>
            <a href={link.url} rel="sponsored noopener" target="_blank">
              <span className="results-purchase-name">
                {link.label}
                <span className="results-visuallyHidden">
                  {" "}
                  {copy.opensInNewTab}
                </span>
              </span>
              <ExternalLinkIcon />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
