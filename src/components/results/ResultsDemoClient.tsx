"use client";

import { useState } from "react";
import type { AnalysisOutput } from "@/lib/contracts/analysis";
import type { AnalysisState } from "./analysisState";
import {
  FIXTURES,
  FIXTURE_KEYS,
  FIXTURE_LABELS,
  type FixtureKey,
} from "./fixtures";
import { ResultsView } from "./ResultsView";

const MOCK_ANALYSIS: AnalysisOutput = {
  headline: "A close match for your palm grip",
  whyTopPick:
    "The top pick's length and grip width both land close to your ideal, and its front shape gives your fingertips somewhere to rest.",
  tradeoffs: [
    "It runs slightly heavier than your stated preference.",
    "The next-ranked mouse is lighter but sits further from your ideal length.",
  ],
  whatToAvoid: [
    "Mice with an aggressive back hump if you rest your palm flat.",
  ],
  caveats: [
    "This is a preview of the written analysis using placeholder text, not a live request.",
  ],
};

const ANALYSIS_DEMO_STATES: {
  key: string;
  label: string;
  state: AnalysisState;
}[] = [
  { key: "idle", label: "None", state: { status: "idle" } },
  { key: "loading", label: "Loading", state: { status: "loading" } },
  {
    key: "rateLimited",
    label: "Rate limited",
    state: { status: "rateLimited" },
  },
  { key: "error", label: "Error", state: { status: "error" } },
  {
    key: "ready",
    label: "Ready",
    state: {
      status: "ready",
      response: { output: MOCK_ANALYSIS, source: "model", cached: false },
    },
  },
  {
    key: "ready-fallback",
    label: "Ready (written from scores)",
    state: {
      status: "ready",
      response: { output: MOCK_ANALYSIS, source: "fallback", cached: false },
    },
  },
];

/**
 * Interactive shell for /results/demo: lets a reviewer switch between the
 * three fixtures and preview the optional written-analysis slot's states,
 * all with local state only (no network calls, no live analysis request).
 */
export function ResultsDemoClient() {
  const [fixtureKey, setFixtureKey] = useState<FixtureKey>(FIXTURE_KEYS[0]);
  const [analysisKey, setAnalysisKey] = useState("idle");

  const analysisState = ANALYSIS_DEMO_STATES.find((a) => a.key === analysisKey)
    ?.state ?? {
    status: "idle",
  };

  return (
    <main className="resultsMain">
      <div className="results-demoControls">
        <p className="eyebrow">Open_Mouse — dev/demo route</p>
        <h1>Results (mock data)</h1>
        <p className="note">
          Renders <code>ResultsView</code> against fixture{" "}
          <code>FitResponse</code> data. No network calls.
        </p>

        <fieldset>
          <legend>Fixture</legend>
          <div className="results-demoControls-buttons">
            {FIXTURE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={fixtureKey === key}
                onClick={() => setFixtureKey(key)}
              >
                {FIXTURE_LABELS[key]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Written analysis (preview)</legend>
          <div className="results-demoControls-buttons">
            {ANALYSIS_DEMO_STATES.map((a) => (
              <button
                key={a.key}
                type="button"
                aria-pressed={analysisKey === a.key}
                onClick={() => setAnalysisKey(a.key)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <ResultsView
        key={fixtureKey}
        response={FIXTURES[fixtureKey]}
        analysisState={analysisState}
        onRetryAnalysis={() => setAnalysisKey("loading")}
      />
    </main>
  );
}
