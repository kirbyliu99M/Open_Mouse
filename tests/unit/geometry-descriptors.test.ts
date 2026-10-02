import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { check, format } from "prettier";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HUMP_PLACEMENTS } from "../../src/lib/contracts/descriptors";
import {
  assertOnlyHumpSet,
  convertGeometryPredictions,
  convertPredictionsFile,
  FORM_FACTOR_NOTES,
  GEOMETRY_CLASSIFIED_AT,
  GEOMETRY_DESCRIPTOR_MODEL,
  GEOMETRY_PREDICTIONS_SHA256,
  GeometryConversionError,
  LOWER_CONFIDENCE_NOTE,
  NOT_IN_VALIDATION_SAMPLE,
  NOT_IN_VALIDATION_SAMPLE_NOTE,
  sha256Hex,
} from "../../src/server/catalogue/geometry-descriptors";
import { DESCRIPTORS_SEED_PATH } from "../../src/server/catalogue/seed-rows";
import { runGeometryDescriptors } from "../../scripts/descriptors-from-geometry-run";

/** One prediction as the GD-1 file writes it (measures and asset hashes trimmed). */
const prediction = (over: Record<string, unknown> = {}) => ({
  model: "G203 Lightsync",
  slug: "logitech-g203-lightsync",
  frameCaution: null,
  humpPlacement: "back_minimal",
  frontFlare: "outward_moderate",
  sideCurvature: "inward_aggressive",
  measures: { humpPeakFraction: 0.58 },
  confidence: "reconstructed",
  path: "shells/logitech-g203-lightsync.glb",
  assetSha256: "0".repeat(64),
  ...over,
});

const slugOf = (model: string) =>
  `logitech-${model.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

const noShell = (model: string, slug: string) => ({
  model,
  slug,
  frameCaution: null,
  humpPlacement: null,
  frontFlare: null,
  sideCurvature: null,
  measures: null,
  confidence: "none",
  reason: `${model}: no usable shell`,
});

describe("convertGeometryPredictions", () => {
  it("copies the hump and nothing else: flare and curvature are null whatever the input says", () => {
    const { records, skipped } = convertGeometryPredictions([prediction()]);
    expect(skipped).toEqual([]);
    expect(records).toEqual([
      {
        model: "G203 Lightsync",
        shape: null,
        handCompatibility: null,
        humpPlacement: "back_minimal",
        frontFlare: null,
        sideCurvature: null,
        thumbRest: null,
        ringFingerRest: null,
        sourceImageUrls: [],
        descriptorModel: GEOMETRY_DESCRIPTOR_MODEL,
        classifiedAt: GEOMETRY_CLASSIFIED_AT,
        needsReview: false,
      },
    ]);
  });

  it("names its provenance and date, and never marks a record for review", () => {
    expect(GEOMETRY_DESCRIPTOR_MODEL).toBe("geometry-gd1@06cc13d");
    expect(GEOMETRY_CLASSIFIED_AT).toBe("2026-10-02");
    const [record] = convertGeometryPredictions([prediction()]).records;
    expect(record?.needsReview).toBe(false);
  });

  it("gives a model with no hump no record, and reports it", () => {
    const { records, skipped } = convertGeometryPredictions([
      prediction(),
      noShell("M100", "logitech-m100"),
    ]);
    expect(records.map((r) => r.model)).toEqual(["G203 Lightsync"]);
    expect(skipped).toEqual(["M100"]);
  });

  it("keeps the order of the input", () => {
    const { records } = convertGeometryPredictions([
      prediction({ model: "G309", slug: "logitech-g309" }),
      prediction(),
    ]);
    expect(records.map((r) => r.model)).toEqual(["G309", "G203 Lightsync"]);
  });

  it.each(HUMP_PLACEMENTS)("accepts the hump slug %s", (slug) => {
    const { records } = convertGeometryPredictions([
      prediction({ humpPlacement: slug }),
    ]);
    expect(records[0]?.humpPlacement).toBe(slug);
  });

  it.each([
    ["an unknown slug", "back_extreme"],
    ["a label instead of a slug", "Back – minimal"],
    ["a different case", "Center"],
    ["a number", 3],
    ["an empty string", ""],
  ])("rejects a hump that is %s", (_name, value) => {
    expect(() =>
      convertGeometryPredictions([prediction({ humpPlacement: value })]),
    ).toThrow(/not a hump placement/);
  });

  it("rejects a record with no humpPlacement key at all", () => {
    const rest: Record<string, unknown> = prediction();
    delete rest.humpPlacement;
    expect(() => convertGeometryPredictions([rest])).toThrow(
      /not a hump placement/,
    );
  });

  describe("refuses to apply anything but the hump", () => {
    it.each([
      [["frontFlare"], /frontFlare.*failed its M1 criteria/],
      [["sideCurvature"], /sideCurvature.*failed its M1 criteria/],
      [["humpPlacement", "frontFlare"], /frontFlare/],
      [["humpPlacement", "sideCurvature"], /sideCurvature/],
      [["shape"], /only humpPlacement/],
      [["thumbRest"], /only humpPlacement/],
      [[], /Nothing to apply/],
    ])("apply %j", (apply, message) => {
      expect(() =>
        convertGeometryPredictions([prediction()], { apply }),
      ).toThrow(message);
      expect(() =>
        convertGeometryPredictions([prediction()], { apply }),
      ).toThrow(GeometryConversionError);
    });

    it("allows the hump on its own", () => {
      expect(
        convertGeometryPredictions([prediction()], { apply: ["humpPlacement"] })
          .records,
      ).toHaveLength(1);
    });

    it("a record that sets anything but its hump is caught by the output check", () => {
      const [record] = convertGeometryPredictions([prediction()]).records;
      for (const field of [
        "shape",
        "handCompatibility",
        "frontFlare",
        "sideCurvature",
        "thumbRest",
        "ringFingerRest",
      ] as const) {
        const tampered = {
          ...record!,
          [field]: field === "thumbRest" ? false : "x",
        };
        expect(() =>
          assertOnlyHumpSet([tampered as unknown as typeof record & object]),
        ).toThrow(new RegExp(`${field} must stay null`));
      }
      expect(() => assertOnlyHumpSet([record!])).not.toThrow();
    });
  });

  describe("notes", () => {
    it("flags a lower-confidence limited-view study", () => {
      const [record] = convertGeometryPredictions([
        prediction({ confidence: "lower" }),
      ]).records;
      expect(record?.notes).toEqual([LOWER_CONFIDENCE_NOTE]);
      expect(LOWER_CONFIDENCE_NOTE).toMatch(/limited-view study geometry/i);
    });

    it.each(["trackball", "vertical"] as const)(
      "flags a %s as an unusual form factor",
      (frameCaution) => {
        const [record] = convertGeometryPredictions([
          prediction({ frameCaution }),
        ]).records;
        expect(record?.notes).toEqual([FORM_FACTOR_NOTES[frameCaution]]);
        expect(FORM_FACTOR_NOTES[frameCaution]).toMatch(/unusual form factor/i);
      },
    );

    it("says an alias is not an independent observation, and names its source", () => {
      const { records } = convertGeometryPredictions([
        prediction({ model: "G309", slug: "logitech-g309" }),
        prediction({
          model: "G309 Mini",
          slug: "logitech-g309-mini",
          aliasOf: "logitech-g309",
        }),
      ]);
      expect(records[1]?.notes).toEqual([
        expect.stringMatching(/Alias of G309:.*not an independent/),
      ]);
      expect(records[0]?.notes).toBeUndefined();
    });

    it("says a model outside the M1 validation sample was never compared with a label", () => {
      expect(NOT_IN_VALIDATION_SAMPLE_NOTE).toBe(
        "Not in the M1 validation sample (n = 29).",
      );
      for (const model of NOT_IN_VALIDATION_SAMPLE) {
        const [record] = convertGeometryPredictions([
          prediction({ model, slug: slugOf(model) }),
        ]).records;
        expect(record?.notes).toContain(NOT_IN_VALIDATION_SAMPLE_NOTE);
      }
      // 34 records, 5 of them outside the sample: the 29 that were validated.
      expect(NOT_IN_VALIDATION_SAMPLE).toHaveLength(5);
      expect(
        convertGeometryPredictions([prediction()]).records[0]?.notes,
      ).toBeUndefined();
    });

    it("lists the notes in a fixed order: alias, validation sample, lower confidence, form factor", () => {
      const { records } = convertGeometryPredictions([
        prediction({
          model: "ERGO M575",
          slug: "logitech-ergo-m575",
          frameCaution: "trackball",
        }),
        prediction({
          model: "ERGO M575S",
          slug: "logitech-ergo-m575s",
          aliasOf: "logitech-ergo-m575",
          confidence: "lower",
          frameCaution: "trackball",
        }),
      ]);
      expect(records[1]?.notes).toEqual([
        expect.stringMatching(/^Alias of ERGO M575:/),
        NOT_IN_VALIDATION_SAMPLE_NOTE,
        LOWER_CONFIDENCE_NOTE,
        FORM_FACTOR_NOTES.trackball,
      ]);
    });

    it("stacks the notes a model earns, and gives a plain model none", () => {
      const { records } = convertGeometryPredictions([
        prediction(),
        prediction({
          model: "G309",
          slug: "logitech-g309",
          confidence: "lower",
          frameCaution: "vertical",
        }),
      ]);
      expect("notes" in records[0]!).toBe(false);
      expect(records[1]?.notes).toEqual([
        LOWER_CONFIDENCE_NOTE,
        FORM_FACTOR_NOTES.vertical,
      ]);
    });

    it("says 'copied from that shell' only when the alias really has its source's hump", () => {
      const source = prediction({ model: "G309", slug: "logitech-g309" });
      const alias = (humpPlacement: unknown) =>
        prediction({
          model: "G309 Mini",
          slug: "logitech-g309-mini",
          aliasOf: "logitech-g309",
          humpPlacement,
        });
      expect(
        convertGeometryPredictions([source, alias("back_minimal")]).records[1]
          ?.notes?.[0],
      ).toMatch(/copied from that shell/);
      expect(() =>
        convertGeometryPredictions([source, alias("center")]),
      ).toThrow(/alias of G309 must have its hump \("back_minimal"\)/);
      // A null hump on either side of the alias is a mismatch too.
      expect(() => convertGeometryPredictions([source, alias(null)])).toThrow(
        /alias of G309/,
      );
      expect(() =>
        convertGeometryPredictions([
          { ...source, humpPlacement: null, confidence: "none" },
          alias("back_minimal"),
        ]),
      ).toThrow(/alias of G309/);
    });

    it("accepts an alias of a model with no hump, when the alias has none either", () => {
      const none = { humpPlacement: null, confidence: "none" };
      const { records, skipped } = convertGeometryPredictions([
        prediction({ model: "G309", slug: "logitech-g309", ...none }),
        prediction({
          model: "G309 Mini",
          slug: "logitech-g309-mini",
          aliasOf: "logitech-g309",
          ...none,
        }),
      ]);
      expect(records).toEqual([]);
      expect(skipped).toEqual(["G309", "G309 Mini"]);
    });

    it("refuses a caution or an alias it does not understand rather than dropping it", () => {
      expect(() =>
        convertGeometryPredictions([prediction({ frameCaution: "mirror" })]),
      ).toThrow(/unknown frameCaution/);
      expect(() =>
        convertGeometryPredictions([prediction({ aliasOf: "logitech-nope" })]),
      ).toThrow(/aliasOf/);
    });
  });

  describe("refuses malformed input", () => {
    it("that is not an array", () => {
      expect(() => convertGeometryPredictions({})).toThrow(/JSON array/);
      expect(() => convertGeometryPredictions(null)).toThrow(/JSON array/);
    });

    it("with a record that has no model or slug", () => {
      expect(() => convertGeometryPredictions([{ model: "G309" }])).toThrow(
        /Record 0/,
      );
      expect(() => convertGeometryPredictions([null])).toThrow(/Record 0/);
    });

    it("whose slug does not match its model name", () => {
      expect(() =>
        convertGeometryPredictions([prediction({ slug: "logitech-g204" })]),
      ).toThrow(/does not match the model name/);
    });

    it("that lists a model twice", () => {
      expect(() =>
        convertGeometryPredictions([prediction(), prediction()]),
      ).toThrow(/more than once/);
    });

    it.each(["reconstructed", "lower", "high", undefined])(
      "that has no hump but confidence %s",
      (confidence) => {
        expect(() =>
          convertGeometryPredictions([
            prediction({ humpPlacement: null, confidence }),
          ]),
        ).toThrow(/no hump needs confidence "none"/);
      },
    );

    it("that gives a hump to a model with no usable shell", () => {
      expect(() =>
        convertGeometryPredictions([prediction({ confidence: "none" })]),
      ).toThrow(/needs confidence/);
      expect(() =>
        convertGeometryPredictions([prediction({ confidence: "high" })]),
      ).toThrow(/needs confidence/);
    });
  });
});

describe("sha256Hex", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  ])("hashes %j to the published SHA-256", (text, hex) => {
    expect(sha256Hex(text)).toBe(hex);
    expect(sha256Hex(Buffer.from(text))).toBe(hex);
    expect(sha256Hex(new Uint8Array(Buffer.from(text)))).toBe(hex);
  });
});

describe("convertPredictionsFile", () => {
  const bytes = Buffer.from(JSON.stringify([prediction()]));

  it("pins the SHA-256 of the GD-1 run 1 predictions", () => {
    expect(GEOMETRY_PREDICTIONS_SHA256).toBe(
      "21e7ffcf3e6af66bb492f1bcdffe704a6f672f84c50f7015c54ed25badc5dc37",
    );
  });

  it("refuses a file that is not the pinned one", () => {
    expect(() => convertPredictionsFile(bytes)).toThrow(
      new RegExp(
        `${sha256Hex(bytes)}.*expected ${GEOMETRY_PREDICTIONS_SHA256}`,
      ),
    );
  });

  it("converts a file whose hash is the expected one, and returns that hash", () => {
    const result = convertPredictionsFile(bytes, {
      expectedSha256: sha256Hex(bytes),
    });
    expect(result.sha256).toBe(sha256Hex(bytes));
    expect(result.records).toHaveLength(1);
  });

  it("refuses bytes that are not JSON, even with the right hash", () => {
    const junk = Buffer.from("not json");
    expect(() =>
      convertPredictionsFile(junk, { expectedSha256: sha256Hex(junk) }),
    ).toThrow(/not valid JSON/);
  });

  it("passes the apply guard through", () => {
    expect(() =>
      convertPredictionsFile(bytes, {
        expectedSha256: sha256Hex(bytes),
        apply: ["humpPlacement", "frontFlare"],
      }),
    ).toThrow(/frontFlare/);
  });
});

describe("the descriptors-from-geometry script", { timeout: 60_000 }, () => {
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
  const SCRIPT = join(REPO, "scripts", "descriptors-from-geometry.ts");
  let dir = "";
  let input = "";
  let sha = "";
  let lines: string[] = [];

  /** The converter's own entry point, run in a scratch folder with the scratch file's hash. */
  const runIn = (
    args: readonly string[],
    options: { expectedSha256?: string } = {},
  ) =>
    runGeometryDescriptors(args, {
      cwd: dir,
      expectedSha256: sha,
      log: (line) => lines.push(line),
      ...options,
    });
  const read = (path: string) => readFileSync(join(dir, path), "utf8");

  /** The real script, as a user runs it. */
  const spawn = (...args: string[]) => {
    const result = spawnSync(process.execPath, [TSX, SCRIPT, ...args], {
      cwd: REPO,
      encoding: "utf8",
      timeout: 60_000,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "geometry-descriptors-test-"));
    mkdirSync(join(dir, "src", "db", "seed"), { recursive: true });
    input = join(dir, "predictions.json");
    const body = JSON.stringify([
      prediction(),
      // G903 Hero is outside the validation sample, so its only note is short.
      prediction({
        model: "G903 Hero",
        slug: "logitech-g903-hero",
        humpPlacement: "back_minimal",
      }),
      prediction({
        model: "Lift Vertical",
        slug: "logitech-lift-vertical",
        frameCaution: "vertical",
        humpPlacement: "back_moderate",
      }),
      noShell("M100", "logitech-m100"),
    ]);
    writeFileSync(input, body);
    sha = sha256Hex(body);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes to the seed file's path when given no --out, the path scripts/seed.ts reads", async () => {
    lines = [];
    await runIn([input]);
    expect(DESCRIPTORS_SEED_PATH).toBe("src/db/seed/logitech-descriptors.json");
    const records = JSON.parse(read(DESCRIPTORS_SEED_PATH));
    expect(records.map((r: { model: string }) => r.model)).toEqual([
      "G203 Lightsync",
      "G903 Hero",
      "Lift Vertical",
    ]);
    expect(lines).toEqual([
      expect.stringContaining(
        `predictions.json sha256 ${sha}: 3 records, 1 without a hump (M100).`,
      ),
      `Wrote ${DESCRIPTORS_SEED_PATH}.`,
    ]);
    // The path is the checked-in file's, and seed.ts takes it from the same constant.
    expect(existsSync(join(REPO, DESCRIPTORS_SEED_PATH))).toBe(true);
    expect(readFileSync(join(REPO, "scripts", "seed.ts"), "utf8")).toContain(
      "DESCRIPTORS_SEED_PATH",
    );
  });

  it("copies the hump only: flare and curvature in the input come out null", async () => {
    await runIn([input]);
    const [first] = JSON.parse(read(DESCRIPTORS_SEED_PATH));
    expect(first.humpPlacement).toBe("back_minimal");
    expect(first.frontFlare).toBeNull();
    expect(first.sideCurvature).toBeNull();
  });

  it("formats the file with prettier, so it passes prettier --check", async () => {
    await runIn([input]);
    const text = read(DESCRIPTORS_SEED_PATH);
    expect(text.endsWith("}\n]\n")).toBe(true);
    expect(await check(text, { parser: "json" })).toBe(true);
    expect(text).toBe(
      await format(JSON.stringify(JSON.parse(text), null, 2), {
        parser: "json",
      }),
    );
    // Plain JSON.stringify spreads the short note over three lines; prettier
    // pulls it back onto one, so this fails if the formatting step goes.
    expect(text).toContain(`"notes": ["${NOT_IN_VALIDATION_SAMPLE_NOTE}"]`);
    expect(text).not.toBe(JSON.stringify(JSON.parse(text), null, 2) + "\n");
  });

  it("writes to --out and leaves the default path alone", async () => {
    const other = "elsewhere.json";
    rmSync(join(dir, DESCRIPTORS_SEED_PATH), { force: true });
    await runIn([input, "--out", other]);
    expect(existsSync(join(dir, other))).toBe(true);
    expect(existsSync(join(dir, DESCRIPTORS_SEED_PATH))).toBe(false);
  });

  it("--check agrees with a file it wrote, then notices an edit, and a missing file", async () => {
    await runIn([input]);
    lines = [];
    await runIn([input, "--check"]);
    expect(lines.at(-1)).toBe(`${DESCRIPTORS_SEED_PATH} matches.`);

    writeFileSync(
      join(dir, DESCRIPTORS_SEED_PATH),
      read(DESCRIPTORS_SEED_PATH).replace("null", "false"),
    );
    await expect(runIn([input, "--check"])).rejects.toThrow(/does not match/);

    rmSync(join(dir, DESCRIPTORS_SEED_PATH));
    await expect(runIn([input, "--check"])).rejects.toThrow(/does not match/);
    expect(existsSync(join(dir, DESCRIPTORS_SEED_PATH))).toBe(false);
  });

  it("refuses --apply for front flare or side curvature, and writes nothing", async () => {
    rmSync(join(dir, DESCRIPTORS_SEED_PATH), { force: true });
    await expect(
      runIn([input, "--apply", "humpPlacement,frontFlare"]),
    ).rejects.toThrow(/Refusing to apply frontFlare/);
    await expect(runIn([input, "--apply", "sideCurvature"])).rejects.toThrow(
      /Refusing to apply sideCurvature/,
    );
    expect(existsSync(join(dir, DESCRIPTORS_SEED_PATH))).toBe(false);
  });

  it("has no flag that names another hash", async () => {
    await expect(runIn([input, "--expect-sha256", sha])).rejects.toThrow(
      /Unknown option/,
    );
  });

  it("asks for the predictions file when given none or two", async () => {
    await expect(runIn([])).rejects.toThrow(/Usage/);
    await expect(runIn([input, input])).rejects.toThrow(/Usage/);
  });

  it("refuses a file that is not the pinned predictions, and writes nothing", async () => {
    rmSync(join(dir, DESCRIPTORS_SEED_PATH), { force: true });
    await expect(runIn([input], { expectedSha256: undefined })).rejects.toThrow(
      GEOMETRY_PREDICTIONS_SHA256,
    );
    expect(existsSync(join(dir, DESCRIPTORS_SEED_PATH))).toBe(false);
  });

  describe("as the real script", () => {
    it("exits 1 on a file that is not the pinned predictions, writing nothing", () => {
      const out = join(dir, "spawned.json");
      const result = spawn(input, "--out", out);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(GEOMETRY_PREDICTIONS_SHA256);
      expect(existsSync(out)).toBe(false);
    });

    it("exits 1 and prints its usage when given no file", () => {
      const result = spawn();
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Usage/);
    });

    it("exits 1 on an unknown flag", () => {
      const result = spawn(input, "--expect-sha256", sha);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Unknown option/);
    });
  });
});
