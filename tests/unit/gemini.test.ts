import { describe, expect, it } from "vitest";
import {
  FakeVisionClassifier,
  GeminiResponseError,
  parseBooleanResponse,
  parseEnumResponse,
  parseViewsResponse,
  type ImageInput,
} from "../../src/server/classification/gemini";

const FRONT_FLARES = ["inward_slight", "flat", "outward_slight"] as const;
const img = (url: string): ImageInput => ({
  url,
  bytes: new Uint8Array(),
  mimeType: "image/png",
});

describe("parseEnumResponse", () => {
  it("accepts a value on the enum, wrapped or bare", () => {
    expect(
      parseEnumResponse(JSON.stringify({ value: "flat" }), FRONT_FLARES),
    ).toBe("flat");
    expect(parseEnumResponse(JSON.stringify("flat"), FRONT_FLARES)).toBe(
      "flat",
    );
  });

  it("rejects an off-enum value rather than accepting it", () => {
    expect(() =>
      parseEnumResponse(
        JSON.stringify({ value: "diagonal_extreme" }),
        FRONT_FLARES,
      ),
    ).toThrow(GeminiResponseError);
  });

  it("rejects non-JSON and non-string output", () => {
    expect(() => parseEnumResponse("not json", FRONT_FLARES)).toThrow(
      GeminiResponseError,
    );
    expect(() =>
      parseEnumResponse(JSON.stringify({ value: 3 }), FRONT_FLARES),
    ).toThrow(GeminiResponseError);
  });
});

describe("parseBooleanResponse", () => {
  it("accepts true/false", () => {
    expect(parseBooleanResponse(JSON.stringify({ value: true }))).toBe(true);
    expect(parseBooleanResponse(JSON.stringify({ value: false }))).toBe(false);
  });

  it("rejects a non-boolean value", () => {
    expect(() =>
      parseBooleanResponse(JSON.stringify({ value: "yes" })),
    ).toThrow(GeminiResponseError);
  });
});

describe("parseViewsResponse", () => {
  it("accepts one view per image, in order", () => {
    expect(
      parseViewsResponse(
        JSON.stringify({ views: ["side", "top", "other"] }),
        3,
      ),
    ).toEqual(["side", "top", "other"]);
  });

  it("rejects a count mismatch", () => {
    expect(() =>
      parseViewsResponse(JSON.stringify({ views: ["side"] }), 2),
    ).toThrow(GeminiResponseError);
  });

  it("rejects an off-enum view", () => {
    expect(() =>
      parseViewsResponse(JSON.stringify({ views: ["diagonal"] }), 1),
    ).toThrow(GeminiResponseError);
  });
});

describe("FakeVisionClassifier", () => {
  it("defaults to tagging every image 'other' and answering the first enum value", async () => {
    const classifier = new FakeVisionClassifier();
    const images = [img("a"), img("b")];
    expect(await classifier.tagViews(images)).toEqual(["other", "other"]);
    expect(
      await classifier.classifyEnum({
        prompt: "p",
        enumValues: FRONT_FLARES,
        images,
      }),
    ).toBe("inward_slight");
    expect(await classifier.classifyBoolean({ prompt: "p", images })).toBe(
      false,
    );
  });

  it("routes configured answers through real enum enforcement, rejecting off-enum answers", async () => {
    const classifier = new FakeVisionClassifier({
      enumAnswer: () => "not_a_real_level",
    });
    await expect(
      classifier.classifyEnum({
        prompt: "p",
        enumValues: FRONT_FLARES,
        images: [img("a")],
      }),
    ).rejects.toThrow(GeminiResponseError);
  });

  it("records every call for view-routing assertions", async () => {
    const classifier = new FakeVisionClassifier();
    const images = [img("a"), img("b")];
    await classifier.classifyEnum({
      prompt: "descriptor prompt",
      enumValues: FRONT_FLARES,
      images: [images[0]!],
    });
    expect(classifier.calls).toEqual([
      { kind: "enum", prompt: "descriptor prompt", images: [images[0]] },
    ]);
  });
});
