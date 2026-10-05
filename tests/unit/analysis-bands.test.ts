import { describe, expect, it } from "vitest";
import {
  REASON_CODES,
  SUBSCORES,
  type ReasonCode,
} from "../../src/lib/contracts/fit";
import { FIT_BANDS, type FitBand } from "../../src/lib/contracts/fit-bands";
import { en, zhTW } from "../../src/lib/copy/fit-bands";
import {
  analyse,
  buildFallbackOutput,
  buildPrompt,
} from "../../src/server/analysis/analyse";
import { FakeTextModel } from "../../src/server/analysis/client";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";
import {
  collectNumbers,
  findUnknownNumeral,
  stringTokens,
} from "../../src/server/analysis/numerals";
import { mentionsProvisional } from "../../src/server/analysis/provisional";
import {
  NEGATIVE_REASON_CODES,
  POSITIVE_REASON_CODES,
} from "../../src/server/analysis/reasonText";
import { analysisOutputSchema } from "../../src/server/analysis/schema";
import { makeEntry, makeFit, makeMeasurements } from "./analysis-fixtures";

/**
 * Fit bands in the analysis: what the model is shown, what it is told, and what
 * the deterministic fallback says. The wording and the thresholds are
 * CANDIDATES (未拍板); these tests pin how the pieces connect, not the words
 * (the copy file's own tests pin that every word is free of numbers and
 * medical claims). The real Gemini API is never called: every model here is the
 * in-memory stub.
 */

/** An entry whose six sub-scores all carry `code`, with a given total and score. */
function entryWith(
  code: ReasonCode,
  { total = 88, score = 80 as number | null, confidence = 0.9 } = {},
) {
  const base = makeEntry();
  return makeEntry({
    total,
    confidence,
    // No digit in the name, so a digit in the output can only come from a bug.
    mouse: {
      ...base.mouse,
      slug: "example-mouse",
      brand: "Example",
      model: "Mouse",
    },
    subscores: Object.fromEntries(
      SUBSCORES.map((key) => [
        key,
        { score, weight: 1 / 6, reason: { code, params: {} } },
      ]),
    ) as typeof base.subscores,
  });
}

const inputFor = (entry = makeEntry(), excluded = makeFit().excluded) =>
  buildAnalysisInput(
    makeFit({ results: [entry], excluded }),
    makeMeasurements(),
  );

const exemptTokensOf = (input: ReturnType<typeof inputFor>) =>
  new Set(
    [...input.topPicks, ...input.excluded].flatMap(({ brand, model }) => [
      ...stringTokens(brand),
      ...stringTokens(model),
    ]),
  );

describe("buildAnalysisInput — band and impact", () => {
  it.each([
    [0, "poor"],
    [49, "poor"],
    [50, "fair"],
    [69, "fair"],
    [70, "good"],
    [84, "good"],
    [85, "very_good"],
    [100, "very_good"],
  ] as const)(
    "a top pick with total %i is %s and carries that band's meaning",
    (total, band) => {
      const top = inputFor(makeEntry({ total })).topPicks[0]!;
      expect(top.band).toBe(band);
      expect(top.bandMeaning).toBe(en.bands[band].meaning);
    },
  );

  it("gives every sub-score a band from its own score, and null for an unrated one", () => {
    const base = makeEntry();
    const entry = makeEntry({
      subscores: {
        ...base.subscores,
        length: { ...base.subscores.length, score: 95 },
        gripWidth: { ...base.subscores.gripWidth, score: 72 },
        heightHump: { ...base.subscores.heightHump, score: 55 },
        frontFlare: { ...base.subscores.frontFlare, score: 12 },
        thumb: { ...base.subscores.thumb, score: null },
      },
    });
    const { subscores } = inputFor(entry).topPicks[0]!;
    expect(subscores.length.band).toBe("very_good");
    expect(subscores.gripWidth.band).toBe("good");
    expect(subscores.heightHump.band).toBe("fair");
    expect(subscores.frontFlare.band).toBe("poor");
    expect(subscores.thumb.band).toBeNull();
    expect(subscores.thumb.score).toBeNull();
  });

  it.each(REASON_CODES)(
    "gives reason code %s its English impact sentence",
    (code) => {
      const { subscores } = inputFor(entryWith(code)).topPicks[0]!;
      for (const key of SUBSCORES) {
        expect(subscores[key].reasonCode).toBe(code);
        expect(subscores[key].impact).toBe(en.impact[code]);
      }
    },
  );

  it("carries the estimate note", () => {
    expect(inputFor().estimateNote).toBe(en.provisional);
  });

  it("adds no number: every new field is a string (or a null band) with no digit in it", () => {
    const input = inputFor();
    expect(typeof input.estimateNote).toBe("string");
    for (const entry of input.topPicks) {
      expect(typeof entry.band).toBe("string");
      expect(typeof entry.bandMeaning).toBe("string");
      for (const sub of Object.values(entry.subscores)) {
        expect(["string", "object"]).toContain(typeof sub.band);
        expect(typeof sub.impact).toBe("string");
      }
    }
    // `collectNumbers` is the no-new-numerals rule's source of truth: strings
    // never add to it, so the new fields cannot widen what the model may write.
    const numbers = collectNumbers(input);
    expect(numbers.has(88)).toBe(true); // the engine's own total
    const added = [
      input.estimateNote,
      ...input.topPicks.flatMap((entry) => [
        entry.bandMeaning,
        ...Object.values(entry.subscores).map((sub) => sub.impact),
      ]),
    ];
    for (const text of added) expect(text).not.toMatch(/\d/u);
  });

  it("builds the input for a top pick of every band without throwing", () => {
    for (const total of [0, 25, 49, 50, 60, 69, 70, 80, 84, 85, 95, 100]) {
      expect(() => inputFor(makeEntry({ total }))).not.toThrow();
    }
  });
});

describe("buildPrompt — how it will feel to use", () => {
  const prompt = (input = inputFor()) => buildPrompt(input);
  const instructions = (input = inputFor()) =>
    prompt(input).split("\n\nData:")[0]!;
  const data = (input = inputFor()) =>
    JSON.parse(prompt(input).split("Data:\n")[1]!) as {
      estimateNote: string;
      topPicks: {
        band: FitBand;
        meaning: string;
        subscores: Record<string, { band: FitBand | null; impact: string }>;
      }[];
    };

  it.each([
    [88, "very_good"],
    [74, "good"],
    [55, "fair"],
    [30, "poor"],
  ] as const)(
    "a total of %i shows the model its band (%s), the meaning and every impact sentence",
    (total, band) => {
      const shown = prompt(inputFor(entryWith("length_ideal", { total })));
      const top = data(inputFor(entryWith("length_ideal", { total })))
        .topPicks[0]!;
      expect(top.band).toBe(band);
      expect(top.meaning).toBe(en.bands[band].meaning);
      expect(shown).toContain(en.bands[band].meaning);
      expect(shown).toContain(en.impact.length_ideal);
      for (const key of SUBSCORES) {
        expect(top.subscores[key]!.impact).toBe(en.impact.length_ideal);
        expect(top.subscores[key]!.band).toBe("good");
      }
    },
  );

  it("shows a null band for an unrated sub-score", () => {
    const entry = entryWith("descriptor_unknown", { score: null });
    const top = data(inputFor(entry)).topPicks[0]!;
    expect(top.subscores.length!.band).toBeNull();
    expect(top.subscores.length!.impact).toBe(en.impact.descriptor_unknown);
  });

  it("shows the estimate note, and shows no band label (the model must not grade the fit itself)", () => {
    const shown = data();
    expect(shown.estimateNote).toBe(en.provisional);
    for (const band of FIT_BANDS) {
      expect(prompt()).not.toContain(en.bands[band].label);
    }
  });

  it("asks for the use experience, anchored on the supplied wording", () => {
    const text = instructions();
    expect(text).toMatch(/how the top pick will feel to use/i);
    expect(text).toMatch(/"meaning"/);
    expect(text).toMatch(/"impact"/);
    expect(text).toMatch(/the one or two things that matter most/i);
    expect(text).toMatch(/what to look for in another mouse/i);
    expect(text).toMatch(
      /"caveats": include one short line saying this is an estimate/,
    );
    expect(text).toMatch(/"estimateNote" wording/);
  });

  it("forbids health claims, accuracy and certainty claims, comparisons with other people, own grades and made-up numbers", () => {
    const text = instructions();
    expect(text).toMatch(/medical, diagnostic, therapeutic/i);
    expect(text).toMatch(/Do not say how accurate or reliable/i);
    expect(text).toMatch(/Never state a certainty/i);
    expect(text).toMatch(/Do not compare with other people/i);
    expect(text).toMatch(/percentiles/i);
    expect(text).toMatch(/Do not grade the fit in your own words/i);
    expect(text).toMatch(
      /Never compute, estimate, round differently, or invent/,
    );
    expect(text).toMatch(/Number words count as numbers/);
    expect(text).toMatch(
      /Never mention internal identifiers, reason codes, band names/,
    );
  });

  it("keeps the word provisional out of the instructions at high confidence, and the estimate note is no provisional caveat", () => {
    expect(instructions()).not.toMatch(/provisional/i);
    // Copying the note must not satisfy the low-confidence caveat check.
    expect(mentionsProvisional(en.provisional)).toBe(false);
    expect(mentionsProvisional(zhTW.provisional)).toBe(false);
  });

  it("still leaves the output schema alone: the five fields the contract names", () => {
    const text = instructions();
    for (const field of [
      "headline",
      "whyTopPick",
      "tradeoffs",
      "whatToAvoid",
      "caveats",
    ]) {
      expect(text).toContain(`"${field}"`);
    }
  });
});

describe("analyse with the stub client — the new input reaches the model", () => {
  const answer = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      headline:
        "Size and grip line up closely, so everyday use should feel comfortable.",
      whyTopPick:
        "The length lets your palm and fingers rest where they naturally fall.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [
        "An estimate from your hand size; the method is still being tuned, so treat it as a guide.",
      ],
      ...over,
    });

  it("sends the band, its meaning and each impact sentence in the prompt of the first call", async () => {
    const input = inputFor();
    const client = new FakeTextModel({ answer: () => answer() });
    const result = await analyse(input, client);
    expect(result.source).toBe("model");
    expect(client.calls).toHaveLength(1);
    const sent = client.calls[0]!.prompt;
    expect(sent).toContain(`"band":"very_good"`);
    expect(sent).toContain(en.bands.very_good.meaning);
    expect(sent).toContain(en.impact.length_ideal);
    expect(sent).toContain(en.impact.flare_crowds_fingers);
    expect(sent).toContain(en.provisional);
  });

  it.each(REASON_CODES)(
    "accepts a model that repeats the meaning and the impact sentence of %s word for word (they trip neither the numerals rule nor the medical guard)",
    async (code) => {
      const input = inputFor(entryWith(code));
      const client = new FakeTextModel({
        answer: () =>
          answer({
            headline: en.bands.very_good.meaning,
            whyTopPick: en.impact[code],
            tradeoffs: [en.impact[code]],
            whatToAvoid: [en.impact[code]],
            caveats: [en.provisional],
          }),
      });
      const result = await analyse(input, client);
      expect(client.calls).toHaveLength(1);
      expect(result.source).toBe("model");
    },
  );

  it.each([
    ["a percentile", "It fits better than 83% of people."],
    ["a new percent", "You can expect it to feel 97% comfortable."],
    ["a new length", "A 130 mm mouse would suit you."],
    ["a spelled-out number", "It suits you better than seventeen people."],
    ["a Chinese numeral", "更適合你的是十二號。"],
  ])(
    "rejects %s as a new numeral, retries once and falls back to the band wording",
    async (_what, text) => {
      const input = inputFor();
      const client = new FakeTextModel({
        answer: () => answer({ whyTopPick: text }),
      });
      const result = await analyse(input, client);
      expect(client.calls).toHaveLength(2);
      expect(result.source).toBe("fallback");
      expect(result.output.whyTopPick).toContain(en.bands.very_good.meaning);
      expect(result.output).toEqual(buildFallbackOutput(input));
    },
  );

  it.each([
    "It may relieve wrist pain.",
    "A wrist-friendly, ergonomic shape.",
    "It will prevent injury.",
    "這支滑鼠可以治療手腕疼痛。",
  ])(
    "rejects the medical claim %j, retries once and falls back to the band wording",
    async (text) => {
      const input = inputFor();
      const client = new FakeTextModel({
        answer: () => answer({ tradeoffs: [text] }),
      });
      const result = await analyse(input, client);
      expect(client.calls).toHaveLength(2);
      expect(result.source).toBe("fallback");
      expect(result.output.whyTopPick).toContain(en.bands.very_good.meaning);
    },
  );

  it("falls back to the same band wording with no model at all", async () => {
    const input = inputFor(makeEntry({ total: 30 }));
    const result = await analyse(input, null);
    expect(result.source).toBe("fallback");
    expect(result.output.whyTopPick).toContain(en.bands.poor.meaning);
  });
});

describe("buildFallbackOutput — use-experience wording", () => {
  it.each([
    [90, "very_good"],
    [75, "good"],
    [60, "fair"],
    [30, "poor"],
  ] as const)(
    "a total of %i opens whyTopPick with the %s meaning",
    (total, band) => {
      const out = buildFallbackOutput(inputFor(makeEntry({ total })));
      expect(out.whyTopPick.startsWith(en.bands[band].meaning)).toBe(true);
    },
  );

  it("follows the band meaning with the impact of at most two things in the mouse's favour", () => {
    const out = buildFallbackOutput(inputFor());
    // The default fixture: length_ideal, width_ideal, hump_matches_grip,
    // flare_crowds_fingers, thumb_rest_supports, weight_in_range.
    expect(out.whyTopPick).toBe(
      [
        en.bands.very_good.meaning,
        en.impact.length_ideal,
        en.impact.width_ideal,
      ].join(" "),
    );
  });

  it("lists what may take getting used to, as impact sentences, at most three", () => {
    const base = makeEntry();
    const entry = makeEntry({
      subscores: {
        length: {
          ...base.subscores.length,
          reason: { code: "length_short", params: {} },
        },
        gripWidth: {
          ...base.subscores.gripWidth,
          reason: { code: "width_wide", params: {} },
        },
        heightHump: {
          ...base.subscores.heightHump,
          reason: { code: "height_high", params: {} },
        },
        frontFlare: {
          ...base.subscores.frontFlare,
          reason: { code: "flare_crowds_fingers", params: {} },
        },
        thumb: {
          ...base.subscores.thumb,
          reason: { code: "thumb_rest_missing", params: {} },
        },
        weight: {
          ...base.subscores.weight,
          reason: { code: "weight_heavier", params: {} },
        },
      },
    });
    expect(buildFallbackOutput(inputFor(entry)).tradeoffs).toEqual([
      en.impact.length_short,
      en.impact.width_wide,
      en.impact.height_high,
    ]);
  });

  it("adds the estimate note to the caveats, after the provisional note at low confidence", () => {
    const high = buildFallbackOutput(inputFor(entryWith("length_ideal")));
    expect(high.caveats).toEqual([en.provisional]);
    const low = buildFallbackOutput(
      inputFor(entryWith("length_ideal", { confidence: 0.4 })),
    );
    expect(low.caveats).toHaveLength(2);
    expect(mentionsProvisional(low.caveats[0]!)).toBe(true);
    expect(low.caveats[1]).toBe(en.provisional);
  });

  it.each(REASON_CODES)(
    "for reason code %s: fits the schema, files the sentence where it belongs, and passes both output checks",
    (code) => {
      for (const total of [20, 60, 75, 95]) {
        const input = inputFor(entryWith(code, { total }));
        const out = buildFallbackOutput(input);
        expect(analysisOutputSchema.safeParse(out).success).toBe(true);
        if (POSITIVE_REASON_CODES.has(code)) {
          expect(out.whyTopPick).toContain(en.impact[code]);
          expect(out.tradeoffs).toEqual([]);
        } else if (NEGATIVE_REASON_CODES.has(code)) {
          expect(out.tradeoffs).toEqual([en.impact[code]]);
          expect(out.whyTopPick).toBe(
            en.bands[input.topPicks[0]!.band].meaning,
          );
        } else {
          expect(out.tradeoffs).toEqual([]);
          expect(out.whyTopPick).toBe(
            en.bands[input.topPicks[0]!.band].meaning,
          );
        }
        for (const text of [
          out.headline,
          out.whyTopPick,
          ...out.tradeoffs,
          ...out.whatToAvoid,
          ...out.caveats,
        ]) {
          expect(findMedicalClaimTerm(text)).toBeNull();
          expect(
            findUnknownNumeral(
              text,
              collectNumbers(input),
              exemptTokensOf(input),
            ),
          ).toBeNull();
        }
        // The only digit-free promise that matters: nothing the fallback adds
        // carries a digit (the name is "Example Mouse", the params are empty).
        expect(JSON.stringify(out)).not.toMatch(/\d/u);
      }
    },
  );
});
