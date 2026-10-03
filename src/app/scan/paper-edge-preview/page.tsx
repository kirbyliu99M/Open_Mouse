import type { Metadata } from "next";
import ScanClient from "../ScanClient";
import { guardDemoRouteFromProduction } from "../demo-guard";
import "../scan.css";

export const metadata: Metadata = {
  title: "Scan (paper-edge preview)",
  description:
    "Dev/screenshot route previewing /scan's page copy for the future blank-paper calibration path (no printed sheet, no card) — the real pipeline is unchanged until the paper-edge detector lands. See src/client/camera/quad-source.ts.",
  robots: { index: false, follow: false },
};

/**
 * Kirby, 2026-09-25: the camera path's page copy (heading, subtitle, TopBar,
 * "Print it" link) is gated behind `calibrationMode` so the currently-
 * shipped printed-sheet flow keeps its correct copy until the paper-edge
 * pipeline lands — this route is the one place that previews the future
 * copy, for the camera e2e/screenshot suite (tests/e2e/camera-*.spec.ts).
 */
export default function ScanPaperEdgePreviewPage() {
  guardDemoRouteFromProduction();
  return <ScanClient calibrationMode="paper-edge" />;
}
