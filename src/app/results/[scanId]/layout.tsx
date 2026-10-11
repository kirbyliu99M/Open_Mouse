import type { Metadata } from "next";
import type { ReactNode } from "react";
import { resultsScreensCopy } from "@/lib/copy/results-screens";
import { getLocale } from "@/server/i18n/getLocale";
import { auth } from "../../../auth";
import { ResultsScanProvider } from "./ResultsScanProvider";

export const dynamic = "force-dynamic";

/** Title and description follow the visitor's locale. */
export async function generateMetadata(): Promise<Metadata> {
  const copy = resultsScreensCopy(await getLocale());
  return {
    title: copy.titleMain,
    description: copy.metaDescription,
    robots: { index: false, follow: false },
  };
}

/**
 * One layout for the main results page and the detail pages under it, so the
 * fit request is made once per scan and moving between them does not refetch.
 * `anonymous` is decided here on the server (issue #42), never guessed on the
 * client: it gates the anonymous-only "Delete this scan now" action.
 */
export default async function ResultsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ scanId: string }>;
}) {
  const { scanId } = await params;
  const session = await auth();
  return (
    <ResultsScanProvider scanId={scanId} anonymous={!session?.user}>
      {children}
    </ResultsScanProvider>
  );
}
