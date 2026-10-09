import type { UiLanguage } from "@/client/uiLanguage";
import { uiLangAttribute } from "@/client/uiLanguage";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { linksForSlug } from "@/lib/results/purchaseLinks";
import purchaseLinksFile from "@/data/purchase-links.json";

/**
 * Where to buy, for one mouse. Reads `src/data/purchase-links.json`, which
 * another team maintains. With no links for the slug, or a file that does not
 * match the contract, it renders nothing: no box, no placeholder text. When
 * it does render, one short line says these are partner links that open in a
 * new tab, and each link says so to a screen reader too. Links never touch
 * rank or score. `source` is for tests; the page uses the file.
 */
export function PurchaseSlot({
  slug,
  language,
  source = purchaseLinksFile,
}: {
  slug: string;
  language: UiLanguage;
  source?: unknown;
}) {
  const links = linksForSlug(source, slug);
  if (links.length === 0) return null;
  const copy = RESULTS_PAGE_COPY[language];
  return (
    <section
      className="results-purchase"
      aria-labelledby="results-purchase-heading"
    >
      <h2
        id="results-purchase-heading"
        className="results-purchase-heading"
        lang={uiLangAttribute(language)}
      >
        {copy.purchaseHeading}
      </h2>
      <p className="results-purchase-note" lang={uiLangAttribute(language)}>
        {copy.purchaseNote}
      </p>
      <ul className="results-purchase-links">
        {links.map((link) => (
          <li key={`${link.label}|${link.url}`}>
            <a href={link.url} rel="sponsored noopener" target="_blank">
              {link.label}
              <span
                className="results-visuallyHidden"
                lang={uiLangAttribute(language)}
              >
                {" "}
                {copy.opensInNewTab}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
