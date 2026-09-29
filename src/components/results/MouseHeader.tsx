import { SIZE_LABELS } from "@/lib/contracts/descriptors";
import type { FitEntry } from "@/lib/contracts/fit";
import { formatConfidence, formatWeight } from "./format";

/** Brand, model, size, total score and confidence for one ranked mouse. */
export function MouseHeader({ entry }: { entry: FitEntry }) {
  const { mouse } = entry;
  return (
    <div className="results-mouseHeader">
      <div className="results-mouseHeader-name">
        <span className="results-mouseHeader-rank">#{entry.rank}</span>
        <h3>
          {mouse.brand} {mouse.model}
        </h3>
      </div>
      <dl className="results-mouseHeader-stats">
        <div>
          <dt>Size</dt>
          <dd>{SIZE_LABELS[mouse.size]}</dd>
        </div>
        <div>
          <dt>Weight</dt>
          <dd className="results-tabularNum">{formatWeight(mouse.weightG)}</dd>
        </div>
        <div>
          <dt>Fit score</dt>
          <dd className="results-tabularNum results-mouseHeader-total">
            {entry.total}
            <span aria-hidden="true"> / 100</span>
          </dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd className="results-tabularNum">
            {formatConfidence(entry.confidence)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
