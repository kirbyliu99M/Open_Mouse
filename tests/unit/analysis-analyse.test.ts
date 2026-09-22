import { describe, expect, it } from "vitest";
import {
  analyse,
  buildPrompt,
  LOW_CONFIDENCE_THRESHOLD,
} from "../../src/server/analysis/analyse";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { FakeTextModel } from "../../src/server/analysis/client";
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

describe("analyse — no-new-numerals rule", () => {
  it("path 1: accepts a clean answer with only numbers from the input", async () => {
    const input = inputFor();
    const client = new FakeTextModel({ answer: () => CLEAN_ANSWER });
    const output = await analyse(input, client);
    expect(output.headline).toBe("A strong match for your hand.");
    expect(client.calls).toHaveLength(1);
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
    const output = await analyse(input, client);
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
    const output = await analyse(input, client);
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
    const output = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(output.headline).toContain("top match");
  });
});

describe("analyse — low confidence", () => {
  it("the prompt says descriptors are provisional when confidence is below the threshold", () => {
    const input = inputFor(0.4);
    expect(input.topPicks[0]!.confidence).toBeLessThan(
      LOW_CONFIDENCE_THRESHOLD,
    );
    const prompt = buildPrompt(input);
    expect(prompt).toMatch(/provisional/i);
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
    const output = await analyse(input, client);
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
    const output = await analyse(input, client);
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
    const output = await analyse(input, client);
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
    const output = await analyse(input, client);
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
    const output = await analyse(input, client);
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
    const output = await analyse(input, client);
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
    const output = await analyse(input, client);
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
    const output = await analyse(input, client);
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
    const output = await analyse(input, client);
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
    const output = await analyse(input, client);
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
    const output = await analyse(input, client);
    expect(client.calls).toHaveLength(1);
    expect(output.whatToAvoid[0]).toContain("third pick");
  });
});
