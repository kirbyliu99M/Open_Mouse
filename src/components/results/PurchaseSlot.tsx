"use client";

import { useEffect } from "react";
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
  onShown,
  onLinkClick,
}: {
  links: readonly PurchaseLink[] | null | undefined;
  language: Locale;
  /** Called when the list is on the page, with how many links it draws (analytics only). */
  onShown?: (count: number) => void;
  /** Called on a click on a link, with the link and its 0-based index (analytics only). */
  onLinkClick?: (link: PurchaseLink, index: number) => void;
}) {
  const shown = links ? Math.min(4, links.length) : 0;
  useEffect(() => {
    if (shown > 0) onShown?.(shown);
    // The caller keeps its own once-per-mouse guard; only a new count re-asks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
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
        {links.slice(0, 4).map((link, index) => (
          <li key={`${link.label}|${link.url}`}>
            <a
              href={link.url}
              rel="sponsored noopener"
              target="_blank"
              onClick={onLinkClick ? () => onLinkClick(link, index) : undefined}
            >
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
