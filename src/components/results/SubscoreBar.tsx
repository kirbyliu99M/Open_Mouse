import type { FitEntry, Subscore } from "@/lib/contracts/fit";
import type { Locale } from "@/lib/contracts/locale";
import { resultsScreensCopy } from "@/lib/copy/results-screens";
import { formatScore } from "./format";
import { reasonText } from "./reasons";

/**
 * One of the six sub-score bars. A null score is never shown as 0 — it reads
 * "Not yet assessed" and the bar renders empty/unfilled rather than at 0%,
 * so it can't be mistaken for a genuinely bad score.
 *
 * `showScore` false (the hand is outside the catalogue's range, so no score is
 * shown anywhere): the label and the reason sentence stay, and the number, the
 * bar and the accessible score text are not rendered at all.
 */
export function SubscoreBar({
  subscore,
  data,
  language,
  showScore = true,
}: {
  subscore: Subscore;
  data: FitEntry["subscores"][Subscore];
  language: Locale;
  showScore?: boolean;
}) {
  const { score, reason } = data;
  const copy = resultsScreensCopy(language);
  const label = copy.subscoreLabel[subscore];
  const sentence = reasonText(reason.code, reason.params, language);

  if (!showScore) {
    return (
      <div className="results-subscoreBar" data-scored="false">
        <div className="results-subscoreBar-head">
          <span className="results-subscoreBar-label">{label}</span>
        </div>
        <p className="results-subscoreBar-reason">{sentence}</p>
      </div>
    );
  }

  return (
    <div className="results-subscoreBar" data-assessed={score !== null}>
      <div className="results-subscoreBar-head">
        <span className="results-subscoreBar-label">{label}</span>
        <span className="results-subscoreBar-value">
          {score === null ? copy.noScoreMark : formatScore(score, language)}
        </span>
      </div>
      <div
        className="results-subscoreBar-track"
        role="img"
        aria-label={`${label}: ${score === null ? sentence : formatScore(score, language)}`}
      >
        {score !== null && (
          <div
            className="results-subscoreBar-fill"
            style={{ width: `${score}%` }}
          />
        )}
      </div>
      <p className="results-subscoreBar-reason">{sentence}</p>
    </div>
  );
}
