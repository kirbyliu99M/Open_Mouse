import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeLabelsTemplate } from "../../src/lib/learning/filing";
import type { KitCode } from "../../src/lib/learning/kit";
import {
  LABELS_FORMAT,
  PHOTO_LABEL_REASONS,
  labelsRecordSchema,
  type LabelsRecord,
} from "../../src/lib/learning/session";
import {
  parseLabelsFile,
  photosMissingLabels,
} from "../../src/lib/learning/sessionfile";
import { sortPhotosV2 } from "../../src/lib/learning/sortv2";

const card = (participant: string): KitCode => ({
  kind: "participant",
  version: 2,
  participant,
});

/** The destinations a run files, in shooting order. */
function filedFiles(
  runs: readonly { participant: string; predictions: (string | null)[] }[],
): string[] {
  let n = 0;
  const photos = runs.flatMap((r) =>
    r.predictions.map((p) => ({
      file: `IMG_${String(++n).padStart(4, "0")}.jpg`,
      takenAt: n,
      code: card(r.participant),
      predictedPose: p as "G02" | "G04" | null,
    })),
  );
  return sortPhotosV2(photos)
    .photos.map((p) => p.destination)
    .filter((d): d is string => d !== null);
}

const PLANNED = ["G02", "G02", "G02", "G04", "G04"];
const FILES = filedFiles([{ participant: "P901", predictions: PLANNED }]);

describe("labels.json template", () => {
  let scratch: string;
  let dir: string;
  let runsDir: string;
  let counter = 0;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "learn-labels-"));
    runsDir = join(scratch, "out", "runs");
    mkdirSync(runsDir, { recursive: true });
  });
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });
  /** A fresh folder for one session's session.json. */
  const newDir = () => {
    dir = join(scratch, `session-${++counter}`);
    mkdirSync(dir);
    return dir;
  };

  it("is written next to session.json: every filed photo in shooting order, unlabelled, and valid against the contract", () => {
    const here = newDir();
    const outcome = writeLabelsTemplate({
      dir: here,
      runsDir,
      session: "S001",
      files: FILES,
    });
    expect(outcome).toEqual({ status: "created", missing: [], problem: null });
    const text = readFileSync(join(here, "labels.json"), "utf8");
    const record = labelsRecordSchema.parse(JSON.parse(text));
    expect(record).toEqual({
      format: LABELS_FORMAT,
      session: "S001",
      protocol: "agreed-v2",
      blind: true,
      labels: [
        "P901/G02/1.jpg",
        "P901/G02/2.jpg",
        "P901/G02/3.jpg",
        "P901/G04/1.jpg",
        "P901/G04/2.jpg",
      ].map((file) => ({ file, label: null, reasons: [], note: "" })),
    });
    expect(parseLabelsFile(text).ok).toBe(true);
    // The only file written.
    expect(readdirSync(here)).toEqual(["labels.json"]);
  });

  it("holds no product verdict and no millimetre value: nothing but the photos' names and blank fields", () => {
    const here = newDir();
    writeLabelsTemplate({ dir: here, runsDir, session: "S002", files: FILES });
    const text = readFileSync(join(here, "labels.json"), "utf8");
    const json = JSON.parse(text) as LabelsRecord;
    // Only the contract's keys, at every level.
    expect(Object.keys(json).sort()).toEqual([
      "blind",
      "format",
      "labels",
      "protocol",
      "session",
    ]);
    for (const l of json.labels) {
      expect(Object.keys(l).sort()).toEqual([
        "file",
        "label",
        "note",
        "reasons",
      ]);
      expect(l.label).toBeNull();
      expect(l.reasons).toEqual([]);
      expect(l.note).toBe("");
    }
    // None of the words a verdict or a measurement would bring.
    for (const word of [
      "verdict",
      "retake",
      "ready",
      "accepted",
      "refused",
      "gate",
      "mm",
      "length",
      "width",
      "landmark",
      "reprojection",
      "predicted",
      "agrees",
    ]) {
      expect(text.toLowerCase()).not.toContain(word);
    }
    // Every number in the text is part of a file name or the session id.
    const stripped = text
      .replace(/"file": "[^"]+"/g, "")
      .replace(/open-mouse-learning-labels\/1/, "")
      .replace(/"session": "S\d+"/, "")
      .replace(/agreed-v2/, "");
    expect(stripped).not.toMatch(/\d/);
  });

  it("covers only the photos that were filed, not those in review or without a card", () => {
    const files = filedFiles([
      { participant: "P010", predictions: PLANNED },
      // Six photos and nothing to place the extra by: in review, so not filed.
      {
        participant: "P011",
        predictions: [null, null, null, null, null, null],
      },
      { participant: "P012", predictions: PLANNED },
    ]);
    expect(files).toHaveLength(10);
    expect(files.some((f) => f.startsWith("P011"))).toBe(false);
    const here = newDir();
    writeLabelsTemplate({ dir: here, runsDir, session: "S003", files });
    const record = labelsRecordSchema.parse(
      JSON.parse(readFileSync(join(here, "labels.json"), "utf8")),
    );
    expect(record.labels.map((l) => l.file)).toEqual(files);
  });

  it("never overwrites an existing labels.json, filled in or not, and reports what it lacks", () => {
    const here = newDir();
    const filled: LabelsRecord = {
      format: LABELS_FORMAT,
      session: "S004",
      protocol: "agreed-v2",
      blind: true,
      labels: [
        { file: "P901/G02/1.jpg", label: "good", reasons: [], note: "" },
        {
          file: "P901/G02/2.jpg",
          label: "bad",
          reasons: ["blur", "hand-off-sheet"],
          note: "",
        },
      ],
    };
    const path = join(here, "labels.json");
    writeFileSync(path, JSON.stringify(filled));
    const before = readFileSync(path, "utf8");
    const outcome = writeLabelsTemplate({
      dir: here,
      runsDir,
      session: "S004",
      files: FILES,
    });
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(outcome).toEqual({
      status: "exists",
      missing: ["P901/G02/3.jpg", "P901/G04/1.jpg", "P901/G04/2.jpg"],
      problem: null,
    });
  });

  it("an existing labels.json that covers every filed photo lacks nothing", () => {
    const here = newDir();
    writeLabelsTemplate({ dir: here, runsDir, session: "S005", files: FILES });
    const again = writeLabelsTemplate({
      dir: here,
      runsDir,
      session: "S005",
      files: FILES,
    });
    expect(again).toEqual({ status: "exists", missing: [], problem: null });
  });

  it("leaves a labels.json that is not valid, or is another session's, alone and says so", () => {
    const broken = newDir();
    writeFileSync(join(broken, "labels.json"), "{ not json");
    const a = writeLabelsTemplate({
      dir: broken,
      runsDir,
      session: "S006",
      files: FILES,
    });
    expect(a.status).toBe("exists");
    expect(a.problem).toMatch(/labels\.json is not valid JSON/);
    expect(readFileSync(join(broken, "labels.json"), "utf8")).toBe(
      "{ not json",
    );

    const other = newDir();
    writeLabelsTemplate({
      dir: other,
      runsDir,
      session: "S007",
      files: FILES,
    });
    const b = writeLabelsTemplate({
      dir: other,
      runsDir,
      session: "S008",
      files: FILES,
    });
    expect(b.status).toBe("exists");
    expect(b.problem).toMatch(/for session S007, not S008/);
    expect(b.missing).toEqual([]);
  });

  it("is never put where the run logs are: they hold the product's verdict for every photo", () => {
    for (const bad of [runsDir, join(runsDir, "deeper")]) {
      mkdirSync(bad, { recursive: true });
      const outcome = writeLabelsTemplate({
        dir: bad,
        runsDir,
        session: "S009",
        files: FILES,
      });
      expect(outcome.status).toBe("refused");
      expect(outcome.problem).toMatch(/blind/);
      expect(readdirSync(bad).includes("labels.json")).toBe(false);
    }
  });

  it("writes no path into anything it returns", () => {
    const here = newDir();
    writeFileSync(join(here, "labels.json"), "{ nope");
    const outcome = writeLabelsTemplate({
      dir: here,
      runsDir,
      session: "S010",
      files: FILES,
    });
    expect(JSON.stringify(outcome)).not.toContain(scratch);
  });
});

describe("what a filled-in labels.json looks like to the contract", () => {
  const base = (labels: LabelsRecord["labels"]): LabelsRecord => ({
    format: LABELS_FORMAT,
    session: "S001",
    protocol: "agreed-v2",
    blind: true,
    labels,
  });

  it("good means kept for measuring; a bad photo takes reasons from the list; other needs a note", () => {
    expect(PHOTO_LABEL_REASONS).toEqual([
      "hand-off-sheet",
      "corner-hidden",
      "blur",
      "wrong-pose",
      "fingers-not-per-protocol",
      "lighting",
      "other",
    ]);
    const ok = base([
      { file: "P901/G02/1.jpg", label: "good", reasons: [], note: "" },
      { file: "P901/G02/2.jpg", label: "bad", reasons: ["blur"], note: "" },
      {
        file: "P901/G02/3.jpg",
        label: "bad",
        reasons: ["other"],
        note: "a ring on the thumb hides the knuckle",
      },
    ]);
    expect(labelsRecordSchema.safeParse(ok).success).toBe(true);
    // "other" without a note, and reasons on a good photo, are not accepted.
    const noNote = base([
      { file: "P901/G02/1.jpg", label: "bad", reasons: ["other"], note: " " },
    ]);
    expect(labelsRecordSchema.safeParse(noNote).success).toBe(false);
    const goodWithReason = base([
      { file: "P901/G02/1.jpg", label: "good", reasons: ["blur"], note: "" },
    ]);
    expect(labelsRecordSchema.safeParse(goodWithReason).success).toBe(false);
  });

  it("photosMissingLabels lists, in order, the filed photos with no entry", () => {
    const labels = base([
      { file: "P901/G04/1.jpg", label: null, reasons: [], note: "" },
    ]);
    expect(photosMissingLabels(labels, FILES)).toEqual([
      "P901/G02/1.jpg",
      "P901/G02/2.jpg",
      "P901/G02/3.jpg",
      "P901/G04/2.jpg",
    ]);
    expect(photosMissingLabels(labels, [])).toEqual([]);
  });
});
