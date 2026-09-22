import type { Metadata } from "next";
import ScanClient from "./ScanClient";
import "./scan.css";

export const metadata: Metadata = {
  title: "Scan your hand — Open_Mouse",
  description:
    "Photograph your hand on the calibration sheet to measure it — entirely on this device.",
};

export default function ScanPage() {
  return <ScanClient />;
}
