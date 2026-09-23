/**
 * Gemini vision client, behind an interface `classify.ts` codes against.
 *
 * `GeminiVisionClassifier` is the real implementation; it is never exercised
 * in tests — there is no API key in CI and the real API must never be called
 * from this repo. `FakeVisionClassifier` (tests/unit only) implements the
 * same interface from a canned answer table.
 */
import {
  GoogleGenAI,
  ThinkingLevel,
  Type,
  createPartFromBase64,
  createUserContent,
  type Part,
} from "@google/genai";

export type ImageView = "side" | "top" | "front" | "rear" | "other";
export const IMAGE_VIEWS: readonly ImageView[] = [
  "side",
  "top",
  "front",
  "rear",
  "other",
];

export interface ImageInput {
  url: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface ClassifyEnumArgs<T extends string> {
  /** Rubric definition + levels + (for flare/curvature) distribution priors. */
  prompt: string;
  enumValues: readonly T[];
  images: ImageInput[];
}

export interface ClassifyBooleanArgs {
  prompt: string;
  images: ImageInput[];
}

/**
 * Everything `classify.ts` needs from Gemini. One call per descriptor, images
 * scoped to what's relevant — never the whole gallery at once (rubric
 * "Applying the rubric" / M1 prompting notes: accuracy degrades when a model
 * answers all eight descriptors from every image in one call).
 */
export interface VisionClassifier {
  readonly modelName: string;
  /** One call per model: tags each image's view, same order as `images`. */
  tagViews(images: ImageInput[]): Promise<ImageView[]>;
  classifyEnum<T extends string>(args: ClassifyEnumArgs<T>): Promise<T>;
  classifyBoolean(args: ClassifyBooleanArgs): Promise<boolean>;
}

export class GeminiResponseError extends Error {}

/**
 * Validates a structured-output string against a closed enum. Exported and
 * pure so enum enforcement is testable without a network call: a model that
 * (despite the schema) returns something off-enum is rejected here, not
 * silently accepted.
 */
export function parseEnumResponse<T extends string>(
  raw: string,
  enumValues: readonly T[],
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GeminiResponseError(`Gemini returned non-JSON output: ${raw}`);
  }
  const value =
    typeof parsed === "object" && parsed !== null && "value" in parsed
      ? (parsed as { value: unknown }).value
      : parsed;
  if (
    typeof value !== "string" ||
    !(enumValues as readonly string[]).includes(value)
  ) {
    throw new GeminiResponseError(
      `Gemini returned an off-enum value ${JSON.stringify(value)}; expected one of ${enumValues.join(", ")}.`,
    );
  }
  return value as T;
}

/** Same enforcement, for the boolean descriptors (thumb rest, ring rest). */
export function parseBooleanResponse(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GeminiResponseError(`Gemini returned non-JSON output: ${raw}`);
  }
  const value =
    typeof parsed === "object" && parsed !== null && "value" in parsed
      ? (parsed as { value: unknown }).value
      : parsed;
  if (typeof value !== "boolean") {
    throw new GeminiResponseError(
      `Gemini returned a non-boolean value ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

/** Tags in view-array order; extra/missing tags relative to `count` are rejected. */
export function parseViewsResponse(raw: string, count: number): ImageView[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GeminiResponseError(`Gemini returned non-JSON output: ${raw}`);
  }
  const views =
    typeof parsed === "object" && parsed !== null && "views" in parsed
      ? (parsed as { views: unknown }).views
      : parsed;
  if (!Array.isArray(views) || views.length !== count) {
    throw new GeminiResponseError(
      `Gemini returned ${Array.isArray(views) ? views.length : "non-array"} view tags for ${count} images.`,
    );
  }
  return views.map((v, i) => {
    if (typeof v !== "string" || !IMAGE_VIEWS.includes(v as ImageView)) {
      throw new GeminiResponseError(
        `Gemini returned an off-enum view ${JSON.stringify(v)} at image ${i}.`,
      );
    }
    return v as ImageView;
  });
}

function imageParts(images: ImageInput[]): Part[] {
  return images.map((img) =>
    createPartFromBase64(
      Buffer.from(img.bytes).toString("base64"),
      img.mimeType,
    ),
  );
}

/**
 * Real Gemini implementation, using `@google/genai`. Model from
 * `GEMINI_MODEL` (default `gemini-3.8-flash`), key from `GEMINI_API_KEY`.
 * This is a closed-vocabulary classification task, not a reasoning one.
 *
 * Thinking is `ThinkingLevel.LOW`, the lowest level `gemini-3.8-flash`
 * accepts. The SDK's types also offer `MINIMAL`, but the live API rejects it
 * for this model — "Thinking level MINIMAL is not supported for this model"
 * (400, verified against the API on 2026-09-23) — and that error took the
 * analysis route down in production. Types are not evidence of what the API
 * accepts. Output billing includes thinking tokens, and thinking counts
 * against `maxOutputTokens`, so keep it at the lowest accepted level.
 */
export class GeminiVisionClassifier implements VisionClassifier {
  private readonly client: GoogleGenAI;
  readonly modelName: string;

  constructor(apiKey: string, modelName: string) {
    this.client = new GoogleGenAI({ apiKey });
    this.modelName = modelName;
  }

  private async generate(prompt: string, images: ImageInput[], schema: object) {
    const response = await this.client.models.generateContent({
      model: this.modelName,
      contents: [createUserContent([prompt, ...imageParts(images)])],
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    const text = response.text;
    if (!text)
      throw new GeminiResponseError("Gemini returned an empty response.");
    return text;
  }

  async tagViews(images: ImageInput[]): Promise<ImageView[]> {
    const text = await this.generate(
      `Tag the view shown in each of the following ${images.length} product images, in order. ` +
        `One of: ${IMAGE_VIEWS.join(", ")}. "side" is a square-on profile shot; "top" looks straight ` +
        `down at the deck; "front" and "rear" are square-on end shots; use "other" for angled, ` +
        `bottom, exploded or lifestyle shots.`,
      images,
      {
        type: Type.OBJECT,
        properties: {
          views: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
              format: "enum",
              enum: [...IMAGE_VIEWS],
            },
          },
        },
        required: ["views"],
      },
    );
    return parseViewsResponse(text, images.length);
  }

  async classifyEnum<T extends string>(args: ClassifyEnumArgs<T>): Promise<T> {
    const text = await this.generate(args.prompt, args.images, {
      type: Type.OBJECT,
      properties: {
        value: {
          type: Type.STRING,
          format: "enum",
          enum: [...args.enumValues],
        },
      },
      required: ["value"],
    });
    return parseEnumResponse(text, args.enumValues);
  }

  async classifyBoolean(args: ClassifyBooleanArgs): Promise<boolean> {
    const text = await this.generate(args.prompt, args.images, {
      type: Type.OBJECT,
      properties: { value: { type: Type.BOOLEAN } },
      required: ["value"],
    });
    return parseBooleanResponse(text);
  }
}

export interface FakeVisionClassifierConfig {
  modelName?: string;
  /** Defaults to tagging every image "other". */
  views?: (images: ImageInput[]) => ImageView[] | Promise<ImageView[]>;
  /** Defaults to the first enum value — override to test specific answers. */
  enumAnswer?: (args: ClassifyEnumArgs<string>) => string | Promise<string>;
  /** Defaults to false. */
  booleanAnswer?: (args: ClassifyBooleanArgs) => boolean | Promise<boolean>;
}

export interface FakeVisionClassifierCall {
  kind: "tagViews" | "enum" | "boolean";
  prompt?: string;
  images: ImageInput[];
}

/**
 * In-memory `VisionClassifier` for tests. Routes every canned answer through
 * the same `parseEnumResponse` / `parseBooleanResponse` validators the real
 * client uses, so a test configured to return an off-enum value exercises
 * real enforcement rather than a test-only shortcut. Records every call so
 * tests can assert view routing (which images each descriptor call received).
 */
export class FakeVisionClassifier implements VisionClassifier {
  readonly modelName: string;
  readonly calls: FakeVisionClassifierCall[] = [];

  constructor(private readonly config: FakeVisionClassifierConfig = {}) {
    this.modelName = config.modelName ?? "fake-vision-model";
  }

  async tagViews(images: ImageInput[]): Promise<ImageView[]> {
    this.calls.push({ kind: "tagViews", images });
    const views = this.config.views
      ? await this.config.views(images)
      : images.map((): ImageView => "other");
    return parseViewsResponse(JSON.stringify({ views }), images.length);
  }

  async classifyEnum<T extends string>(args: ClassifyEnumArgs<T>): Promise<T> {
    this.calls.push({ kind: "enum", prompt: args.prompt, images: args.images });
    const raw = this.config.enumAnswer
      ? await this.config.enumAnswer(args)
      : args.enumValues[0]!;
    return parseEnumResponse(JSON.stringify({ value: raw }), args.enumValues);
  }

  async classifyBoolean(args: ClassifyBooleanArgs): Promise<boolean> {
    this.calls.push({
      kind: "boolean",
      prompt: args.prompt,
      images: args.images,
    });
    const raw = this.config.booleanAnswer
      ? await this.config.booleanAnswer(args)
      : false;
    return parseBooleanResponse(JSON.stringify({ value: raw }));
  }
}

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/** Reads GEMINI_MODEL / GEMINI_API_KEY. Throws with a clear message if the key is absent. */
export function createGeminiVisionClassifier(
  env: Readonly<Record<string, string | undefined>>,
): GeminiVisionClassifier {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Classification calls the real Gemini API and needs a key.",
    );
  }
  const modelName = env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  return new GeminiVisionClassifier(apiKey, modelName);
}
