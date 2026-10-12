import type { Metadata } from "next";
import { guardDevOnlyRoute } from "../demo-guard";
import { ManualEntryDemoClient } from "./ManualEntryDemoClient";

export const metadata: Metadata = {
  title: "Manual entry fixture (mock data)",
  description:
    "Dev/demo route for typing hand length and width: the phone's pull-up sheet and the desktop panel, with no camera and no network.",
  robots: { index: false, follow: false },
};

export default function ManualEntryDemoPage() {
  guardDevOnlyRoute();
  return <ManualEntryDemoClient />;
}
