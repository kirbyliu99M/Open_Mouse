import { describe, expect, it } from "vitest";
import {
  analyse,
  buildFallbackOutput,
  buildPrompt,
  MAX_EXCLUDED_IN_PROMPT,
} from "../../src/server/analysis/analyse";
import { FakeTextModel } from "../../src/server/analysis/client";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import type { FitResponse } from "../../src/lib/contracts/fit";
import { makeFit, makeMeasurements } from "./analysis-fixtures";

/** `count` excluded mice, reasons alternating; model i is "Lefty<i>" with digits in its name. */
function manyExcluded(count: number): FitResponse["excluded"] {
  return Array.from({ length: count }, (_, i) => ({
    slug: `brand-lefty${i}`,
    brand: `Brand${i}`,
    model: `Lefty${i}`,
    reason: (i % 2 === 0 ? "wrong_hand" : "vertical_form_factor") as
      "wrong_hand" | "vertical_form_factor",
  }));
}

function inputWith(count: number) {
  return buildAnalysisInput(
    makeFit({ excluded: manyExcluded(count) }),
    makeMeasurements(),
    "en",
  );
}

const answerNaming = (name: string) =>
  JSON.stringify({
    headline: "It suits this hand.",
    whyTopPick: "The shape rests the palm naturally.",
    tradeoffs: [],
    whatToAvoid: [`${name} was left out of this comparison.`],
    caveats: ["This is an estimate from your hand measurements."],
  });

describe("excluded mice in the prompt", () => {
  it("caps the list and adds the totals per reason when it is cut short", () => {
    expect(MAX_EXCLUDED_IN_PROMPT).toBe(12);
    const data = buildPrompt(inputWith(100)).split("Data:\n")[1]!;
    const parsed = JSON.parse(data) as {
      excluded: { model: string }[];
      excludedCounts: Record<string, number>;
    };
    expect(parsed.excluded).toHaveLength(MAX_EXCLUDED_IN_PROMPT);
    expect(parsed.excluded[0]!.model).toBe("Lefty0");
    expect(parsed.excluded.at(-1)!.model).toBe("Lefty11");
    expect(parsed.excludedCounts).toEqual({
      "doesn't fit your handedness": 50,
      "vertical shape, excluded from this comparison": 50,
    });
    expect(data).not.toContain("Lefty12");
  });

  it("leaves a short list exactly as it was: no totals, nothing cut", () => {
    const data = buildPrompt(inputWith(MAX_EXCLUDED_IN_PROMPT)).split(
      "Data:\n",
    )[1]!;
    const parsed = JSON.parse(data) as {
      excluded: unknown[];
      excludedCounts?: unknown;
    };
    expect(parsed.excluded).toHaveLength(MAX_EXCLUDED_IN_PROMPT);
    expect("excludedCounts" in parsed).toBe(false);
  });

  it("uses the zh-TW wording for the totals", () => {
    const input = buildAnalysisInput(
      makeFit({ excluded: manyExcluded(30) }),
      makeMeasurements(),
      "zh-TW",
    );
    const data = JSON.parse(buildPrompt(input).split("資料：\n")[1]!) as {
      excludedCounts: Record<string, number>;
    };
    expect(data.excludedCounts).toEqual({
      是為另一隻手設計的: 15,
      "垂直形狀，不納入這次比較": 15,
    });
  });

  it("lets the model name a mouse it was shown, with digits in the name", async () => {
    const client = new FakeTextModel({
      answer: () => answerNaming("Brand11 Lefty11"),
    });
    const { source } = await analyse(inputWith(100), client);
    expect(source).toBe("model");
    expect(client.calls).toHaveLength(1);
  });

  it("does not let a mouse past the cut ride the name whitelist", async () => {
    const client = new FakeTextModel({
      answer: () => answerNaming("Brand12 Lefty12"),
    });
    const { source } = await analyse(inputWith(100), client);
    // Lefty12 was never sent: its digits are numbers the data does not hold.
    expect(source).toBe("fallback");
    expect(client.calls).toHaveLength(2);
  });

  it("lets the model repeat a total it was given", async () => {
    const client = new FakeTextModel({
      answer: () =>
        answerNaming("Brand0 Lefty0").replace(
          "was left out of this comparison.",
          "was left out, as were 50 others of the same kind.",
        ),
    });
    const { source } = await analyse(inputWith(100), client);
    expect(source).toBe("model");
  });

  it("keeps the fallback's whatToAvoid as before: the first two of the full list", () => {
    const input = inputWith(100);
    expect(buildFallbackOutput(input).whatToAvoid).toEqual([
      "Brand0 Lefty0: doesn't fit your handedness.",
      "Brand1 Lefty1: vertical shape, excluded from this comparison.",
    ]);
  });
});
