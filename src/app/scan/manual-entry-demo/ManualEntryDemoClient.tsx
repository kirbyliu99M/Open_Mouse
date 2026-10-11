"use client";

import { useRef, useState } from "react";
import {
  ManualEntryHandle,
  ManualEntrySheet,
  type ManualEntryValues,
} from "@/components/scan/ManualEntrySheet";
import {
  buildManualEntrySubmission,
  EMPTY_DRAFT,
  type ManualEntryDraft,
} from "@/lib/scan/manualEntry";
import "./manual-entry-demo.css";

/**
 * Fixture for the typed-entry UI (candidate, 2026-10-12): the phone's pull-up
 * sheet over a stand-in for the camera screen, and the desktop panel, side by
 * side. Nothing is sent anywhere. 「確認」 only prints what the form
 * handed over, plus the payload `buildManualEntrySubmission` makes from it with
 * a fixed demo grip, so the e2e and Kirby can see both. The phone sheet's
 * draft is kept here (`onDraftChange` / `initialDraft`), the way the scan
 * screen will: closing the sheet by accident and opening it again brings back
 * what was typed, and a use clears it.
 */
export function ManualEntryDemoClient() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const handleRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<ManualEntryDraft>(EMPTY_DRAFT);
  const [used, setUsed] = useState<{
    via: "sheet" | "panel";
    values: ManualEntryValues;
  } | null>(null);

  function use(via: "sheet" | "panel", values: ManualEntryValues) {
    setUsed({ via, values });
    if (via === "sheet") {
      setSheetOpen(false);
      setDraft(EMPTY_DRAFT);
    }
  }

  const payload = used
    ? buildManualEntrySubmission({ ...used.values, grip: "claw" })
    : null;

  return (
    <main className="manualEntryDemo">
      <h1>Manual entry (mock data)</h1>

      <section aria-labelledby="demo-phone">
        <h2 id="demo-phone">Phone</h2>
        <div className="manualEntryDemo-phone">
          <div className="manualEntryDemo-camera" aria-hidden="true" />
          <ManualEntryHandle
            ref={handleRef}
            onOpen={() => setSheetOpen(true)}
          />
        </div>
        {sheetOpen && (
          <ManualEntrySheet
            presentation="sheet"
            returnFocusTo={handleRef}
            initialDraft={draft}
            onDraftChange={setDraft}
            onCancel={() => setSheetOpen(false)}
            onUse={(values) => use("sheet", values)}
          />
        )}
      </section>

      <section aria-labelledby="demo-desktop">
        <h2 id="demo-desktop">Desktop</h2>
        <ManualEntrySheet
          presentation="panel"
          onUse={(values) => use("panel", values)}
        />
      </section>

      <section aria-labelledby="demo-used">
        <h2 id="demo-used">Handed over</h2>
        <output data-testid="demo-used" aria-labelledby="demo-used">
          {used && payload
            ? `${used.via}: ${used.values.hand}, length ${used.values.handLengthMm} mm, width ${used.values.handWidthMm} mm, palm ${payload.measurements.palmLengthMm} mm (estimated), method ${payload.calibration.method}`
            : "nothing yet"}
        </output>
        <p data-testid="demo-draft">{`draft: ${JSON.stringify(draft)}`}</p>
      </section>
    </main>
  );
}
