import type { Metadata } from "next";
import { GripRaceDemoClient } from "./GripRaceDemoClient";
import { guardDevOnlyRoute } from "../demo-guard";
import "../scan.css";

export const metadata: Metadata = {
  title: "Scan grip-race fixture (mock data)",
  description:
    "Dev/demo route with a controllable-delay fake pipeline, so an e2e test can deterministically exercise changing grip during processing — no real photo, no MediaPipe.",
  robots: { index: false, follow: false },
};

export default function ScanGripRaceDemoPage() {
  guardDevOnlyRoute();
  return <GripRaceDemoClient />;
}
