import { describe, expect, it } from "vitest";
import {
  analyse,
  buildFallbackOutput,
} from "../../src/server/analysis/analyse";
import { FakeTextModel } from "../../src/server/analysis/client";
import { buildAnalysisInput } from "../../src/server/analysis/input";
import { analysisOutputSchema } from "../../src/server/analysis/schema";
import {
  collectNumbers,
  findUnknownNumeral,
  stringTokens,
} from "../../src/server/analysis/numerals";
import { findMedicalClaimTerm } from "../../src/server/analysis/medicalClaims";
import { makeEntry, makeFit, makeMeasurements } from "./analysis-fixtures";

const inputWith = (fit = makeFit()) =>
  buildAnalysisInput(fit, makeMeasurements());

function entryWithoutPositiveReasons() {
  const entry = makeEntry();
  return makeEntry({
    mouse: {
      ...entry.mouse,
      slug: "example-mouse",
      brand: "Example",
      model: "Mouse",
    },
    subscores: Object.fromEntries(
      Object.entries(entry.subscores).map(([key, sub]) => [
        key,
        { ...sub, reason: { code: "no_preference", params: {} } },
      ]),
    ) as typeof entry.subscores,
  });
}

async function expectAcceptedByModelChecks(
  input: ReturnType<typeof inputWith>,
) {
  const output = buildFallbackOutput(input);
  expect(analysisOutputSchema.safeParse(output).success).toBe(true);
  const exemptTokens = new Set(
    [...input.topPicks, ...input.excluded].flatMap(({ brand, model }) => [
      ...stringTokens(brand),
      ...stringTokens(model),
    ]),
  );
  for (const text of [
    output.headline,
    output.whyTopPick,
    ...output.tradeoffs,
    ...output.whatToAvoid,
    ...output.caveats,
  ]) {
    expect(findMedicalClaimTerm(text)).toBeNull();
    expect(
      findUnknownNumeral(text, collectNumbers(input), exemptTokens),
    ).toBeNull();
  }
  const client = new FakeTextModel({ answer: () => JSON.stringify(output) });
  const result = await analyse(input, client);
  expect(result.source).toBe("model");
  expect(client.calls).toHaveLength(1);
}

describe("buildFallbackOutput", () => {
  it("uses an excluded mouse and its reason in whatToAvoid, not the top pick's tradeoff", async () => {
    const input = inputWith();
    const output = buildFallbackOutput(input);
    expect(output.tradeoffs).toContain(
      "Its front flare may crowd your fingertips",
    );
    expect(output.whatToAvoid).toEqual([
      "Logitech Lift Vertical: vertical shape, excluded from this comparison.",
    ]);
    await expectAcceptedByModelChecks(input);
  });

  it("never puts a runner-up top pick in whatToAvoid", async () => {
    const lower = makeEntry({
      rank: 2,
      mouse: {
        ...makeEntry().mouse,
        slug: "example-other-mouse",
        brand: "Example",
        model: "Other Mouse",
      },
      subscores: {
        ...makeEntry().subscores,
        gripWidth: {
          ...makeEntry().subscores.gripWidth,
          reason: { code: "width_narrow", params: {} },
        },
        frontFlare: {
          ...makeEntry().subscores.frontFlare,
          reason: { code: "flare_neutral", params: {} },
        },
      },
    });
    const input = inputWith(
      makeFit({ excluded: [], results: [makeEntry(), lower] }),
    );
    expect(buildFallbackOutput(input).whatToAvoid).toEqual([]);
    await expectAcceptedByModelChecks(input);
  });

  it("does not fill a single exclusion with a runner-up's negative reason", async () => {
    const lower = makeEntry({
      rank: 2,
      mouse: {
        ...makeEntry().mouse,
        slug: "example-other-mouse",
        brand: "Example",
        model: "Other Mouse",
      },
    });
    const input = inputWith(makeFit({ results: [makeEntry(), lower] }));
    expect(buildFallbackOutput(input).whatToAvoid).toEqual([
      "Logitech Lift Vertical: vertical shape, excluded from this comparison.",
    ]);
    await expectAcceptedByModelChecks(input);
  });

  it("returns no avoid items when only the top pick has a negative reason", async () => {
    const input = inputWith(makeFit({ excluded: [] }));
    expect(buildFallbackOutput(input).whatToAvoid).toEqual([]);
    await expectAcceptedByModelChecks(input);
  });

  it("omits the grip clause when grip style was predicted", async () => {
    const input = inputWith(
      makeFit({ excluded: [], results: [entryWithoutPositiveReasons()] }),
    );
    expect(buildFallbackOutput(input).whyTopPick).toBe(
      "It's the top pick based on your measurements.",
    );
    await expectAcceptedByModelChecks(input);
  });

  it("keeps the existing grip clause when grip style was stated", async () => {
    const input = inputWith(
      makeFit({
        gripStyle: { stated: "claw", predicted: "palm", used: "claw" },
        results: [entryWithoutPositiveReasons()],
      }),
    );
    expect(buildFallbackOutput(input).whyTopPick).toBe(
      "It's the top pick based on your measurements and grip style.",
    );
    await expectAcceptedByModelChecks(input);
  });
});
