"use client";

import type { UiLanguage } from "@/client/uiLanguage";
import { FIXTURES } from "@/components/results/fixtures";
import type { QrStyle } from "@/components/results/share/qrStyle";
import { ShareCardButton } from "@/components/results/share/ShareCardButton";
import type { FitResponse } from "@/lib/contracts/fit";

export function ShareCardDemoClient({
  lang,
  withHandType,
  withPhoto,
  longName,
  preset,
  qrSize,
  qrStyle,
}: {
  lang: UiLanguage;
  withHandType: boolean;
  withPhoto: boolean;
  longName: boolean;
  preset: "rog" | null;
  qrSize?: number;
  qrStyle?: QrStyle;
}) {
  const base = FIXTURES["high-confidence"];
  const [first, ...rest] = base.results;
  const fit: FitResponse = {
    ...base,
    ...(withHandType
      ? {
          handType: {
            size: "medium",
            grip: preset === "rog" ? "palm" : "claw",
            width: preset === "rog" ? "slim" : "wide",
          },
        }
      : {}),
    results: first
      ? [
          {
            ...first,
            ...(preset === "rog" ? { total: 92 } : {}),
            mouse: {
              ...first.mouse,
              ...(preset === "rog"
                ? {
                    slug: "asus-rog-strix-impact-iii",
                    brand: "ASUS",
                  }
                : {}),
              model: longName
                ? "Pro X Superlight 2 DEX Lightspeed Wireless Gaming Mouse Special Edition"
                : preset === "rog"
                  ? "ROG Strix Impact III"
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
        <ShareCardButton
          fit={fit}
          lang={lang}
          variant="link"
          qrSize={qrSize}
          qrStyle={qrStyle}
        />
      </p>
      <ShareCardButton
        fit={fit}
        lang={lang}
        variant="primary"
        qrSize={qrSize}
        qrStyle={qrStyle}
      />
    </main>
  );
}
