"use client";

import type { UiLanguage } from "@/client/uiLanguage";
import { FIXTURES } from "@/components/results/fixtures";
import { ShareCardButton } from "@/components/results/share/ShareCardButton";
import type { FitResponse } from "@/lib/contracts/fit";

export function ShareCardDemoClient({
  lang,
  withHandType,
  withPhoto,
  longName,
}: {
  lang: UiLanguage;
  withHandType: boolean;
  withPhoto: boolean;
  longName: boolean;
}) {
  const base = FIXTURES["high-confidence"];
  const [first, ...rest] = base.results;
  const fit: FitResponse = {
    ...base,
    ...(withHandType
      ? { handType: { size: "medium", grip: "claw", width: "wide" } }
      : {}),
    results: first
      ? [
          {
            ...first,
            mouse: {
              ...first.mouse,
              model: longName
                ? "Pro X Superlight 2 DEX Lightspeed Wireless Gaming Mouse Special Edition"
                : first.mouse.model,
              imageUrl: withPhoto ? "/images/sketches/g-pro-sketch.svg" : null,
            },
          },
          ...rest,
        ]
      : [],
  };
  return (
    <main className="share-demo">
      <h1>Share card (mock data)</h1>
      <p>
        <ShareCardButton fit={fit} lang={lang} variant="link" />
      </p>
      <ShareCardButton fit={fit} lang={lang} variant="primary" />
    </main>
  );
}
