import type { Metadata } from "next";
import { TopBar } from "@/components/nav/TopBar";
import { CheckClient } from "./CheckClient";
import "../learn.css";

export const metadata: Metadata = {
  title: "Check photos — Open Mouse",
  robots: { index: false, follow: false },
};

export default function LearnCheckPage() {
  return (
    <main className="learn">
      <TopBar
        backHref="/learn"
        backLabel="Learning kit"
        stepLabel="Check photos"
      />
      <h1>Check photos</h1>
      <p className="learn-lead">
        Choose the photos from a session. Each one is checked on this device;
        nothing is uploaded. Keep the camera&apos;s file names: they set the
        capture order.
      </p>
      <CheckClient />
    </main>
  );
}
