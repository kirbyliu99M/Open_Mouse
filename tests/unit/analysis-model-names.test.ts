/**
 * A model that writes the real name of a mouse it was given ("G Pro X
 * Superlight 2") must not lose its answer to the no-new-numerals rule just
 * because the name ends in a bare digit. Any other stray number still does.
 */
import { describe, expect, it } from "vitest";
import { analyse } from "../../src/server/analysis/analyse";
import { FakeTextModel } from "../../src/server/analysis/client";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import {
  collectNumbers,
  findUnknownNumeral,
  withoutDisplayNames,
} from "../../src/server/analysis/numerals";
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

describe("analyse(): a name may not hide the start of a new number (A1-01)", () => {
  it.each([
    ["full-width digit", "G Pro X Superlight 2１ mm of clearance."],
    ["Arabic-Indic digit", "G Pro X Superlight 2٣ mm of clearance."],
    ["Devanagari digit", "G Pro X Superlight 2३ mm of clearance."],
    ["percent sign", "G Pro X Superlight 2% clearance."],
    ["full-width percent sign", "G Pro X Superlight 2％ clearance."],
    ["unit glued on", "G Pro X Superlight 2mm of clearance."],
    ["unit after a space", "G Pro X Superlight 2 mm of clearance."],
    ["centimetres", "G Pro X Superlight 2 cm of clearance."],
    ["grams", "G Pro X Superlight 2 g lighter."],
    ["分", "G Pro X Superlight 2 分的差距。"],
    ["公分", "G Pro X Superlight 2公分的差距。"],
    ["公克", "G Pro X Superlight 2 公克的差距。"],
    ["decimal point", "G Pro X Superlight 2.5 mm of clearance."],
    [
      "format character between",
      "G Pro X Superlight 2\u200b１ mm of clearance.",
    ],
  ] as const)("rejects %s after the name", async (_label, headline) => {
    const input = inputFor("en");
    expect(collectNumbers(input).has(2)).toBe(false);
    expect(collectNumbers(input).has(21)).toBe(false);
    const client = new FakeTextModel({ answer: () => answer(headline) });
    const result = await analyse(input, client);
    expect(result.source).toBe("fallback");
    expect(client.calls).toHaveLength(2);
  });

  it.each([
    "The G Pro X Superlight 2 gives you room for your fingers.",
    "The G PRO X SUPERLIGHT 2, with a lower hump, suits your hand.",
    "Ｌogitech G Pro X Superlight 2 is the top match for your hand.",
    "G Pro X Superlight 2: the closest in the catalogue.",
  ])("still keeps a complete name: %s", async (headline) => {
    const input = inputFor("en");
    const client = new FakeTextModel({ answer: () => answer(headline) });
    const result = await analyse(input, client);
    expect(result.source).toBe("model");
    expect(client.calls).toHaveLength(1);
  });
});

describe("withoutDisplayNames()", () => {
  const names = ["Logitech G Pro X Superlight 2", "G Pro X Superlight 2"];

  it("leaves the text next to a name untouched and only blanks the name", () => {
    expect(
      withoutDisplayNames("Try the G Pro X Superlight 2 today, 78/100.", names),
    ).toBe("Try the   today, 78/100.");
  });

  it("does not match a name that a digit, percent sign or unit continues", () => {
    for (const tail of ["１", "٣", "5", "%", "％", "mm", " cm", "分", ".5"]) {
      const text = `G Pro X Superlight 2${tail}`;
      expect(withoutDisplayNames(text, names)).toBe(text);
    }
  });

  it("still reads a number outside the name", () => {
    const allowed = new Set<number>([1]);
    expect(
      findUnknownNumeral(
        "The G Pro X Superlight 2 is 5 mm wide.",
        allowed,
        new Set(),
        names,
      ),
    ).toBe(5);
    expect(
      findUnknownNumeral(
        "The G Pro X Superlight 2 is wide.",
        allowed,
        new Set(),
        names,
      ),
    ).toBeNull();
  });
});
