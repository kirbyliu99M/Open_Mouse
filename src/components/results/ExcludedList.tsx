"use client";

import { useId, useState } from "react";
import type { FitResponse } from "@/lib/contracts/fit";
import { EXCLUDED_REASON_LABELS } from "./labels";

/**
 * Excluded mice in a collapsed "Not shown" group, each with its exclusion
 * reason spelled out in words.
 */
export function ExcludedList({
  response,
  onOpened,
}: {
  response: FitResponse;
  /** Called each time the list is opened (not closed). */
  onOpened?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const regionId = useId();

  if (response.excluded.length === 0) return null;

  return (
    <section className="results-excludedList">
      <button
        type="button"
        className="results-rankedList-toggle"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => {
          if (!open) onOpened?.();
          setOpen((v) => !v);
        }}
      >
        <span
          className="results-rankedList-chevron"
          data-open={open}
          aria-hidden="true"
        />
        Not shown ({response.excluded.length})
      </button>
      <div
        id={regionId}
        className="results-rankedList-region"
        data-open={open}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="results-rankedList-inner">
          <ul className="results-excludedList-items">
            {response.excluded.map((item) => (
              <li key={item.slug}>
                <span className="results-excludedList-name">
                  {item.brand} {item.model}
                </span>
                <span className="results-excludedList-reason">
                  {EXCLUDED_REASON_LABELS[item.reason]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
