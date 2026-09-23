import type { FitResponse } from "@/lib/contracts/fit";
import { ConfidenceNote } from "./ConfidenceNote";
import { TargetDeltas } from "./TargetDeltas";
import { SUBSCORES } from "@/lib/contracts/fit";
import { SubscoreBar } from "./SubscoreBar";

/**
 * The top recommendation, per docs/design-guidelines.md ("Hierarchy: the top
 * recommendation and why it fits come first"): rank + brand, the model name,
 * the total fit score as the header's one number, all six sub-scores each
 * with a bar and the engine's reason in plain words, and — when any shape
 * sub-score is unrated — a single honest line saying the total leans on
 * size. That line and the generic confidence note both exist to say "we
 * don't fully know this mouse's shape yet", so only one renders per entry
 * (docs/design/journey-2026-09-23/04-results.png shows one statement, not
 * two).
 */
export function TopPick({ response }: { response: FitResponse }) {
  const entry = response.results[0];
  if (!entry) return null;

  const { mouse } = entry;
  const shapeUnrated = (["heightHump", "frontFlare", "thumb"] as const).some(
    (key) => entry.subscores[key].score === null,
  );

  return (
    <section className="results-topPick" aria-labelledby="results-topPick-name">
      <div className="results-topPick-header">
        <div className="results-topPick-headerText">
          <p className="results-topPick-eyebrow">
            #{entry.rank} &middot; {mouse.brand}
          </p>
          <h3 id="results-topPick-name" className="results-topPick-name">
            {mouse.model}
          </h3>
        </div>
        <div className="results-topPick-score results-tabularNum">
          <span className="results-topPick-scoreValue">{entry.total}</span>
          <span className="results-topPick-scoreLabel">fit score / 100</span>
        </div>
      </div>

      {!shapeUnrated && <ConfidenceNote confidence={entry.confidence} />}

      <h4 className="results-topPick-scoresHeading">How it scores</h4>
      <div className="results-subscoreGrid">
        {SUBSCORES.map((key) => (
          <SubscoreBar key={key} subscore={key} data={entry.subscores[key]} />
        ))}
      </div>
      {shapeUnrated && (
        <p className="results-sizeNotice">
          Some shape scores aren&apos;t rated yet for this mouse, so the fit
          score currently leans on its size.
        </p>
      )}

      <TargetDeltas targets={response.targets} mouse={mouse} />
    </section>
  );
}
