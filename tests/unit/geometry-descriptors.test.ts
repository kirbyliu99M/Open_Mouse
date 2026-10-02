import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  sha256Hex,
} from "../../src/server/catalogue/geometry-descriptors";

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
      [["frontFlare"], /frontFlare.*failed the M1 gate/],
      [["sideCurvature"], /sideCurvature.*failed the M1 gate/],
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

describe("scripts/descriptors-from-geometry.ts", { timeout: 60_000 }, () => {
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
  const SCRIPT = join(REPO, "scripts", "descriptors-from-geometry.ts");
  let dir = "";
  let input = "";
  let sha = "";

  const run = (...args: string[]) => {
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
    input = join(dir, "predictions.json");
    const body = JSON.stringify([
      prediction(),
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

  it("writes the records, then --check agrees, then --check notices an edit", () => {
    const out = join(dir, "descriptors.json");
    const written = run(input, "--out", out, "--expect-sha256", sha);
    expect(written.stderr).toBe("");
    expect(written.status).toBe(0);
    expect(written.stdout).toContain(sha);
    expect(written.stdout).toContain("2 records, 1 without a hump (M100)");
    const records = JSON.parse(readFileSync(out, "utf8"));
    expect(records.map((r: { model: string }) => r.model)).toEqual([
      "G203 Lightsync",
      "Lift Vertical",
    ]);
    expect(records[0].frontFlare).toBeNull();
    expect(records[0].sideCurvature).toBeNull();
    expect(records[1].humpPlacement).toBe("back_moderate");

    const same = run(input, "--out", out, "--expect-sha256", sha, "--check");
    expect(same.status).toBe(0);

    writeFileSync(out, readFileSync(out, "utf8").replace("null", "false"));
    const drifted = run(input, "--out", out, "--expect-sha256", sha, "--check");
    expect(drifted.status).toBe(1);
    expect(drifted.stderr).toMatch(/does not match/);
  });

  it("refuses the file when it is not the pinned predictions, and writes nothing", () => {
    const out = join(dir, "refused.json");
    const result = run(input, "--out", out);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(GEOMETRY_PREDICTIONS_SHA256);
    expect(existsSync(out)).toBe(false);
  });

  it("refuses --apply for front flare or side curvature, and writes nothing", () => {
    const out = join(dir, "flare.json");
    const result = run(
      input,
      "--out",
      out,
      "--expect-sha256",
      sha,
      "--apply",
      "humpPlacement,frontFlare",
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Refusing to apply frontFlare/);
    expect(existsSync(out)).toBe(false);
  });

  it("asks for the predictions file when given none", () => {
    const result = run();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage/);
  });
});
