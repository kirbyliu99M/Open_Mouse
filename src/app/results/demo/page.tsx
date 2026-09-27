import type { Metadata } from "next";
import { ResultsDemoClient } from "@/components/results/ResultsDemoClient";

export const metadata: Metadata = {
  title: "Results (mock data) — Open_Mouse",
  description:
    "Dev/demo route rendering the results UI against fixture data. No fetching, no network calls.",
  robots: { index: false, follow: false },
};

export default async function ResultsDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ presentation?: string }>;
}) {
  const { presentation } = await searchParams;
  return <ResultsDemoClient presentation={presentation === "1"} />;
}
