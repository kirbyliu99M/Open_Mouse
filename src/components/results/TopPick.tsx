import type { FitResponse } from "@/lib/contracts/fit";
import { ConfidenceNote } from "./ConfidenceNote";
import { MouseHeader } from "./MouseHeader";
import { SUBSCORE_LABELS } from "./labels";
import { reasonText } from "./reasons";
import { TargetDeltas } from "./TargetDeltas";
import { topReasons } from "./topReasons";
import { SUBSCORES } from "@/lib/contracts/fit";
import { SubscoreBar } from "./SubscoreBar";

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
    <section
      className="results-topPick"
      aria-labelledby="results-topPick-heading"
    >
      <p className="results-eyebrow" id="results-topPick-heading">
        Best match
      </p>
      <MouseHeader entry={entry} />
      <ConfidenceNote confidence={entry.confidence} />

      <h4 className="results-topPick-scoresHeading">How it scores</h4>
      <div className="results-subscoreGrid">
        {SUBSCORES.map((key) => (
          <SubscoreBar key={key} subscore={key} data={entry.subscores[key]} />
        ))}
      </div>
      {(["heightHump", "frontFlare", "thumb"] as const).some(
        (key) => entry.subscores[key].score === null,
      ) && (
        <p className="results-sizeNotice">
          Some shape scores aren&apos;t rated yet for this mouse, so the fit
          score currently leans on its size.
        </p>
      )}

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
