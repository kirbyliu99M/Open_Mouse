import type { Metadata } from "next";
import { guardDemoRouteFromProduction } from "../../demo-guard";
import { LengthFailureDemoClient } from "./LengthFailureDemoClient";

export const metadata: Metadata = {
  title: "Easy scan length failure (mock) — Open_Mouse",
  description:
    "Dev/demo route: the easy-scan camera with a pipeline that fails like a palm that does not fit the typed hand length.",
  robots: { index: false, follow: false },
};

export default function LengthFailureDemoPage() {
  guardDemoRouteFromProduction();
  return <LengthFailureDemoClient />;
}
