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
import { uiLangAttribute, type UiLanguage } from "@/client/uiLanguage";
import { ViewerRegion } from "@/components/viewer/ViewerRegion";
import { AnalysisSlot } from "./AnalysisSlot";
import type { AnalysisState } from "./analysisState";
import { ConfidenceNote } from "./ConfidenceNote";
import { SubscoreBar } from "./SubscoreBar";
import { TargetDeltas } from "./TargetDeltas";

/**
 * "Details": a details element, closed by default. Inside: the 3D viewer (a
 * real scan only, and only once opened, so nothing is downloaded while it is
 * closed), the six sub-score bars, the gaps to the ideal size, the written
 * analysis (the main page only: `analysis` is undefined on a detail page) and
 * the confidence note.
 */
export function ResultsDetails({
  response,
  entry,
  language,
  showViewer,
  analysis,
  onViewerInteracted,
}: {
  response: FitResponse;
  entry: FitEntry;
  language: UiLanguage;
  showViewer: boolean;
  analysis?: { state: AnalysisState; onRetry?: () => void };
  onViewerInteracted?: () => void;
}) {
  // The viewer mounts the first time the section is opened and stays after, so
  // closing it again does not tear the model down.
  const [opened, setOpened] = useState(false);
  const copy = RESULTS_PAGE_COPY[language];
  const lang = uiLangAttribute(language);
  const { mouse } = entry;
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
        )
          setOpened(true);
      }}
    >
      <summary>
        <span className="results-disclosure-text" lang={lang}>
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

        <h3 className="results-details-scoresHeading" lang={lang}>
          {copy.scoresHeading}
        </h3>
        <div className="results-subscoreGrid">
          {SUBSCORES.map((key) => (
            <SubscoreBar key={key} subscore={key} data={entry.subscores[key]} />
          ))}
        </div>

        <TargetDeltas targets={response.targets} mouse={mouse} />

        {analysis && (
          <AnalysisSlot
            state={analysis.state}
            onRetry={analysis.onRetry}
            headingLevel={3}
          />
        )}

        {shapeUnrated ? (
          <p className="results-sizeNotice" lang={lang}>
            {copy.sizeNotice}
          </p>
        ) : (
          <ConfidenceNote confidence={entry.confidence} />
        )}
      </div>
    </details>
  );
}
