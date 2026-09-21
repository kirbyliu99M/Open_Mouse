import { describe, expect, it } from "vitest";
import {
  FRONT_FLARES,
  HUMP_PLACEMENTS,
  SIDE_CURVATURES,
} from "../../src/lib/contracts/descriptors";
import { classifyMouse } from "../../src/server/classification/classify";
import {
  FakeVisionClassifier,
  type ImageInput,
  type ImageView,
} from "../../src/server/classification/gemini";

const img = (url: string): ImageInput => ({
  url,
  bytes: new Uint8Array(),
  mimeType: "image/png",
});

function viewFromUrlPrefix(url: string): ImageView {
  if (url.startsWith("side")) return "side";
  if (url.startsWith("top")) return "top";
  if (url.startsWith("front")) return "front";
  if (url.startsWith("rear")) return "rear";
  return "other";
}

function findCall(classifier: FakeVisionClassifier, promptSubstring: string) {
  return classifier.calls.filter(
    (c) => c.kind !== "tagViews" && c.prompt?.includes(promptSubstring),
  );
}

describe("classifyMouse — view routing", () => {
  it("gives each descriptor only the images from its designated view(s)", async () => {
    const images = [img("side-1"), img("top-1"), img("front-1"), img("rear-1")];
    const classifier = new FakeVisionClassifier({
      views: (imgs) => imgs.map((i) => viewFromUrlPrefix(i.url)),
    });

    const result = await classifyMouse(classifier, {
      model: "Test Mouse",
      images,
    });

    const urlsFor = (substring: string) => {
      const calls = findCall(classifier, substring);
      expect(calls).toHaveLength(1);
      return calls[0]!.images.map((i) => i.url);
    };

    expect(urlsFor("Classify Hump placement")).toEqual(["side-1"]);
    expect(urlsFor("Classify Front flare")).toEqual(["top-1"]);
    expect(urlsFor("Classify Side curvature")).toEqual(["front-1", "rear-1"]);
    expect(urlsFor("Classify Shape")).toEqual(["top-1", "front-1"]);
    expect(urlsFor("Classify Hand compatibility")).toEqual([
      "top-1",
      "front-1",
    ]);
    expect(urlsFor("Thumb rest")).toEqual(["top-1", "side-1"]);
    expect(urlsFor("Ring finger rest")).toEqual(["top-1", "side-1"]);

    // 1 tagViews call + 1 call per descriptor, no consistency retries triggered.
    expect(classifier.calls).toHaveLength(8);
    expect(result.needsReview).toBe(false);
  });
});

describe("classifyMouse — missing views", () => {
  it("leaves every descriptor null and records why when no relevant view exists", async () => {
    const classifier = new FakeVisionClassifier({
      views: () => ["other"],
    });
    const result = await classifyMouse(classifier, {
      model: "Mystery Mouse",
      images: [img("mystery-1")],
    });

    expect(result).toMatchObject({
      shape: null,
      handCompatibility: null,
      humpPlacement: null,
      frontFlare: null,
      sideCurvature: null,
      thumbRest: null,
      ringFingerRest: null,
      needsReview: false,
    });
    expect(result.notes).toHaveLength(7);
    for (const note of result.notes) expect(note).toMatch(/left null/);
    // Never guessed: no descriptor call was made at all, only the view tag.
    expect(classifier.calls).toHaveLength(1);
    expect(classifier.calls[0]!.kind).toBe("tagViews");
  });

  it("nulls only the descriptors whose views are missing, classifying the rest", async () => {
    const images = [img("top-1"), img("front-1"), img("rear-1")];
    const classifier = new FakeVisionClassifier({
      views: (imgs) => imgs.map((i) => viewFromUrlPrefix(i.url)),
    });
    const result = await classifyMouse(classifier, {
      model: "No Side Shot",
      images,
    });

    expect(result.humpPlacement).toBeNull();
    expect(
      result.notes.some(
        (n) => n.includes("humpPlacement") && n.includes("side"),
      ),
    ).toBe(true);
    // frontFlare (top) and sideCurvature (front/rear) had views available.
    expect(result.frontFlare).not.toBeNull();
    expect(result.sideCurvature).not.toBeNull();
  });

  it("returns an empty result without calling the classifier when no images were discovered", async () => {
    const classifier = new FakeVisionClassifier();
    const result = await classifyMouse(classifier, {
      model: "No Images",
      images: [],
    });
    expect(result.needsReview).toBe(false);
    expect(result.sourceImageUrls).toEqual([]);
    expect(classifier.calls).toHaveLength(0);
    expect(result.notes[0]).toMatch(/no images discovered/);
  });
});

describe("classifyMouse — consistency retry", () => {
  const routingImages = [img("top-1"), img("front-1")];
  const views: ImageView[] = ["top", "front"];

  it("reclassifies implicated descriptors once and clears needsReview if the retry resolves the violation", async () => {
    let shapeAnswers = 0;
    const classifier = new FakeVisionClassifier({
      views: () => views,
      enumAnswer: (args) => {
        if (args.prompt.includes("Classify Hand compatibility"))
          return "ambidextrous";
        if (args.prompt.includes("Classify Shape")) {
          shapeAnswers++;
          return shapeAnswers === 1 ? "ergonomic" : "symmetrical";
        }
        return args.enumValues[0]!;
      },
    });

    const result = await classifyMouse(classifier, {
      model: "Fixable Mouse",
      images: routingImages,
    });

    expect(shapeAnswers).toBe(2); // initial + one reclassification
    expect(findCall(classifier, "Classify Hand compatibility")).toHaveLength(2);
    expect(result.shape).toBe("symmetrical");
    expect(result.handCompatibility).toBe("ambidextrous");
    expect(result.needsReview).toBe(false);
  });

  it("sets needsReview when the violation persists after one retry, and keeps the values for the record", async () => {
    const classifier = new FakeVisionClassifier({
      views: () => views,
      enumAnswer: (args) => {
        if (args.prompt.includes("Classify Hand compatibility"))
          return "ambidextrous";
        if (args.prompt.includes("Classify Shape")) return "ergonomic";
        return args.enumValues[0]!;
      },
    });

    const result = await classifyMouse(classifier, {
      model: "Stubborn Mouse",
      images: routingImages,
    });

    // Reclassified exactly once, per the rubric ("reclassify... once").
    expect(findCall(classifier, "Classify Shape")).toHaveLength(2);
    expect(findCall(classifier, "Classify Hand compatibility")).toHaveLength(2);
    expect(result.needsReview).toBe(true);
    expect(result.shape).toBe("ergonomic");
    expect(result.handCompatibility).toBe("ambidextrous");
    expect(result.notes.some((n) => n.includes("still violates"))).toBe(true);
  });

  it("passes the violation message into the reclassification prompt", async () => {
    const classifier = new FakeVisionClassifier({
      views: () => views,
      enumAnswer: (args) => {
        if (args.prompt.includes("Classify Hand compatibility"))
          return "ambidextrous";
        if (args.prompt.includes("Classify Shape")) return "ergonomic";
        return args.enumValues[0]!;
      },
    });
    await classifyMouse(classifier, { model: "M", images: routingImages });
    const retryCall = findCall(classifier, "Classify Shape")[1]!;
    expect(retryCall.prompt).toMatch(/violated a consistency rule/);
    expect(retryCall.prompt).toMatch(/ambidextrous mouse must be symmetrical/);
  });
});

describe("classifyMouse — output shape", () => {
  it("produces fields compatible with validate-rubric's --predictions format", async () => {
    const classifier = new FakeVisionClassifier({
      views: (imgs) => imgs.map((i) => viewFromUrlPrefix(i.url)),
    });
    const result = await classifyMouse(classifier, {
      model: "G Pro X Superlight 2",
      images: [img("side-1"), img("top-1"), img("front-1"), img("rear-1")],
    });
    const roundTripped = JSON.parse(JSON.stringify([result])) as Array<{
      model: string;
      humpPlacement?: string | null;
      frontFlare?: string | null;
      sideCurvature?: string | null;
    }>;
    const [row] = roundTripped;
    expect(typeof row!.model).toBe("string");
    if (row!.humpPlacement !== null)
      expect(HUMP_PLACEMENTS).toContain(row!.humpPlacement);
    if (row!.frontFlare !== null)
      expect(FRONT_FLARES).toContain(row!.frontFlare);
    if (row!.sideCurvature !== null)
      expect(SIDE_CURVATURES).toContain(row!.sideCurvature);
  });
});
