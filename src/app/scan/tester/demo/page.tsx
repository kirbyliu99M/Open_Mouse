import type { Metadata } from "next";
import { guardDevOnlyRoute } from "../../demo-guard";
import { TesterDemoClient } from "./TesterDemoClient";

export const metadata: Metadata = {
  title: "Tester page with a fixed scan result (mock data)",
  description:
    "Dev-only route: the tester page whose camera answers 'measured' for a real captured frame, for its e2e spec.",
  robots: { index: false, follow: false },
};

/** Dev only (`next dev`): production, previews and `next start` answer 404. */
export default function TesterDemoPage() {
  guardDevOnlyRoute();
  return <TesterDemoClient />;
}
