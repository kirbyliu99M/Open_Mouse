import type { Metadata } from "next";
import { guardDevOnlyRoute } from "../../demo-guard";
import { LengthFailureDemoClient } from "./LengthFailureDemoClient";

export const metadata: Metadata = {
  title: "Easy scan length failure (mock)",
  description:
    "Dev/demo route: the easy-scan camera with a pipeline that fails like a palm that does not fit the typed hand length.",
  robots: { index: false, follow: false },
};

export default function LengthFailureDemoPage() {
  guardDevOnlyRoute();
  return <LengthFailureDemoClient />;
}
