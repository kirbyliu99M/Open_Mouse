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

  it("says what the results page says for a poor top pick, with the name", () => {
    const poor = buildFallbackOutput(
      inputFor(entryWith("length_ideal", { total: 30 })),
    );
    expect(poor.headline).toBe(
      "None of these fits your hand well. The closest is Example Mouse.",
    );
  });

  // The headline follows the band: only `poor` stops saying "top match".
  // `fair` keeps it: its meaning ("Several things do not line up...") does not
  // tell the reader to look at other mice first. Written as literals on purpose.
  it.each([
    [100, "very_good", "Example Mouse is the top match for your hand."],
    [85, "very_good", "Example Mouse is the top match for your hand."],
    [84, "good", "Example Mouse is the top match for your hand."],
    [70, "good", "Example Mouse is the top match for your hand."],
    [69, "fair", "Example Mouse is the top match for your hand."],
    [50, "fair", "Example Mouse is the top match for your hand."],
    [
      49,
      "poor",
      "None of these fits your hand well. The closest is Example Mouse.",
    ],
    [
      0,
      "poor",
      "None of these fits your hand well. The closest is Example Mouse.",
    ],
  ] as const)(
    "a total of %i (%s) has the headline %j",
    (total, band, headline) => {
      const input = inputFor(entryWith("length_ideal", { total }));
      expect(input.topPicks[0]!.band).toBe(band);
      expect(buildFallbackOutput(input).headline).toBe(headline);
    },
  );

  it("agrees with its own whyTopPick: the headline never says top match when the meaning says look elsewhere", () => {
    for (let total = 0; total <= 100; total++) {
      const out = buildFallbackOutput(
        inputFor(entryWith("length_ideal", { total })),
      );
      const saysLookElsewhere = out.whyTopPick.includes("look at other mice");
      expect(out.headline.includes("top match"), `total ${total}`).toBe(
        !saysLookElsewhere,
      );
    }
  });

  it("keeps the real model name in a poor headline, digits and all, and it passes both output checks", () => {
    const input = inputFor(makeEntry({ total: 30 }));
    const { headline } = buildFallbackOutput(input);
    expect(headline).toBe(
      "None of these fits your hand well. The closest is Logitech G Pro X Superlight 2.",
    );
    expect(headline.length).toBeLessThanOrEqual(160);
    expect(findMedicalClaimTerm(headline)).toBeNull();
    expect(
      findUnknownNumeral(
        headline,
        collectNumbers(input),
        exemptTokensOf(input),
      ),
    ).toBeNull();
  });

  it("gives the poor headline with no model at all, and after a model breaks the rules twice", async () => {
    const input = inputFor(makeEntry({ total: 30 }));
    const none = await analyse(input, null);
    expect(none.source).toBe("fallback");
    expect(none.output.headline).toMatch(
      /^None of these fits your hand well\./,
    );
    const broken = new FakeTextModel({
      answer: () =>
        JSON.stringify({
          headline: "A 130 mm mouse for your hand.",
          whyTopPick: "It fits.",
          tradeoffs: [],
          whatToAvoid: [],
          caveats: [],
        }),
    });
    const second = await analyse(input, broken);
    expect(broken.calls).toHaveLength(2);
    expect(second.source).toBe("fallback");
    expect(second.output.headline).toMatch(
      /^None of these fits your hand well\./,
    );
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

  // Which side of the fallback each reason code belongs on, written out by hand.
  // It is the oracle: it is NOT built from POSITIVE_REASON_CODES or
  // NEGATIVE_REASON_CODES, so a code that moves to the wrong side (or is added
  // to neither) fails here instead of being checked against itself.
  // "helpful" = it goes in whyTopPick; "tradeoff" = it goes in tradeoffs;
  // "neither" = the fallback does not say it.
  const SIDE_OF = {
    length_ideal: "helpful",
    length_short: "tradeoff",
    length_long: "tradeoff",
    width_ideal: "helpful",
    width_narrow: "tradeoff",
    width_wide: "tradeoff",
    height_low: "tradeoff",
    height_ideal: "helpful",
    height_high: "tradeoff",
    hump_matches_grip: "helpful",
    hump_mismatch_grip: "tradeoff",
    flare_supports_fingers: "helpful",
    flare_neutral: "neither",
    flare_crowds_fingers: "tradeoff",
    thumb_rest_supports: "helpful",
    thumb_neutral: "neither",
    thumb_rest_missing: "tradeoff",
    thumb_rest_unneeded: "neither",
    weight_in_range: "helpful",
    weight_heavier: "tradeoff",
    weight_lighter: "tradeoff",
    descriptor_unknown: "neither",
    no_preference: "neither",
  } as const satisfies Record<ReasonCode, "helpful" | "tradeoff" | "neither">;

  it("has a side for every reason code and no other, and the engine's two sets say the same", () => {
    expect(Object.keys(SIDE_OF).sort()).toEqual([...REASON_CODES].sort());
    const entries = Object.entries(SIDE_OF);
    const helpful = entries.filter(([, s]) => s === "helpful").map(([c]) => c);
    const tradeoff = entries
      .filter(([, s]) => s === "tradeoff")
      .map(([c]) => c);
    expect(helpful).toHaveLength(7);
    expect(tradeoff).toHaveLength(11);
    expect(entries.filter(([, s]) => s === "neither")).toHaveLength(5);
    expect([...POSITIVE_REASON_CODES].sort()).toEqual([...helpful].sort());
    expect([...NEGATIVE_REASON_CODES].sort()).toEqual([...tradeoff].sort());
  });

  it.each(REASON_CODES)(
    "for reason code %s: fits the schema, files the sentence on its side, and passes both output checks",
    (code) => {
      for (const total of [20, 60, 75, 95]) {
        const input = inputFor(entryWith(code, { total }));
        const out = buildFallbackOutput(input);
        const meaning = en.bands[input.topPicks[0]!.band].meaning;
        expect(analysisOutputSchema.safeParse(out).success).toBe(true);
        const side = SIDE_OF[code];
        if (side === "helpful") {
          expect(out.whyTopPick).toBe(`${meaning} ${en.impact[code]}`);
          expect(out.tradeoffs).toEqual([]);
        } else if (side === "tradeoff") {
          expect(out.tradeoffs).toEqual([en.impact[code]]);
          expect(out.whyTopPick).toBe(meaning);
        } else {
          expect(out.tradeoffs).toEqual([]);
          expect(out.whyTopPick).toBe(meaning);
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

  // The fallback says nothing about the grip, on purpose: it used to say "based
  // on your measurements and grip style" only when the user had stated one. This
  // pins the protection that old wording gave: a grip the engine PREDICTED is
  // never described as something the user chose or stated.
  const GRIP_AS_THE_USERS_CHOICE: RegExp[] = [
    /\bgrip\b[^.]{0,40}\b(?:you|your)\s+(?:chose|choose|picked|pick|selected|select|stated|state|said|specified|preferred|prefer|told)\b/i,
    /\b(?:you|your)\s+(?:chose|choose|picked|selected|stated|said|specified|preferred|told)\b[^.]{0,40}\bgrip\b/i,
    /\b(?:chosen|stated|selected|picked|preferred|specified)\s+grip\b/i,
    /\bgrip\s+(?:choice|preference)\b/i,
    /\byour choice\b/i,
    /\bgrip style\b/i,
  ];

  it("never describes a predicted grip as chosen or stated by the user", () => {
    const base = makeFit();
    for (const used of ["palm", "claw", "fingertip"] as const) {
      for (const code of REASON_CODES) {
        for (const total of [10, 60, 75, 95]) {
          const input = buildAnalysisInput(
            makeFit({
              gripStyle: { stated: null, predicted: used, used },
              excluded: base.excluded,
              results: [entryWith(code, { total })],
            }),
            makeMeasurements(),
          );
          const out = buildFallbackOutput(input);
          for (const text of [
            out.headline,
            out.whyTopPick,
            ...out.tradeoffs,
            ...out.whatToAvoid,
            ...out.caveats,
          ]) {
            for (const pattern of GRIP_AS_THE_USERS_CHOICE) {
              expect(text, `${used} ${code} ${total}`).not.toMatch(pattern);
            }
          }
        }
      }
    }
  });

  it("proves the grip patterns fire on the wordings they exist to catch", () => {
    for (const text of [
      "It suits the grip you chose.",
      "Based on your measurements and grip style.",
      "It matches your stated grip.",
      "A good match for the grip you picked.",
      "Your grip choice works well here.",
      "This is the best pick for your choice.",
      "You told us your grip, and it fits.",
    ]) {
      expect(
        GRIP_AS_THE_USERS_CHOICE.some((p) => p.test(text)),
        text,
      ).toBe(true);
    }
    // And they leave the real wording alone.
    for (const code of REASON_CODES) {
      for (const text of [en.impact[code]]) {
        expect(
          GRIP_AS_THE_USERS_CHOICE.some((p) => p.test(text)),
          text,
        ).toBe(false);
      }
    }
    for (const band of FIT_BANDS) {
      expect(
        GRIP_AS_THE_USERS_CHOICE.some((p) => p.test(en.bands[band].meaning)),
      ).toBe(false);
    }
    expect(GRIP_AS_THE_USERS_CHOICE.some((p) => p.test(en.provisional))).toBe(
      false,
    );
  });
});

describe("buildPrompt — every instruction line is pinned", () => {
  // One entry per rule the prompt gives the model: the name says what it is
  // for, the text is the sentence itself, copied by hand. Delete or reword any
  // one of them in `buildPrompt` and its test fails. The wording is a candidate
  // (未拍板): changing a sentence on purpose means changing it here too.
  const RULES: [string, string][] = [
    [
      "the task",
      "You are writing a short analysis of a mouse-fit ranking for a user, from the JSON data below.",
    ],
    [
      "how it will feel to use",
      "Explain how the top pick will feel to use for this hand. Do not just restate the scores.",
    ],
    [
      "numbers only from the data (and number words are numbers)",
      '- Every number you write MUST already appear in the JSON data. Never compute, estimate, round differently, or invent a number. Number words count as numbers (for example "two" or "half").',
    ],
    [
      "anchor on the supplied wording",
      '- Anchor on the wording in the data: each top pick has a "meaning" for its overall band, and each sub-score has an "impact" sentence. Say what they say, in plain words of your own, and do not add claims they do not make.',
    ],
    [
      "headline",
      '- "headline": one short sentence on how the top pick will feel overall, starting from its band meaning.',
    ],
    [
      "whyTopPick",
      '- "whyTopPick": one or two short sentences on the one or two things that matter most for this hand and this mouse, taken from the sub-scores with the most to say, and what to expect when using it.',
    ],
    [
      "tradeoffs",
      '- "tradeoffs" (up to three): what may take getting used to, taken from the sub-scores in a lower band.',
    ],
    [
      "whatToAvoid",
      '- "whatToAvoid" (up to two): what to look for in another mouse, or an excluded mouse and why it was left out. Name a mouse only if it is in the data.',
    ],
    [
      "caveats and the estimate note",
      '- "caveats": include one short line saying this is an estimate from the hand measurements, using the "estimateNote" wording as written or close to it.',
    ],
    [
      "use experience only, no certainty",
      '- Keep every line short. Describe use experience only (reach, grip, where the palm and fingers rest, how a long session may feel), with "may" and "tends to". Never state a certainty.',
    ],
    [
      "no claim about accuracy",
      "- Do not say how accurate or reliable the estimate is, and do not promise an outcome.",
    ],
    [
      "no comparison with other people",
      "- Do not compare with other people, other users' scores, averages, or percentiles.",
    ],
    [
      "no grading of its own",
      '- Do not grade the fit in your own words (no "good fit", "bad fit", "excellent", "poor", "high score", "low score"). Use only the band meaning and impact wording supplied.',
    ],
    ["write plainly", "- Write plainly for someone who has not seen the JSON."],
    [
      "no internal identifiers",
      "- Never mention internal identifiers, reason codes, band names, or version strings. Describe the facts in plain language.",
    ],
    [
      "a stated grip is the user's choice",
      "- If a grip style was stated, describe it as the user's choice, not a prediction.",
    ],
    [
      "no medical claims",
      "- Never make medical, diagnostic, therapeutic, or injury-prevention claims. Do not claim a mouse prevents or reduces strain or injury, or relieves pain.",
    ],
    [
      "no named conditions, no ergonomic or wrist-friendly",
      "- Do not mention carpal tunnel syndrome, CTS, RSI, tendinitis, tendonitis, pain relief, or other health conditions. Do not call a mouse ergonomic, wrist-friendly, healthier, or safer for the body.",
    ],
    [
      "only shape facts and how they affect use, no vendor copy",
      "- Describe only shape facts and how they affect use, such as vertical grip, taller hump, or wider shell. Never repeat vendor marketing copy about wrist health.",
    ],
    [
      "the asymmetric right-hand shape",
      '- For an asymmetric, right-hand sculpted shape, say "asymmetric right-hand shape", not "ergonomic".',
    ],
  ];

  const LOW_CONFIDENCE_RULE =
    '- The top pick has low confidence: some shape descriptors it depends on are not classified yet. Say explicitly that the ranking and descriptors are provisional, and the "caveats" array must mention it.';

  const instructionsOf = (input: ReturnType<typeof inputFor>) =>
    buildPrompt(input).split("\n\nData:")[0]!;
  const high = () => instructionsOf(inputFor());
  const low = () =>
    instructionsOf(inputFor(entryWith("length_ideal", { confidence: 0.4 })));

  it.each(RULES)("says %s", (_name, sentence) => {
    expect(high()).toContain(sentence);
    expect(low()).toContain(sentence);
  });

  it("gives each rule its own line, in order", () => {
    const lines = high().split("\n");
    let from = 0;
    for (const [name, sentence] of RULES) {
      const at = lines.findIndex((line, i) => i >= from && line === sentence);
      // Each rule is a whole line of its own.
      expect(at, name).toBeGreaterThanOrEqual(0);
      from = at + 1;
    }
  });

  it("has no instruction line this list does not know: 18 rules at high confidence, one more at low", () => {
    const rules = (text: string) =>
      text.split("\n").filter((line) => line.startsWith("- "));
    // 20 entries: the task and the framing are plain lines, the other 18 are
    // bullets.
    expect(RULES).toHaveLength(20);
    expect(rules(high())).toHaveLength(18);
    expect(rules(low())).toHaveLength(19);
    expect(low()).toContain(LOW_CONFIDENCE_RULE);
    expect(high()).not.toContain(LOW_CONFIDENCE_RULE);
  });

  it("opens with the task and the framing, then the word Rules", () => {
    const lines = high().split("\n");
    expect(lines[0]).toBe(RULES[0]![1]);
    expect(lines[1]).toBe(RULES[1]![1]);
    expect(lines[2]).toBe("Rules:");
  });
});
