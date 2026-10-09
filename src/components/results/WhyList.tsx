import type { FitEntry } from "@/lib/contracts/fit";
import { en as enBands, zhTW as zhBands } from "@/lib/copy/fit-bands";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import { topReasons } from "./topReasons";

const BAND_COPY = { "zh-TW": zhBands, en: enBands } as const;

/**
 * "Why this mouse": the three strongest sub-scores of an entry, one line each,
 * using the reason sentences in `fit-bands.ts`. Deterministic: it never calls
 * the written analysis, so it is the same on every page. No numbers of its own.
 */
export function WhyList({
  entry,
  language,
}: {
  entry: FitEntry;
  language: UiLanguage;
}) {
  const reasons = topReasons(entry, 3);
  if (reasons.length === 0) return null;
  const copy = RESULTS_PAGE_COPY[language];
  const lang = uiLangAttribute(language);
  return (
    <section className="results-why" aria-labelledby="results-why-heading">
      <h2 id="results-why-heading" className="results-why-heading" lang={lang}>
        {copy.whyHeading}
      </h2>
      <ul className="results-why-list" lang={lang}>
        {reasons.map((reason) => (
          <li key={reason.subscore} data-subscore={reason.subscore}>
            <span className="results-why-label">
              {copy.subscoreShort[reason.subscore]}
            </span>
            <span className="results-why-text">
              {BAND_COPY[language].impact[reason.code]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
