import { ResultsRankClient } from "./ResultsRankClient";

export const dynamic = "force-dynamic";

/** `/results/[scanId]`: the top pick. The layout holds the scan. */
export default function ResultsPage() {
  return <ResultsRankClient />;
}
