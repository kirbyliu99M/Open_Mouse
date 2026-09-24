import type { FitEntry, Subscore } from "@/lib/contracts/fit";
import { formatScore } from "./format";
import { SUBSCORE_LABELS } from "./labels";
import { reasonText } from "./reasons";

/**
 * One of the six sub-score bars. A null score is never shown as 0 — it reads
 * "Not yet assessed" and the bar renders empty/unfilled rather than at 0%,
 * so it can't be mistaken for a genuinely bad score.
 */
export function SubscoreBar({
  subscore,
  data,
}: {
  subscore: Subscore;
  data: FitEntry["subscores"][Subscore];
}) {
  const { score, reason } = data;
  const label = SUBSCORE_LABELS[subscore];
  const sentence = reasonText(reason.code, reason.params);

  return (
    <div className="results-subscoreBar" data-assessed={score !== null}>
      <div className="results-subscoreBar-head">
        <span className="results-subscoreBar-label">{label}</span>
        <span className="results-subscoreBar-value">
          {score === null ? "—" : formatScore(score)}
        </span>
      </div>
      <div
        className="results-subscoreBar-track"
        role="img"
        aria-label={`${label}: ${score === null ? sentence : formatScore(score)}`}
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
