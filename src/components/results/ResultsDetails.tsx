"use client";

import { useState } from "react";
import {
  SUBSCORES,
  type FitEntry,
  type FitResponse,
} from "@/lib/contracts/fit";
import { RESULTS_PAGE_COPY } from "@/lib/copy/results-page";
import {
  isPersonOpening,
  PRINT_OPENED_ATTRIBUTE,
} from "@/lib/results/disclosure";
import type { Locale } from "@/lib/contracts/locale";
import { ViewerRegion } from "@/components/viewer/ViewerRegion";
import { ConfidenceNote } from "./ConfidenceNote";
import { SubscoreBar } from "./SubscoreBar";
import { TargetDeltas } from "./TargetDeltas";

/**
 * "Details": a details element, closed by default. Inside: the 3D viewer (a
 * real scan only, and only once opened, so nothing is downloaded while it is
 * closed), the six sub-score bars, the gaps to the ideal size and the
 * confidence note. The written analysis is not here: the 「綜合」 page has it
 * under the large card (`FilteredAnalysisLine`, Kirby 2026-10-28).
 */
export function ResultsDetails({
  response,
  entry,
  language,
  showViewer,
  onViewerInteracted,
  onOpened,
}: {
  response: FitResponse;
  entry: FitEntry;
  language: Locale;
  showViewer: boolean;
  onViewerInteracted?: () => void;
  /** Called each time the person opens the section (analytics, and the feedback sheet's timing, V3.2 F11). */
  onOpened?: () => void;
}) {
  // The viewer mounts the first time the section is opened and stays after, so
  // closing it again does not tear the model down.
  const [opened, setOpened] = useState(false);
  const copy = RESULTS_PAGE_COPY[language];
  const { mouse } = entry;
  // Out of the catalogue's range no score is shown anywhere, the bars included.
  const scoresHidden = response.coverage?.lengthOutOfRange === true;
  const shapeUnrated = (["heightHump", "frontFlare", "thumb"] as const).some(
    (key) => entry.subscores[key].score === null,
  );

  return (
    <details
      className="results-disclosure results-details"
      onToggle={(event) => {
        const details = event.currentTarget;
        if (
          isPersonOpening({
            open: details.open,
            printOpened: details.hasAttribute(PRINT_OPENED_ATTRIBUTE),
          })
        ) {
          setOpened(true);
          onOpened?.();
        }
      }}
    >
      <summary>
        <span className="results-disclosure-text">
          <span className="results-disclosure-title">{copy.detailsTitle}</span>
          <span className="results-disclosure-hint">
            {showViewer ? copy.detailsHintWithViewer : copy.detailsHint}
          </span>
        </span>
        <span className="results-chevron" aria-hidden="true" />
      </summary>
      <div className="results-disclosure-body">
        {showViewer && opened && (
          <ViewerRegion
            scanId={response.scanId}
            mouseSlug={mouse.slug}
            mouseName={`${mouse.brand} ${mouse.model}`}
            onInteracted={onViewerInteracted}
          />
        )}

        <h3 className="results-details-scoresHeading">{copy.scoresHeading}</h3>
        <div className="results-subscoreGrid">
          {SUBSCORES.map((key) => (
            <SubscoreBar
              key={key}
              subscore={key}
              data={entry.subscores[key]}
              language={language}
              showScore={!scoresHidden}
            />
          ))}
        </div>

        <TargetDeltas
          targets={response.targets}
          mouse={mouse}
          language={language}
        />

        {shapeUnrated ? (
          <p className="results-sizeNotice">{copy.sizeNotice}</p>
        ) : (
          <ConfidenceNote confidence={entry.confidence} language={language} />
        )}
      </div>
    </details>
  );
}
