import type { Metadata } from "next";
import { HandExplicitDemoClient } from "./HandExplicitDemoClient";
import { guardDemoRouteFromProduction } from "../demo-guard";
import "../scan.css";

export const metadata: Metadata = {
  title: "Scan hand-picker fixture (mock data) — Open_Mouse",
  description:
    "Dev/demo route whose fake pipeline always detects a left hand, so an e2e test can check what the printed-sheet page tells the pipeline about an untouched hand picker — no real photo, no MediaPipe.",
  robots: { index: false, follow: false },
};

export default function ScanHandExplicitDemoPage() {
  guardDemoRouteFromProduction();
  return <HandExplicitDemoClient />;
}
