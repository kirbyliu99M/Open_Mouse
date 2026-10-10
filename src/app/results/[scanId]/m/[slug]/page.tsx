import type { Metadata } from "next";
import { ResultsRankClient } from "../../ResultsRankClient";

export const dynamic = "force-dynamic";

/**
 * Its own title, so a detail page is not "Your results" like the main page
 * (candidate wording, 未拍板; Chinese since FILTER-1, as the page's own words are). No per-mouse data is read on the server. The
 * rest of the metadata, including `robots: noindex`, comes from the layout.
 */
export const metadata: Metadata = {
  title: "其他推薦",
};

/**
 * `/results/[scanId]/m/[slug]`: the detail page of the mouse in second to
 * fifth place of the list shown (the filtered list when the URL carries a
 * filter), in the same layout as the main page. Any other slug goes back to
 * the main page (decided on the client, which is where the ranking is).
 */
export default async function ResultsDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ResultsRankClient slug={slug} />;
}
