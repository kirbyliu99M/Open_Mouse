"use client";

import { useRef, type KeyboardEvent } from "react";
import type { Locale } from "@/lib/contracts/locale";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import {
  SHAPE_SEGMENTS,
  segmentForKey,
  tabStopOf,
  type ShapeSegment,
} from "@/lib/results/shapeToggle";
import "./filter.css";

/**
 * 「綜合｜左右對稱｜人體工學」 above the filter button (V3.2 U1, candidate). A
 * radio group: one segment is checked, Tab reaches the checked one (the first
 * when none is), the arrow keys, Home and End move and select, as radio
 * buttons do. Each segment is 44 px tall at least and shows a focus ring.
 *
 * The white pill under the checked segment slides there (220 ms ease-out, no
 * overshoot: CSS, transform only). With reduced motion it does not slide: it
 * is drawn again at its segment and fades in (120 ms). With none checked
 * (both shapes chosen in the filter panel) there is no pill.
 *
 * The toggle owns no state: `selected` comes from the page's filters (or the
 * segment just pressed, while the cards change over), `onSelect` hands the
 * choice back.
 */
export function ShapeToggle({
  language,
  selected,
  reducedMotion,
  onSelect,
}: {
  language: Locale;
  selected: ShapeSegment | null;
  reducedMotion: boolean;
  onSelect: (segment: ShapeSegment) => void;
}) {
  const copy = RESULTS_PAGE_COPY[language].shapeToggle;
  const buttons = useRef<Partial<Record<ShapeSegment, HTMLButtonElement>>>({});
  const tabStop = tabStopOf(selected);
  const index = selected === null ? 0 : SHAPE_SEGMENTS.indexOf(selected);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // From the segment that has the focus: with none checked that is the tab
    // stop, not `selected` (null).
    const from =
      SHAPE_SEGMENTS.find((s) => buttons.current[s] === e.target) ?? tabStop;
    const next = segmentForKey(from, e.key);
    if (next === null) return;
    e.preventDefault();
    buttons.current[next]?.focus();
    if (next !== selected) onSelect(next);
  };

  return (
    <div
      className="results-shapeToggle"
      role="radiogroup"
      aria-label={copy.label}
      data-motion={reducedMotion ? "reduced" : "full"}
      onKeyDown={onKeyDown}
    >
      {selected !== null && (
        <span
          // Reduced motion: a new pill per segment, which fades in where it is.
          key={reducedMotion ? selected : "pill"}
          className="results-shapeToggle-pill"
          aria-hidden="true"
          style={{ transform: `translateX(${index * 100}%)` }}
        />
      )}
      {SHAPE_SEGMENTS.map((segment) => {
        const checked = segment === selected;
        return (
          <button
            key={segment}
            ref={(el) => {
              if (el) buttons.current[segment] = el;
              else delete buttons.current[segment];
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={segment === tabStop ? 0 : -1}
            className="results-shapeToggle-option"
            onClick={() => {
              if (!checked) onSelect(segment);
            }}
          >
            {copy.segment[segment]}
          </button>
        );
      })}
    </div>
  );
}
