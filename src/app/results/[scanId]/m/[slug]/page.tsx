import { ResultsRankClient } from "../../ResultsRankClient";

export const dynamic = "force-dynamic";

/**
 * `/results/[scanId]/m/[slug]`: the detail page of a rank 2 to 5 mouse, in the
 * same layout as the main page. Any other slug goes back to the main page
 * (decided on the client, which is where the ranking is). Metadata, including
 * `robots: noindex`, comes from the layout.
 */
export default async function ResultsDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ResultsRankClient slug={slug} />;
}
