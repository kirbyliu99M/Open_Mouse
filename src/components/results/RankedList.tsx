"use client";

import { useId, useState } from "react";
import { SUBSCORES, type FitResponse } from "@/lib/contracts/fit";
import { ConfidenceNote } from "./ConfidenceNote";
import { MouseHeader } from "./MouseHeader";
import { SubscoreBar } from "./SubscoreBar";
import { TargetDeltas } from "./TargetDeltas";

/**
 * The remaining ranked mice, one level deeper behind a disclosure. A native
 * <button> drives it (keyboard-operable for free), `aria-expanded` tracks
 * state, and the region stays in the DOM with `inert` + `aria-hidden` while
 * collapsed so the CSS grid-rows slide (results.css) can animate it open
 * without a mount/unmount flash. `prefers-reduced-motion` swaps the slide
 * for a cross-fade in CSS alone.
 */
export function RankedList({ response }: { response: FitResponse }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const rest = response.results.slice(1);

  if (rest.length === 0) return null;

  return (
    <section className="results-rankedList">
      <button
        type="button"
        className="results-rankedList-toggle"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="results-rankedList-chevron"
          data-open={open}
          aria-hidden="true"
        />
        {open ? "Hide" : "Show"} the other {rest.length} ranked{" "}
        {rest.length === 1 ? "mouse" : "mice"}
      </button>

      <div
        id={regionId}
        className="results-rankedList-region"
        data-open={open}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="results-rankedList-inner">
          <ol className="results-rankedList-items">
            {rest.map((entry) => (
              <li key={entry.mouse.slug} className="results-rankedList-item">
                <MouseHeader entry={entry} />
                <ConfidenceNote confidence={entry.confidence} />
                <div className="results-subscoreGrid">
                  {SUBSCORES.map((key) => (
                    <SubscoreBar
                      key={key}
                      subscore={key}
                      data={entry.subscores[key]}
                    />
                  ))}
                </div>
                <TargetDeltas targets={response.targets} mouse={entry.mouse} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
