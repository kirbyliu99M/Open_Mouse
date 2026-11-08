import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TesterClient } from "@/client/tester/TesterClient";
import { testerCopy } from "@/lib/tester/copy";
import { testerPageEnabled } from "@/server/tester/route-deps";

/**
 * The hidden data-tester page (candidate 未拍板; contract
 * src/lib/contracts/tester.ts). 404 unless the server env `TESTER_CODES` is
 * set, read per request (no build flag). Never indexed, not in the sitemap,
 * disallowed in robots.txt, and no public page links here.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: testerCopy.metaTitle,
  robots: { index: false, follow: false },
};

export default function ScanTesterPage() {
  if (!testerPageEnabled()) notFound();
  return <TesterClient />;
}
