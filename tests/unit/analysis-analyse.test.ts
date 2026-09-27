import { describe, expect, it } from "vitest";
import { analyse, buildPrompt } from "../../src/server/analysis/analyse";
import { REASON_CODES } from "../../src/lib/contracts/fit";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { FakeTextModel } from "../../src/server/analysis/client";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";
import { slugify } from "../../src/server/catalogue/seed-rows";
import { makeEntry, makeFit, makeMeasurements } from "./analysis-fixtures";

function inputFor(confidence = 0.9) {
  const fit = makeFit({
    results: [{ ...makeFit().results[0]!, confidence }],
  });
  return buildAnalysisInput(fit, makeMeasurements());
}

/**
 * An input whose top pick is the real seed row `{ brand: "Logitech", model:
 * "G502 X" }` from src/db/seed/logitech.json, with its slug run through the
 * REAL `slugify` (never hand-written) — exactly the shape
 * `collectExemptTokens`/`exemptTokens` exists to protect.
 *
 * This deliberately replaces an earlier fixture that hand-crafted an
 * impossible slug ("logitech-superlight-variant") for a "G502" model —
 * `slugify("Logitech", "G502")` can never produce that string. A test that
 * has to invent data the real pipeline cannot produce is evidence the code
 * under test is wrong, and it hid the real bug (the slug's lowercase digit
 * run riding the exemption) for a full review round.
 */
function inputWithG502X() {
  const fit = makeFit({
    results: [
      {
        ...makeEntry(),
        mouse: {
          ...makeEntry().mouse,
          slug: slugify("Logitech", "G502 X"),
          brand: "Logitech",
          model: "G502 X",
        },
      },
    ],
  });
  return buildAnalysisInput(fit, makeMeasurements());
}

const CLEAN_ANSWER = JSON.stringify({
  headline: "A strong match for your hand.",
  whyTopPick: "It's 125 mm long, right in your ideal range.",
  tradeoffs: ["The front flare may crowd your fingertips a little."],
  whatToAvoid: [],
  caveats: [],
});

describe("analyse — medical claims", () => {
  it("returns readable labels for matched patterns", () => {
    expect(findMedicalClaimTerm("an injured wrist")).toBe("injury");
    expect(findMedicalClaimTerm("safer for your hand")).toBe(
      "safer for wrist or body",
    );
    expect(
      findMedicalClaimTerm("Treat this ranking as provisional"),
    ).toBeNull();
  });

  const answerWith = (text: string) =>
    JSON.stringify({
      headline: text,
      whyTopPick: "It has a taller hump and wider grip.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });

  it("instructs the model to avoid medical claims and vendor health copy", () => {
    const instructions = buildPrompt(inputFor()).split("\n\nData:")[0]!;
    expect(instructions).toMatch(/medical, diagnostic, therapeutic/i);
    expect(instructions).toMatch(/injury.prevention/i);
    expect(instructions).toMatch(/vendor marketing copy/i);
    expect(instructions).toMatch(/vertical grip.*taller hump.*wider/i);
  });

  it.each([
    "carpal tunnel syndrome",
    "CTS",
    "RSI",
    "repetitive strain",
    "tendinitis",
    "tendonitis",
    "injuries",
    "painless",
    "relief",
    "prevents wrist pain",
    "prevent injury",
    "preventing injuries",
    "prevention",
    "prevention of injury",
    "therapeutic",
    "medical",
    "diagnosis",
    "treatment",
    "treats pain",
    "to treat wrist pain",
    "cure",
    "healthier",
    "safer for your wrist",
    "ergonomic",
    "ergonomically",
    "ergonomics",
    "wrist-friendly",
    "strain",
    "strains",
    "strained",
    "painful",
    "injured",
    "wrist health",
    "wrist-saving",
    "wrist saving",
    "reduces wrist stress",
    "reducing hand strain",
    "reduced forearm tension",
    "reduce finger pressure",
    "腕隧道",
    "腕管",
    "肌腱炎",
    "疼痛",
    "酸痛",
    "預防受傷",
    "预防受伤",
    "預防手腕疼痛",
    "预防腕疼痛",
    "治療",
    "治疗",
    "醫療",
    "医疗",
    "診斷",
    "诊断",
    "護腕",
    "护腕",
    "人體工學",
    "人体工学",
    "減輕手腕負擔",
    "减轻手腕负担",
    "受傷",
    "受伤",
    "緩解",
    "缓解",
  ])("rejects model output containing %s", async (term) => {
    const client = new FakeTextModel({
      answer: () => answerWith(`A ${term} choice.`),
    });
    const result = await analyse(inputFor(), client);
    expect(client.calls).toHaveLength(2);
    expect(result.source).toBe("fallback");
    expect(JSON.stringify(result.output).toLowerCase()).not.toContain(
      term.toLowerCase(),
    );
  });

  it.each([
    "Spain",
    "painted",
    "prevents your palm from sliding",
    "should be treated as provisional",
    "Treat this ranking as provisional",
    "a safer pick",
    "secure",
    "curve",
    "restrain",
    "less fatigue",
    "comfortable for long sessions",
    "預防滑動",
  ])("accepts output containing near-miss word %s", async (word) => {
    const client = new FakeTextModel({
      answer: () => answerWith(`A ${word} finish with a wider grip.`),
    });
    const result = await analyse(inputFor(), client);
    expect(client.calls).toHaveLength(1);
    expect(result.source).toBe("model");
  });

  it("retries a medical claim and accepts a corrected shape-only answer", async () => {
    const client = new FakeTextModel({
      answer: (_args, index) =>
        index === 0
          ? answerWith("Wrist-friendly shape.")
          : answerWith("A wider grip and taller hump."),
    });
    const result = await analyse(inputFor(), client);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.prompt).toContain(
      "prohibited medical or health term (wrist-friendly)",
    );
    expect(result.source).toBe("model");
    expect(result.output.headline).toBe("A wider grip and taller hump.");
  });

  it.each(["whyTopPick", "tradeoffs", "whatToAvoid", "caveats"] as const)(
    "rejects a medical term in %s",
    async (field) => {
      const answer = {
        headline: "A wider shape.",
        whyTopPick: "It has a taller hump.",
        tradeoffs: [] as string[],
        whatToAvoid: [] as string[],
        caveats: [] as string[],
      };
      if (field === "whyTopPick") answer.whyTopPick = "Pain relief.";
      else answer[field] = ["Pain relief."];
      const client = new FakeTextModel({
        answer: () => JSON.stringify(answer),
      });
      const result = await analyse(inputFor(), client);
      expect(client.calls).toHaveLength(2);
      expect(result.source).toBe("fallback");
    },
  );

  it("accepts a shape-only analysis on the first attempt", async () => {
    const client = new FakeTextModel({
      answer: () =>
        answerWith("A vertical grip with a taller hump and wider shell."),
    });
    const result = await analyse(inputFor(), client);
    expect(client.calls).toHaveLength(1);
    expect(result.source).toBe("model");
  });
});

describe("analyse — no-new-numerals rule", () => {
  it("path 1: accepts a clean answer with only numbers from the input", async () => {
    const input = inputFor();
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const { output } = await analyse(input, client);
    expect(output.headline).toBe("A strong match for your hand.");
    expect(client.calls).toHaveLength(1);
  });

  it("accepts presented values and rejects an invented percent", async () => {
    const fit = makeFit({
      results: [{ ...makeEntry(), confidence: 0.7575757575757576 }],
    });
    const input = buildAnalysisInput(
      fit,
      makeMeasurements({ handLengthMm: 180.456 }),
    );
    const answer = (whyTopPick: string) =>
      JSON.stringify({
        headline: "A strong match for your hand.",
        whyTopPick,
        tradeoffs: [],
        whatToAvoid: [],
        caveats: [],
      });
    const client = new FakeTextModel({
      answer: (_args, index) =>
        index === 0
          ? answer("Confidence is 77% and your hand is 180.5 mm long.")
          : answer("Confidence is 76% and your hand is 180.5 mm long."),
    });
    const { output, source } = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(output.whyTopPick).toContain("76%");
    expect(source).toBe("model");
  });

  it("keeps every slug, every reason code and the engine version out of the prompt data", () => {
    const fit = makeFit();
    const prompt = buildPrompt(buildAnalysisInput(fit, makeMeasurements()));
    const data = prompt.split("Data:\n")[1]!;
    expect(data).not.toContain(fit.engineVersion);
    for (const slug of [
      ...fit.results.map((r) => r.mouse.slug),
      ...fit.excluded.map((e) => e.slug),
    ]) {
      expect(data).not.toContain(slug);
    }
    for (const code of REASON_CODES) {
      expect(data).not.toContain(`"${code}"`);
    }
    expect(data).toContain("Fit settings have not yet been validated");
    expect(data).toContain("its length matches your hand well");
    expect(prompt).toContain("Never mention internal identifiers");
  });

  it("describes each exclusion in the same terms as the results page", () => {
    const fit = makeFit({
      excluded: [
        {
          slug: "logitech-lift-vertical",
          brand: "Logitech",
          model: "Lift Vertical",
          reason: "vertical_form_factor",
        },
        {
          slug: "logitech-lift-left",
          brand: "Logitech",
          model: "Lift Left",
          reason: "wrong_hand",
        },
      ],
    });
    const data = buildPrompt(buildAnalysisInput(fit, makeMeasurements())).split(
      "Data:\n",
    )[1]!;
    expect(data).toContain("vertical shape, excluded from this comparison");
    expect(data).toContain("doesn't fit your handedness");
    expect(data).not.toContain("scored separately");
  });

  it("path 2: retries once, naming the violation, then accepts the corrected answer", async () => {
    const input = inputFor();
    const badAnswer = JSON.stringify({
      headline: "A 130 mm mouse for your hand.", // 130 is not in the input
      whyTopPick: "It fits well.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({
      answer: (_args, callIndex) =>
        callIndex === 0 ? badAnswer : CLEAN_ANSWER,
    });
    const { output } = await analyse(input, client);
    expect(output.headline).toBe("A strong match for your hand.");
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.prompt).toContain("130");
    expect(client.calls[1]!.prompt).toContain("does not appear anywhere");
  });

  it("path 3: two violations in a row fall back to the deterministic answer", async () => {
    const input = inputFor();
    const badAnswer = JSON.stringify({
      headline: "A 130 mm mouse for your hand.",
      whyTopPick: "It fits well.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({ answer: () => badAnswer });
    const { output } = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    // The fallback never quotes 130 — it's built purely from reason codes.
    expect(output.headline).toBe(
      "Logitech G Pro X Superlight 2 is the top match for your hand.",
    );
    expect(JSON.stringify(output)).not.toContain("130");
  });

  it("rejects an answer whose JSON doesn't match the schema, then falls back", async () => {
    const input = inputFor();
    const client = new FakeTextModel({
      answer: () => JSON.stringify({ oops: true }),
    });
    const { output } = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(output.headline).toContain("top match");
  });
});

describe("analyse — low confidence", () => {
  it("the instructions (not just the data) say descriptors are provisional at low confidence", () => {
    const input = inputFor(0.4);
    expect(input.topPicks[0]!.lowConfidence).toBe(true);
    const instructions = buildPrompt(input).split("\n\nData:")[0]!;
    expect(instructions).toMatch(/provisional/i);
  });

  it("does not accept the copied ranking-status sentence as the low-confidence caveat", async () => {
    const input = inputFor(0.4);
    // Whatever sentence the prompt actually shows the model, verbatim.
    const shown = JSON.parse(buildPrompt(input).split("Data:\n")[1]!) as {
      rankingStatus: string;
    };
    expect(shown.rankingStatus).toBeTypeOf("string");
    const copiedStatus = JSON.stringify({
      headline: "A strong match.",
      whyTopPick: "It fits.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [shown.rankingStatus],
    });
    const client = new FakeTextModel({ answer: () => copiedStatus });
    const { source } = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(source).toBe("fallback");
  });

  it("does not add the provisional instruction at high confidence", () => {
    const input = inputFor(0.9);
    const instructions = buildPrompt(input).split("\n\nData:")[0]!;
    expect(instructions).not.toMatch(/provisional/i);
  });

  it("retries when a low-confidence answer's caveats omit the provisional note", async () => {
    const input = inputFor(0.4);
    const missingCaveat = JSON.stringify({
      headline: "A strong match.",
      whyTopPick: "It fits.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [], // no mention of "provisional"
    });
    const withCaveat = JSON.stringify({
      headline: "A likely match, though provisional.",
      whyTopPick: "It fits.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [
        "This ranking is provisional — some descriptors aren't classified yet.",
      ],
    });
    const client = new FakeTextModel({
      answer: (_args, callIndex) =>
        callIndex === 0 ? missingCaveat : withCaveat,
    });
    const { output } = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(output.caveats.some((c) => /provisional/i.test(c))).toBe(true);
  });

  it("the fallback's caveats mention low confidence", async () => {
    const input = inputFor(0.4);
    const client = new FakeTextModel({
      answer: () =>
        JSON.stringify({
          headline: "x",
          whyTopPick: "x",
          tradeoffs: [],
          whatToAvoid: [],
          caveats: [],
        }),
    });
    const { output } = await analyse(input, client);
    expect(output.caveats.some((c) => /provisional/i.test(c))).toBe(true);
  });
});

// These exercise the real `analyse()` call path end to end — no hand-built
// `exemptTokens`/`allowedNumbers` sets — because that's exactly the seam a
// previous change (6ffbd0f) left unwired: `numerals.ts` grew the exemption
// mechanism, but `analyse.ts` never threaded it through, so a correct
// analysis naming a real product like "G502 X" would have been rejected as a
// fabricated number.
describe("analyse — product-name exemption wired through the real call path", () => {
  it("passes an answer naming a product (G502 X) that is present in the input, correctly cased from `model`", async () => {
    const input = inputWithG502X();
    const answer = JSON.stringify({
      headline: "The Logitech G502 X is a strong match for your hand.",
      whyTopPick: "Its 125 mm length sits right in your ideal range.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({ answer: () => answer });
    const { output } = await analyse(input, client);
    expect(output.headline).toContain("G502 X");
    expect(client.calls).toHaveLength(1);
  });

  it('rejects "about68mm" when 68 is not in the input', async () => {
    const input = inputWithG502X();
    const badAnswer = JSON.stringify({
      headline: "A great fit.",
      whyTopPick: "It's about68mm narrower than your other options.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({ answer: () => badAnswer });
    const { output } = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.prompt).toContain("68");
    expect(client.calls[1]!.prompt).toContain("does not appear anywhere");
    // Never accepted — falls back to the deterministic, number-free answer.
    expect(JSON.stringify(output)).not.toContain("68");
  });

  it("rejects a vulgar fraction (½) that is not in the input", async () => {
    const input = inputWithG502X();
    const badAnswer = JSON.stringify({
      headline: "A great fit.",
      whyTopPick: "It's roughly ½ inch narrower than average.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({ answer: () => badAnswer });
    const { output } = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.prompt).toContain("0.5");
    expect(client.calls[1]!.prompt).toContain("does not appear anywhere");
    expect(JSON.stringify(output)).not.toContain("½");
  });

  it("does not give a fabricated product name (G999) a free pass on its digits", async () => {
    const input = inputWithG502X(); // input has G502 X, never G999
    const badAnswer = JSON.stringify({
      headline: "The Logitech G999 is a strong match for your hand.",
      whyTopPick: "It fits well.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({ answer: () => badAnswer });
    const { output } = await analyse(input, client);
    // "G999" was never sent in the input, so its digits must still be
    // checked — the exemption only covers tokens that appear verbatim in
    // the input, not any letter-digit combination the model invents.
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.prompt).toContain("999");
    expect(client.calls[1]!.prompt).toContain("does not appear anywhere");
    expect(output.headline).not.toContain("G999");
  });

  // Change 1, end to end — this is the exact bug named in the brief: the
  // input's `slug` is the REAL `slugify("Logitech", "G502 X")` output
  // ("logitech-g502-x"), which contains the lowercase "g502" substring. The
  // old `collectStringTokens` walked every string leaf including `slug`, so
  // "g502" (lowercase) was always in the exempt set for any seeded model
  // with digits — making the earlier case-sensitivity fix a no-op. Now that
  // the exemption is built only from `brand`/`model` (see analyse.ts's
  // `collectExemptTokens`), the slug's presence in the input must NOT
  // exempt the lowercase form.
  it("Change 1, end to end: does not let a lowercased 'g502' ride the product-name exemption, even though the input's real slug ('logitech-g502-x') contains that exact lowercase substring", async () => {
    const input = inputWithG502X();
    expect(input.topPicks[0]!.slug).toBe("logitech-g502-x");
    const badAnswer = JSON.stringify({
      headline: "A great fit.",
      whyTopPick: "Expect roughly g502 mm of clearance for your grip.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({ answer: () => badAnswer });
    const { output } = await analyse(input, client);
    // Must NOT pass on the first attempt.
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.prompt).toContain("502");
    expect(client.calls[1]!.prompt).toContain("does not appear anywhere");
    expect(JSON.stringify(output)).not.toContain("g502");
  });
});

// Change 2, end to end: reproduces the ordinal/fraction regressions through
// the real analyse() call path, not just the numerals.ts helpers — helper-
// level tests are exactly what let this bug class (Findings 3 and Change 2)
// through multiple rounds.
describe("analyse — Change 2: ordinal vs. fraction, real call path", () => {
  it('does not let "roughly third of the palm width" pass on the first attempt', async () => {
    const input = inputFor();
    const badAnswer = JSON.stringify({
      headline: "A strong match for your hand.",
      whyTopPick: "It covers roughly third of the palm width for good support.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({
      answer: (_args, callIndex) =>
        callIndex === 0 ? badAnswer : CLEAN_ANSWER,
    });
    const { output } = await analyse(input, client);
    // Must NOT pass on the first attempt — it must retry, naming the
    // fraction value as the violation, then accept the corrected answer.
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.prompt).toContain("0.333");
    expect(client.calls[1]!.prompt).toContain("does not appear anywhere");
    expect(output.headline).toBe("A strong match for your hand.");
  });

  // Exact repro string from the brief: a determiner ("the") before "third",
  // but followed by "of" — the old rule exempted on the determiner alone
  // and never looked at what came after.
  it('repro: does not let "roughly the third of the palm width" pass on the first attempt (determiner before is not enough when "of" follows)', async () => {
    const input = inputFor();
    const badAnswer = JSON.stringify({
      headline: "A strong match for your hand.",
      whyTopPick: "It covers roughly the third of the palm width.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({
      answer: (_args, callIndex) =>
        callIndex === 0 ? badAnswer : CLEAN_ANSWER,
    });
    const { output } = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.prompt).toContain("0.333");
    expect(client.calls[1]!.prompt).toContain("does not appear anywhere");
    expect(output.headline).toBe("A strong match for your hand.");
  });

  // Exact repro string from the brief: a bare fraction whose *next sentence*
  // happens to start with what used to be a result-noun carve-out ("Pick").
  // The old rule tokenized away the sentence-ending period, so "pick"
  // starting the next sentence exempted the fraction in the previous one.
  it('repro: does not let "It covers roughly third. Pick something else." pass on the first attempt', async () => {
    const input = inputFor();
    const badAnswer = JSON.stringify({
      headline: "A strong match for your hand.",
      whyTopPick: "It covers roughly third. Pick something else.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({
      answer: (_args, callIndex) =>
        callIndex === 0 ? badAnswer : CLEAN_ANSWER,
    });
    const { output } = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.prompt).toContain("0.333");
    expect(client.calls[1]!.prompt).toContain("does not appear anywhere");
    expect(output.headline).toBe("A strong match for your hand.");
  });

  it('still accepts "the third pick" — clearly-ordinal phrasing this module\'s own domain writes — on the first attempt', async () => {
    const input = inputFor();
    const answer = JSON.stringify({
      headline: "A strong match for your hand.",
      whyTopPick: "It's 125 mm long, right in your ideal range.",
      tradeoffs: [],
      whatToAvoid: ["The third pick runs a little narrow for your grip."],
      caveats: [],
    });
    const client = new FakeTextModel({ answer: () => answer });
    const { output } = await analyse(input, client);
    expect(client.calls).toHaveLength(1);
    expect(output.whatToAvoid[0]).toContain("third pick");
  });
});

// Change 3, end to end: closes the sentence-boundary gap that was left as a
// documented KNOWN GAP in numerals.ts — a determiner ending one sentence
// ("...the.") no longer counts as immediately preceding a fraction word
// that starts the next one.
describe("analyse — Change 3: sentence-boundary punctuation as a token boundary, real call path", () => {
  it('exact repro from the brief: "Bring the. Third mm of clearance is available." does not pass on the first attempt', async () => {
    const input = inputFor();
    const badAnswer = JSON.stringify({
      headline: "A strong match for your hand.",
      whyTopPick: "Bring the. Third mm of clearance is available.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({
      answer: (_args, callIndex) =>
        callIndex === 0 ? badAnswer : CLEAN_ANSWER,
    });
    const { output } = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.prompt).toContain("0.333");
    expect(client.calls[1]!.prompt).toContain("does not appear anywhere");
    expect(output.headline).toBe("A strong match for your hand.");
  });

  it('still accepts "Consider the third pick instead." on the first attempt — no boundary between "the" and "third"', async () => {
    const input = inputFor();
    const answer = JSON.stringify({
      headline: "A strong match for your hand.",
      whyTopPick: "It's 125 mm long, right in your ideal range.",
      tradeoffs: [],
      whatToAvoid: ["Consider the third pick instead."],
      caveats: [],
    });
    const client = new FakeTextModel({ answer: () => answer });
    const { output } = await analyse(input, client);
    expect(client.calls).toHaveLength(1);
    expect(output.whatToAvoid[0]).toBe("Consider the third pick instead.");
  });

  it('still passes a genuine product-name/digit mention: "The G502 X suits your grip well." on the first attempt', async () => {
    const input = inputWithG502X();
    const answer = JSON.stringify({
      headline: "The G502 X suits your grip well.",
      whyTopPick: "It's 125 mm long, right in your ideal range.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({ answer: () => answer });
    const { output } = await analyse(input, client);
    expect(client.calls).toHaveLength(1);
    expect(output.headline).toBe("The G502 X suits your grip well.");
  });
});

// Change 4, end to end: SENTENCE_BOUNDARY_PATTERN was ASCII-only, so a
// Unicode sentence-ender a model can realistically produce — an ellipsis,
// or CJK/fullwidth punctuation — still let a determiner ending one sentence
// count as immediately preceding a fraction word starting the next. Same
// exact repro shape as Change 3, with a non-ASCII separator.
describe("analyse — Change 4: Unicode sentence-boundary punctuation as a token boundary, real call path", () => {
  it('exact repro from the brief, ellipsis (U+2026): "Bring the… Third mm of clearance is available." does not pass on the first attempt', async () => {
    const input = inputFor();
    const badAnswer = JSON.stringify({
      headline: "A strong match for your hand.",
      whyTopPick: "Bring the… Third mm of clearance is available.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({
      answer: (_args, callIndex) =>
        callIndex === 0 ? badAnswer : CLEAN_ANSWER,
    });
    const { output } = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.prompt).toContain("0.333");
    expect(client.calls[1]!.prompt).toContain("does not appear anywhere");
    expect(output.headline).toBe("A strong match for your hand.");
  });

  it('exact repro from the brief, ideographic full stop (U+3002): "Bring the。 Third mm of clearance is available." does not pass on the first attempt', async () => {
    const input = inputFor();
    const badAnswer = JSON.stringify({
      headline: "A strong match for your hand.",
      whyTopPick: "Bring the。 Third mm of clearance is available.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({
      answer: (_args, callIndex) =>
        callIndex === 0 ? badAnswer : CLEAN_ANSWER,
    });
    const { output } = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.prompt).toContain("0.333");
    expect(client.calls[1]!.prompt).toContain("does not appear anywhere");
    expect(output.headline).toBe("A strong match for your hand.");
  });
});

// Issue #28 acceptance criterion 1: `source` must be real, never inferred
// from whether a key/client is configured. Every branch of `analyse()` is
// exercised here for its `source`, on top of the existing `output` coverage
// above.
describe("analyse — source provenance (issue #28)", () => {
  it('source is "model" when the first attempt is clean', async () => {
    const input = inputFor();
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const { output, source } = await analyse(input, client);
    expect(source).toBe("model");
    expect(output.headline).toBe("A strong match for your hand.");
  });

  it('source is "model" after a retry that fixes a numeral violation', async () => {
    const input = inputFor();
    const badAnswer = JSON.stringify({
      headline: "A 130 mm mouse for your hand.",
      whyTopPick: "It fits well.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({
      answer: (_args, callIndex) =>
        callIndex === 0 ? badAnswer : CLEAN_ANSWER,
    });
    const { source } = await analyse(input, client);
    expect(source).toBe("model");
  });

  it('source is "fallback" when both attempts violate the no-new-numerals rule', async () => {
    const input = inputFor();
    const badAnswer = JSON.stringify({
      headline: "A 130 mm mouse for your hand.",
      whyTopPick: "It fits well.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({ answer: () => badAnswer });
    const { source } = await analyse(input, client);
    expect(source).toBe("fallback");
  });

  it('source is "fallback" when both attempts fail schema validation', async () => {
    const input = inputFor();
    const client = new FakeTextModel({
      answer: () => JSON.stringify({ oops: true }),
    });
    const { source } = await analyse(input, client);
    expect(source).toBe("fallback");
  });

  it('source is "fallback" when both attempts return unparsable JSON', async () => {
    const input = inputFor();
    const client = new FakeTextModel({ answer: () => "not json at all" });
    const { source } = await analyse(input, client);
    expect(source).toBe("fallback");
    expect(client.calls).toHaveLength(2);
  });

  it('source is "fallback", and no network call is made, when client is null (no model configured)', async () => {
    const input = inputFor();
    const { output, source } = await analyse(input, null);
    expect(source).toBe("fallback");
    // The deterministic fallback, built purely from reason codes.
    expect(output.headline).toBe(
      "Logitech G Pro X Superlight 2 is the top match for your hand.",
    );
  });

  it('a low-confidence answer that includes the provisional caveat still reports source "model"', async () => {
    const input = inputFor(0.4);
    const answer = JSON.stringify({
      headline: "A likely match, though provisional.",
      whyTopPick: "It fits.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [
        "This ranking is provisional — some descriptors aren't classified yet.",
      ],
    });
    const client = new FakeTextModel({ answer: () => answer });
    const { source } = await analyse(input, client);
    expect(source).toBe("model");
  });

  it('source is never derived from key/client presence alone: a configured client that fails twice still reports "fallback"', async () => {
    // A non-null client is provided (as if GEMINI_API_KEY were set and the
    // call went through), yet every attempt is rejected — source must still
    // be "fallback", proving it is not read off `client !== null`.
    const input = inputFor();
    const client = new FakeTextModel({
      answer: () => JSON.stringify({ oops: true }),
    });
    const { source } = await analyse(input, client);
    expect(client).not.toBeNull();
    expect(source).toBe("fallback");
  });
});

// M2 (hardening finding): the site-wide daily model cap used to be spent
// once per REQUEST, but analyse() can make up to MAX_ATTEMPTS (2) real
// model calls per request (one attempt plus one retry), so the real
// ceiling was ~2x the configured cap. `beforeModelCall` fixes that by
// charging the budget once per actual call.
describe("analyse — beforeModelCall (M2 global model-call budget)", () => {
  it("a clean first attempt consumes exactly one unit", async () => {
    const input = inputFor();
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    let calls = 0;
    const { source } = await analyse(input, client, {
      beforeModelCall: () => {
        calls += 1;
        return true;
      },
    });
    expect(source).toBe("model");
    expect(calls).toBe(1);
    expect(client.calls).toHaveLength(1);
  });

  it("a retry (the second real model call) consumes a second unit", async () => {
    const input = inputFor();
    const badAnswer = JSON.stringify({
      headline: "A 130 mm mouse for your hand.", // 130 is not in the input
      whyTopPick: "It fits well.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({
      answer: (_args, callIndex) =>
        callIndex === 0 ? badAnswer : CLEAN_ANSWER,
    });
    let calls = 0;
    const { source } = await analyse(input, client, {
      beforeModelCall: () => {
        calls += 1;
        return true;
      },
    });
    expect(source).toBe("model");
    expect(calls).toBe(2);
    expect(client.calls).toHaveLength(2);
  });

  it("refuses the very first call when the budget is already exhausted -- 0 model calls, fallback", async () => {
    const input = inputFor();
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const { output, source } = await analyse(input, client, {
      beforeModelCall: () => false,
    });
    expect(source).toBe("fallback");
    expect(client.calls).toHaveLength(0);
    expect(output.headline).toBe(
      "Logitech G Pro X Superlight 2 is the top match for your hand.",
    );
  });

  it("cap reached before the retry: stops retrying and serves the fallback WITHOUT a second model call", async () => {
    const input = inputFor();
    // First attempt violates the no-new-numerals rule, which would
    // normally trigger a retry.
    const badAnswer = JSON.stringify({
      headline: "A 130 mm mouse for your hand.",
      whyTopPick: "It fits well.",
      tradeoffs: [],
      whatToAvoid: [],
      caveats: [],
    });
    const client = new FakeTextModel({ answer: () => badAnswer });
    let calls = 0;
    const { source } = await analyse(input, client, {
      // Budget allows the first attempt, but is exhausted by the time the
      // retry would run.
      beforeModelCall: () => {
        calls += 1;
        return calls === 1;
      },
    });
    expect(source).toBe("fallback");
    // Only the first attempt actually called the model -- the retry never
    // happened because the budget said no.
    expect(client.calls).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it("without beforeModelCall, no budget is ever consulted (existing callers are unaffected)", async () => {
    const input = inputFor();
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const { source } = await analyse(input, client);
    expect(source).toBe("model");
    expect(client.calls).toHaveLength(1);
  });
});
