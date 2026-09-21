import { describe, expect, it } from "vitest";
import { analyse, buildPrompt, LOW_CONFIDENCE_THRESHOLD } from "../../src/server/analysis/analyse";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { FakeTextModel } from "../../src/server/analysis/client";
import { makeFit, makeMeasurements } from "./analysis-fixtures";

function inputFor(confidence = 0.9) {
  const fit = makeFit({
    results: [
      { ...makeFit().results[0]!, confidence },
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
      answer: (_args, callIndex) => (callIndex === 0 ? badAnswer : CLEAN_ANSWER),
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
    const client = new FakeTextModel({ answer: () => JSON.stringify({ oops: true }) });
    const output = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(output.headline).toContain("top match");
  });
});

describe("analyse — low confidence", () => {
  it("the prompt says descriptors are provisional when confidence is below the threshold", () => {
    const input = inputFor(0.4);
    expect(input.topPicks[0]!.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
    const prompt = buildPrompt(input);
    expect(prompt).toMatch(/provisional/i);
  });

  it("does not add the provisional instruction at high confidence", () => {
    const input = inputFor(0.9);
    const prompt = buildPrompt(input);
    expect(prompt).not.toMatch(/provisional/i);
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
      caveats: ["This ranking is provisional — some descriptors aren't classified yet."],
    });
    const client = new FakeTextModel({
      answer: (_args, callIndex) => (callIndex === 0 ? missingCaveat : withCaveat),
    });
    const output = await analyse(input, client);
    expect(client.calls).toHaveLength(2);
    expect(output.caveats.some((c) => /provisional/i.test(c))).toBe(true);
  });

  it("the fallback's caveats mention low confidence", async () => {
    const input = inputFor(0.4);
    const client = new FakeTextModel({
      answer: () => JSON.stringify({ headline: "x", whyTopPick: "x", tradeoffs: [], whatToAvoid: [], caveats: [] }),
    });
    const output = await analyse(input, client);
    expect(output.caveats.some((c) => /provisional/i.test(c))).toBe(true);
  });
});
