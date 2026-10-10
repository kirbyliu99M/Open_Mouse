"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ResultsView } from "@/components/results/ResultsView";
import { RESULTS_VIEWER_ENABLED } from "@/lib/results/features";
import { mainResultsPath, resolveDetailTarget } from "@/lib/results/rankRoutes";
import { useResultsScan } from "./ResultsScanProvider";

/**
 * One results page. With no `slug` it is the main page (rank 1) and it asks for
 * the written analysis; with a `slug` it is that mouse's detail page, which
 * shows only the deterministic reasons. A slug that is not rank 2 to 5 sends
 * the person back to the main page.
 */
export function ResultsRankClient({ slug }: { slug?: string }) {
  const scan = useResultsScan();
  const router = useRouter();
  const { response, scanId } = scan;

  const target =
    slug === undefined ? null : resolveDetailTarget(response.results, slug);
  const redirect = target?.kind === "main";
  const isMain = slug === undefined;

  useEffect(() => {
    if (redirect) router.replace(mainResultsPath(scanId));
  }, [redirect, router, scanId]);

  const { requestAnalysis } = scan;
  // The rule (main page only, once per scan) is `shouldRequestAnalysis`.
  useEffect(() => {
    requestAnalysis(isMain);
  }, [isMain, requestAnalysis]);

  if (redirect) return null;

  return (
    <ResultsView
      key={target?.kind === "detail" ? target.entry.mouse.slug : "main"}
      response={response}
      rank={target?.kind === "detail" ? target.entry.rank : 1}
      language={scan.language}
      scanId={scanId}
      enteredLengthMm={scan.enteredLength}
      showViewer={RESULTS_VIEWER_ENABLED}
      analysisState={scan.analysisState}
      onRetryAnalysis={scan.retryAnalysis}
      analytics={scan.analytics}
    />
  );
}
