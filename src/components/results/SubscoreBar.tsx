import type { FitEntry, Subscore } from "@/lib/contracts/fit";
import type { Locale } from "@/lib/contracts/locale";
import { resultsScreensCopy } from "@/lib/copy/results-screens";
import { formatScore } from "./format";
import { reasonText } from "./reasons";

/**
 * One of the six sub-score bars. A null score is never shown as 0 — it reads
 * "Not yet assessed" and the bar renders empty/unfilled rather than at 0%,
 * so it can't be mistaken for a genuinely bad score.
 */
export function SubscoreBar({
  subscore,
  data,
  language,
}: {
  subscore: Subscore;
  data: FitEntry["subscores"][Subscore];
  language: Locale;
}) {
  const { score, reason } = data;
  const copy = resultsScreensCopy(language);
  const label = copy.subscoreLabel[subscore];
  const sentence = reasonText(reason.code, reason.params, language);

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
