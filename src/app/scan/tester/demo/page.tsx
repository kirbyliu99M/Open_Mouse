import type { Metadata } from "next";
import { guardDevOnlyRoute } from "../../demo-guard";
import { TesterDemoClient } from "./TesterDemoClient";

export const metadata: Metadata = {
  title: "Tester page with a fixed scan result (mock data)",
  description:
    "Dev-only route: the tester page whose camera answers 'measured' for a real captured frame, for its e2e spec.",
  robots: { index: false, follow: false },
};

/**
 * Dev only (`next dev`): production, previews and `next start` answer 404.
 * `?open=1` shows open mode (no code step), like `TESTER_OPEN=1`.
 */
export default async function TesterDemoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  guardDevOnlyRoute();
  const { open } = await searchParams;
  return <TesterDemoClient open={open === "1"} />;
}
