/**
 * Picks the "three strongest reasons" for a fit entry: the highest-scoring
 * non-null sub-scores, ties broken by weight. Pure and unit-tested — this is
 * the one piece of selection logic on the results critical path, everything
 * else in this directory is formatting.
 */
import { SUBSCORES, type FitEntry, type Subscore } from "@/lib/contracts/fit";

export type TopReason = {
  subscore: Subscore;
  score: number;
  code: FitEntry["subscores"][Subscore]["reason"]["code"];
  params: FitEntry["subscores"][Subscore]["reason"]["params"];
};

export function topReasons(entry: FitEntry, count = 3): TopReason[] {
  const scored: TopReason[] = SUBSCORES.filter(
    (key) => entry.subscores[key].score !== null,
  ).map((key) => {
    const sub = entry.subscores[key];
    return {
      subscore: key,
      score: sub.score as number,
      code: sub.reason.code,
      params: sub.reason.params,
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return entry.subscores[b.subscore].weight - entry.subscores[a.subscore].weight;
  });

  return scored.slice(0, count);
}
