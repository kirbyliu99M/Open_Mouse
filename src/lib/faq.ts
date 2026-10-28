/**
 * The FAQ's questions and answers, in page order, with every number filled in
 * from TypeScript: the engine's coefficients and the listed catalogue (hard
 * rule 2). Pure; the page and its FAQPage JSON-LD both read this, so the
 * structured data is exactly the visible text.
 */
import type { FaqCopy } from "./copy/faq";
import type { FaqEntry } from "./structured-data";

export interface FaqFacts {
  lengthFactor: { palm: number; claw: number; fingertip: number };
  weights: {
    length: number;
    gripWidth: number;
    heightHump: number;
    frontFlare: number;
    thumb: number;
    weight: number;
  };
  /** Null when the catalogue could not be read. */
  catalogue: { mice: number; brands: number } | null;
}

/** 0.66 → "66%"; whole percentages only. */
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

export interface FaqGroup {
  heading: string;
  entries: FaqEntry[];
}

export function faqGroups(copy: FaqCopy, facts: FaqFacts): FaqGroup[] {
  const f = facts.lengthFactor;
  const w = facts.weights;
  const qa = (q: string, a: string): FaqEntry => ({ question: q, answer: a });
  return [
    {
      heading: copy.groups.basics,
      entries: [
        qa(copy.whatIs.q, copy.whatIs.a),
        qa(copy.needs.q, copy.needs.a),
        qa(
          copy.catalogue.q,
          facts.catalogue === null
            ? copy.catalogueNoCount
            : copy.catalogue.a(
                String(facts.catalogue.mice),
                String(facts.catalogue.brands),
              ),
        ),
      ],
    },
    {
      heading: copy.groups.measuring,
      entries: [
        qa(copy.whyA4.q, copy.whyA4.a),
        qa(copy.accuracy.q, copy.accuracy.a),
        qa(copy.howToMeasure.q, copy.howToMeasure.a),
        qa(copy.manual.q, copy.manual.a),
      ],
    },
    {
      heading: copy.groups.results,
      entries: [
        qa(copy.grips.q, copy.grips.a),
        qa(
          copy.gripChangesSize.q,
          copy.gripChangesSize.a(
            percent(f.palm),
            percent(f.claw),
            percent(f.fingertip),
          ),
        ),
        qa(
          copy.scoring.q,
          copy.scoring.a(
            percent(w.length),
            percent(w.gripWidth),
            percent(w.heightHump),
            percent(w.frontFlare),
            percent(w.thumb),
            percent(w.weight),
          ),
        ),
      ],
    },
    {
      heading: copy.groups.privacy,
      entries: [
        qa(copy.photos.q, copy.photos.a),
        qa(copy.account.q, copy.account.a),
        qa(copy.brands.q, copy.brands.a),
      ],
    },
  ];
}
