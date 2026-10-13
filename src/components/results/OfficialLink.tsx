import type { Locale } from "@/lib/contracts/locale";
import type { OfficialUrlKind } from "@/lib/contracts/commerce";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { ExternalLinkIcon } from "./ExternalLinkIcon";

/**
 * The maker's own page for one mouse (2026-10-11, candidate), a secondary text
 * link in the accent colour on the same row as the fit-band chip. `kind` picks
 * the words: `product` is this very model's page, `brand` is a lineup, series
 * or support page, which must not be called a product page. A URL with no kind
 * gets the weaker words (the brand page). No URL means nothing is rendered.
 * Shown only where one mouse has the big header block: the main page and the
 * detail pages, never on the small cards or in the other-mice list.
 */
export function OfficialLink({
  url,
  kind,
  brand,
  language,
  onClick,
}: {
  url: string | null | undefined;
  kind: OfficialUrlKind | null | undefined;
  brand: string;
  language: Locale;
  /** Analytics only; the link behaves as before. */
  onClick?: () => void;
}) {
  if (!url) return null;
  const copy = RESULTS_PAGE_COPY[language];
  const label =
    kind === "product"
      ? copy.officialProduct(brand)
      : copy.officialBrand(brand);
  return (
    <a
      className="results-official"
      href={url}
      rel="noopener"
      target="_blank"
      onClick={onClick}
    >
      <span className="results-official-text">{label}</span>
      <span className="results-visuallyHidden"> {copy.opensInNewTab}</span>
      <ExternalLinkIcon />
    </a>
  );
}
