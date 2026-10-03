import type { Metadata } from "next";
import { auth } from "../../../auth";
import { ResultsPageClient } from "./ResultsPageClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your results",
  description: "Your ranked mouse recommendations and written analysis.",
  robots: { index: false, follow: false },
};

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = await params;
  // Decided server-side, same as the (now-removed) beacon used to be
  // (issue #42) — never guessed from anything a client script could spoof.
  // Gates the anonymous-only "Delete this scan now" action below: a
  // signed-in user manages their scans on `/account` instead.
  const session = await auth();
  return <ResultsPageClient scanId={scanId} anonymous={!session?.user} />;
}
