/**
 * A model that writes the real name of a mouse it was given ("G Pro X
 * Superlight 2") must not lose its answer to the no-new-numerals rule just
 * because the name ends in a bare digit. Any other stray number still does.
 */
import { describe, expect, it } from "vitest";
import { analyse } from "../../src/server/analysis/analyse";
import { FakeTextModel } from "../../src/server/analysis/client";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { collectNumbers } from "../../src/server/analysis/numerals";
import { makeEntry, makeFit, makeMeasurements } from "./analysis-fixtures";

function inputFor(locale: "en" | "zh-TW") {
  const base = makeEntry();
  // The fixture's flare delta is 2, which would put a 2 in the input and hide
  // the very case under test; use 3.
  const entry = {
    ...base,
    subscores: {
      ...base.subscores,
      frontFlare: {
        ...base.subscores.frontFlare,
        reason: {
          ...base.subscores.frontFlare.reason,
          params: { deltaMm: 3 },
        },
      },
    },
  };
  return buildAnalysisInput(
    makeFit({ results: [entry] }),
    makeMeasurements(),
    locale,
  );
}

const answer = (headline: string) =>
  JSON.stringify({
    headline,
    whyTopPick: "It is the closest in the catalogue.",
    tradeoffs: [],
    whatToAvoid: [],
    caveats: [],
  });

describe("analyse(): a real model name with a digit in it", () => {
  it.each([
    ["en", "Logitech G Pro X Superlight 2 is the top match for your hand."],
    ["en", "The G Pro X Superlight 2 fits your hand."],
    ["zh-TW", "Logitech G Pro X Superlight 2 是最符合你手型的選擇。"],
  ] as const)("keeps the model's answer (%s)", async (locale, headline) => {
    const input = inputFor(locale);
    expect(collectNumbers(input).has(2)).toBe(false);
    const client = new FakeTextModel({ answer: () => answer(headline) });
    const result = await analyse(input, client);
    expect(result.source).toBe("model");
    expect(client.calls).toHaveLength(1);
    expect(result.output.headline).toBe(headline);
  });

  it.each([
    ["en", "The G Pro X Superlight 2 leaves 2 mm of clearance."],
    ["zh-TW", "Logitech G Pro X Superlight 2 兩側各留 2 mm。"],
  ] as const)("still rejects a standalone 2 (%s)", async (locale, headline) => {
    const input = inputFor(locale);
    const client = new FakeTextModel({ answer: () => answer(headline) });
    const result = await analyse(input, client);
    expect(result.source).toBe("fallback");
    expect(client.calls).toHaveLength(2);
  });
});
