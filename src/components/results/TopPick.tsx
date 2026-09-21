import type { FitResponse } from "@/lib/contracts/fit";
import { ConfidenceNote } from "./ConfidenceNote";
import { MouseHeader } from "./MouseHeader";
import { SUBSCORE_LABELS } from "./labels";
import { reasonText } from "./reasons";
import { TargetDeltas } from "./TargetDeltas";
import { topReasons } from "./topReasons";

/**
 * The top recommendation: model, size, total, confidence and the three
 * strongest reasons in plain language, per docs/design-guidelines.md
 * ("Hierarchy: the top recommendation and why it fits come first").
 */
export function TopPick({ response }: { response: FitResponse }) {
  const entry = response.results[0];
  if (!entry) return null;

  const reasons = topReasons(entry, 3);

  return (
    <section className="results-topPick" aria-labelledby="results-topPick-heading">
      <p className="results-eyebrow" id="results-topPick-heading">
        Best match
      </p>
      <MouseHeader entry={entry} />
      <ConfidenceNote confidence={entry.confidence} />

      <h4 className="results-topPick-whyHeading">Why it fits</h4>
      <ul className="results-topPick-reasons">
        {reasons.map((r) => (
          <li key={r.subscore}>
            <span className="results-topPick-reasonLabel">
              {SUBSCORE_LABELS[r.subscore]}
            </span>
            <span>{reasonText(r.code, r.params)}</span>
          </li>
        ))}
      </ul>

      <TargetDeltas targets={response.targets} mouse={entry.mouse} />
    </section>
  );
}
