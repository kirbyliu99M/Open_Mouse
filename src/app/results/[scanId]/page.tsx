import type { Metadata } from "next";
import { ResultsPageClient } from "./ResultsPageClient";

export const metadata: Metadata = {
  title: "Your results — Open_Mouse",
  description: "Your ranked mouse recommendations and written analysis.",
  robots: { index: false, follow: false },
};

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = await params;
  return <ResultsPageClient scanId={scanId} />;
}
