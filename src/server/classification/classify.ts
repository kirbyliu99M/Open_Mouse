/**
 * M1 classification flow — pure orchestration over `VisionClassifier`. No
 * network, no filesystem; image bytes and the classifier are supplied by the
 * caller (see scripts/classify-descriptors.ts).
 */
import {
  FRONT_FLARES,
  HAND_COMPATIBILITY,
  HUMP_PLACEMENTS,
  SHAPES,
  SIDE_CURVATURES,
  type FrontFlare,
  type HandCompatibility,
  type HumpPlacement,
  type Shape,
  type SideCurvature,
} from "../../lib/contracts/descriptors";
import { checkConsistency, type DescriptorSet } from "../catalogue/consistency";
import type { ImageInput, ImageView, VisionClassifier } from "./gemini";
import {
  ALL_DESCRIPTORS,
  DESCRIPTOR_VIEWS,
  frontFlarePrompt,
  handCompatibilityPrompt,
  humpPlacementPrompt,
  ringFingerRestPrompt,
  shapePrompt,
  sideCurvaturePrompt,
  thumbRestPrompt,
  type Descriptor,
} from "./prompts";

export interface ClassificationInput {
  model: string;
  images: ImageInput[];
}

export interface ClassificationResult {
  model: string;
  shape: Shape | null;
  handCompatibility: HandCompatibility | null;
  humpPlacement: HumpPlacement | null;
  frontFlare: FrontFlare | null;
  sideCurvature: SideCurvature | null;
  thumbRest: boolean | null;
  ringFingerRest: boolean | null;
  sourceImageUrls: string[];
  descriptorModel: string;
  classifiedAt: string;
  needsReview: boolean;
  notes: string[];
}

/** Which fields a rubric §2 rule implicates — these are what get reclassified. */
const RULE_IMPLICATED_FIELDS: Readonly<Record<string, readonly Descriptor[]>> =
  {
    ambidextrous_is_symmetrical: ["shape", "handCompatibility"],
    thumb_rest_is_ergonomic: ["shape", "thumbRest"],
    ring_rest_is_ergonomic: ["shape", "ringFingerRest"],
  };

function groupByView(
  images: ImageInput[],
  views: ImageView[],
): Map<ImageView, ImageInput[]> {
  const map = new Map<ImageView, ImageInput[]>();
  images.forEach((img, i) => {
    const view = views[i]!;
    const list = map.get(view) ?? [];
    list.push(img);
    map.set(view, list);
  });
  return map;
}

/** Union of images across every view the descriptor is allowed to use. */
function imagesForViews(
  byView: Map<ImageView, ImageInput[]>,
  required: readonly ImageView[],
): ImageInput[] {
  return required.flatMap((v) => byView.get(v) ?? []);
}

type DescriptorValues = {
  shape: Shape | null;
  handCompatibility: HandCompatibility | null;
  humpPlacement: HumpPlacement | null;
  frontFlare: FrontFlare | null;
  sideCurvature: SideCurvature | null;
  thumbRest: boolean | null;
  ringFingerRest: boolean | null;
};

const EMPTY_VALUES: DescriptorValues = {
  shape: null,
  handCompatibility: null,
  humpPlacement: null,
  frontFlare: null,
  sideCurvature: null,
  thumbRest: null,
  ringFingerRest: null,
};

export async function classifyMouse(
  classifier: VisionClassifier,
  input: ClassificationInput,
  now: () => Date = () => new Date(),
): Promise<ClassificationResult> {
  const notes: string[] = [];
  const sourceImageUrls = input.images.map((i) => i.url);

  if (input.images.length === 0) {
    notes.push("no images discovered — every descriptor left null");
    return {
      model: input.model,
      ...EMPTY_VALUES,
      sourceImageUrls,
      descriptorModel: classifier.modelName,
      classifiedAt: now().toISOString(),
      needsReview: false,
      notes,
    };
  }

  const views = await classifier.tagViews(input.images);
  const byView = groupByView(input.images, views);
  const values: DescriptorValues = { ...EMPTY_VALUES };

  async function classifyOne(
    descriptor: Descriptor,
    violation?: string,
  ): Promise<void> {
    const required = DESCRIPTOR_VIEWS[descriptor];
    const relevant = imagesForViews(byView, required);
    if (relevant.length === 0) {
      notes.push(
        `${descriptor}: no ${required.join("/")} image available — left null`,
      );
      return;
    }
    switch (descriptor) {
      case "shape":
        values.shape = await classifier.classifyEnum({
          prompt: shapePrompt(violation),
          enumValues: SHAPES,
          images: relevant,
        });
        return;
      case "handCompatibility":
        values.handCompatibility = await classifier.classifyEnum({
          prompt: handCompatibilityPrompt(violation),
          enumValues: HAND_COMPATIBILITY,
          images: relevant,
        });
        return;
      case "humpPlacement":
        values.humpPlacement = await classifier.classifyEnum({
          prompt: humpPlacementPrompt(violation),
          enumValues: HUMP_PLACEMENTS,
          images: relevant,
        });
        return;
      case "frontFlare":
        values.frontFlare = await classifier.classifyEnum({
          prompt: frontFlarePrompt(violation),
          enumValues: FRONT_FLARES,
          images: relevant,
        });
        return;
      case "sideCurvature":
        values.sideCurvature = await classifier.classifyEnum({
          prompt: sideCurvaturePrompt(violation),
          enumValues: SIDE_CURVATURES,
          images: relevant,
        });
        return;
      case "thumbRest":
        values.thumbRest = await classifier.classifyBoolean({
          prompt: thumbRestPrompt(violation),
          images: relevant,
        });
        return;
      case "ringFingerRest":
        values.ringFingerRest = await classifier.classifyBoolean({
          prompt: ringFingerRestPrompt(violation),
          images: relevant,
        });
        return;
    }
  }

  for (const descriptor of ALL_DESCRIPTORS) await classifyOne(descriptor);

  const consistencySet = (): DescriptorSet => ({
    shape: values.shape,
    handCompatibility: values.handCompatibility,
    thumbRest: values.thumbRest,
    ringFingerRest: values.ringFingerRest,
  });

  let needsReview = false;
  let violations = checkConsistency(consistencySet());
  if (violations.length > 0) {
    const implicated = new Set<Descriptor>();
    for (const v of violations)
      for (const field of RULE_IMPLICATED_FIELDS[v.rule] ?? [])
        implicated.add(field);
    const message = violations.map((v) => v.message).join(" ");
    for (const field of implicated) await classifyOne(field, message);

    violations = checkConsistency(consistencySet());
    if (violations.length > 0) {
      needsReview = true;
      notes.push(
        `still violates rubric §2 after reclassification: ${violations
          .map((v) => v.message)
          .join(" ")}`,
      );
    }
  }

  return {
    model: input.model,
    ...values,
    sourceImageUrls,
    descriptorModel: classifier.modelName,
    classifiedAt: now().toISOString(),
    needsReview,
    notes,
  };
}
