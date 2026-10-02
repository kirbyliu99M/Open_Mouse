/**
 * The `learn:sort` main path after the checker, end to end on a temporary
 * folder: reports made from synthetic scenes (injected, so no browser or
 * server), synthetic JPEG files with phone-like EXIF, the real file system.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KitCode } from "../../src/lib/learning/kit";
import {
  assembleLearningReport,
  type LearningPhotoReport,
  type ReportFindings,
} from "../../src/lib/learning/report";
import {
  LABEL_FIRST_LINE,
  runSorterWithReports,
  type SorterRunArgs,
} from "../../src/lib/learning/sorterrun";
import {
  PROTOCOL_AGREED_V2,
  SESSION_FORMAT,
  emptyParticipantRecord,
  labelsRecordSchema,
  type SessionRecord,
} from "../../src/lib/learning/session";
import {
  JFIF_SEGMENT,
  PRIVATE,
  exifSegment,
  phoneSpec,
} from "./helpers/exif-jpeg";
import { syntheticHand } from "./helpers/synthetic-hand";

const concat = (...c: Uint8Array[]) => {
  const out = new Uint8Array(c.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of c) {
    out.set(x, at);
    at += x.length;
  }
  return out;
};
const seg = (marker: number, payload: Uint8Array) =>
  concat(
    new Uint8Array([
      0xff,
      marker,
      ((payload.length + 2) >> 8) & 0xff,
      (payload.length + 2) & 0xff,
    ]),
    payload,
  );
const jpeg = (seed: number) =>
  concat(
    new Uint8Array([0xff, 0xd8]),
    JFIF_SEGMENT,
    exifSegment(phoneSpec()),
    seg(0xdb, new Uint8Array(65).fill(seed)),
    seg(0xc0, new Uint8Array([8, 0, 16, 0, 16, 1, 1, 0x11, 0])),
    seg(0xda, new Uint8Array([1, 1, 0, 0, 63, 0])),
    new Uint8Array([seed, 0xff, 0x00, seed + 1]),
    new Uint8Array([0xff, 0xd9]),
  );

const SESSION: SessionRecord = {
  format: SESSION_FORMAT,
  session: "S001",
  protocol: PROTOCOL_AGREED_V2,
  date: "2026-10-03",
  timeBlock: "morning",
  venue: "the office",
  light: "window",
  phone: "Phone X",
  holding: "hand-held",
  sheet: "A",
  paperSize: "a4",
  printCheckMm: 100,
  note: "",
};

function report(
  file: string,
  code: KitCode | null,
  curl = 0,
  handedness: "left" | "right" = "right",
): LearningPhotoReport {
  const findings: ReportFindings = {
    file,
    width: 3000,
    height: 4000,
    paperSize: "a4",
    exif: {
      focalLengthMm: 6.765,
      focalLengthIn35mmFilm: 24,
      pixelXDimension: 4032,
      pixelYDimension: 3024,
    },
    exifFocalPx: null,
    qrText: code ? "https://open-mouse.vercel.app/l/v2/P901" : null,
    code,
    markers: [],
    laplacianVariance: 1000,
    reference: null,
    paper: null,
    hand: {
      landmarksPx: syntheticHand(
        { curl },
        { scale: 3, offset: { x: 900, y: 1800 } },
      ),
      handedness,
      confidence: 0.9,
    },
    sheet: "A",
  };
  return assembleLearningReport(findings);
}
const card = (participant: string): KitCode => ({
  kind: "participant",
  version: 2,
  participant,
});

describe("runSorterWithReports", () => {
  let scratch: string;
  let input: string;
  let out: string;
  let sessionDir: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "learn-run-"));
    input = join(scratch, "photos");
    out = join(scratch, "out");
    sessionDir = join(scratch, "S001");
    mkdirSync(input);
    mkdirSync(sessionDir);
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  /** Write the input files and return reports for them (P901's five, then more if asked). */
  function setup(
    participants: readonly { id: string; photos: number }[],
  ): LearningPhotoReport[] {
    const reports: LearningPhotoReport[] = [];
    let n = 0;
    for (const p of participants) {
      for (let i = 0; i < p.photos; i++) {
        const file = `IMG_${String(++n).padStart(4, "0")}.jpg`;
        writeFileSync(join(input, file), jpeg(10 + n));
        reports.push(report(file, card(p.id), i >= 3 ? 1 : 0));
      }
    }
    return reports;
  }

  const args = (
    reports: LearningPhotoReport[],
    over: Partial<SorterRunArgs> = {},
  ): SorterRunArgs => ({
    reports,
    inputDir: input,
    outDir: out,
    sessionDir,
    session: SESSION,
    cwd: scratch,
    username: null,
    provenance: { gitSha: null, gitDirty: null },
    now: new Date("2026-10-03T01:02:03.456Z"),
    dryRun: false,
    showChecks: false,
    externalServer: false,
    ...over,
  });

  it("writes the format 3 run log with protocol, the whole session record and the sheet; each entry has status and destination", () => {
    const result = runSorterWithReports(
      args(setup([{ id: "P901", photos: 5 }])),
    );
    expect(result.runLogFile).toBe("2026-10-03T01-02-03-456Z.json");
    const log = JSON.parse(
      readFileSync(join(out, "runs", result.runLogFile!), "utf8"),
    );
    expect(log).toMatchObject({
      format: "open-mouse-learning-run/3",
      kitVersion: 2,
      protocol: "agreed-v2",
      sheet: "A",
      paperSize: "a4",
    });
    expect(log.session).toEqual(SESSION);
    expect(log.reports).toHaveLength(5);
    expect(
      log.reports.every((r: { kitVersion: number }) => r.kitVersion === 2),
    ).toBe(true);
    expect(
      log.sort.photos.map((p: { status: string; destination: string }) => [
        p.status,
        p.destination,
      ]),
    ).toEqual([
      ["ok", "P901/G02/1.jpg"],
      ["ok", "P901/G02/2.jpg"],
      ["ok", "P901/G02/3.jpg"],
      ["ok", "P901/G04/1.jpg"],
      ["ok", "P901/G04/2.jpg"],
    ]);
  });

  it("writes labels.json next to session.json, naming exactly the filed destinations in order, with no verdict or mm value", () => {
    runSorterWithReports(args(setup([{ id: "P901", photos: 5 }])));
    // Next to session.json, and nowhere else.
    expect(readdirSync(sessionDir)).toEqual(["labels.json"]);
    expect(existsSync(join(out, "labels.json"))).toBe(false);
    expect(existsSync(join(input, "labels.json"))).toBe(false);
    const text = readFileSync(join(sessionDir, "labels.json"), "utf8");
    const record = labelsRecordSchema.parse(JSON.parse(text));
    expect(record.session).toBe("S001");
    expect(record.blind).toBe(true);
    expect(record.labels.map((l) => l.file)).toEqual([
      "P901/G02/1.jpg",
      "P901/G02/2.jpg",
      "P901/G02/3.jpg",
      "P901/G04/1.jpg",
      "P901/G04/2.jpg",
    ]);
    expect(
      record.labels.every((l) => l.label === null && l.reasons.length === 0),
    ).toBe(true);
    for (const word of [
      "verdict",
      "retake",
      "accepted",
      "mm",
      "landmark",
      "predicted",
    ]) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });

  it("writes participant.json templates and never overwrites a filled one", () => {
    const reports = setup([{ id: "P901", photos: 5 }]);
    runSorterWithReports(args(reports));
    const path = join(out, "P901", "participant.json");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(
      emptyParticipantRecord("P901", "S001"),
    );
    const filled = {
      ...emptyParticipantRecord("P901", "S001"),
      mouseHand: "left",
      note: "typed",
    };
    writeFileSync(path, JSON.stringify(filled));
    const again = runSorterWithReports(args(reports));
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(filled);
    // The second run read the hand: it is in the log.
    expect(again.sort.photos.every((p) => p.hand === "left")).toBe(true);
    // No truth.json, anywhere.
    const names = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? names(join(dir, e.name)) : [e.name],
      );
    expect(names(out)).not.toContain("truth.json");
  });

  it("writes stripped copies with no GPS, time or device, and leaves the originals as they were", () => {
    const reports = setup([{ id: "P901", photos: 5 }]);
    const before = reports.map((r) => ({
      file: r.file,
      bytes: readFileSync(join(input, r.file)),
      mtime: statSync(join(input, r.file)).mtimeMs,
    }));
    runSorterWithReports(args(reports));
    const copies = ["G02/1", "G02/2", "G02/3", "G04/1", "G04/2"].map((k) =>
      readFileSync(join(out, "P901", `${k}.jpg`)),
    );
    expect(copies).toHaveLength(5);
    for (const copy of copies) {
      for (const secret of [
        PRIVATE.make,
        PRIVATE.model,
        PRIVATE.serial,
        PRIVATE.dateTime,
      ]) {
        expect(copy.includes(secret)).toBe(false);
      }
    }
    for (const b of before) {
      expect(Buffer.compare(readFileSync(join(input, b.file)), b.bytes)).toBe(
        0,
      );
      expect(statSync(join(input, b.file)).mtimeMs).toBe(b.mtime);
      expect(b.bytes.includes(PRIVATE.make)).toBe(true);
    }
  });

  it("a PNG or damaged file with a readable card is placed but not filed: no destination, a status naming why, absent from labels.json, and the photos after it keep their slots", () => {
    const reports = setup([{ id: "P901", photos: 5 }]);
    writeFileSync(
      join(input, "IMG_0002.jpg"),
      new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
      ]),
    );
    writeFileSync(join(input, "IMG_0004.jpg"), jpeg(1).subarray(0, 90));
    const result = runSorterWithReports(args(reports));
    expect(
      result.sort.photos.map((p) => [
        p.gesture,
        p.shot,
        p.status,
        p.destination,
      ]),
    ).toEqual([
      ["G02", 1, "ok", "P901/G02/1.jpg"],
      ["G02", 2, "not-a-jpeg", null],
      ["G02", 3, "ok", "P901/G02/3.jpg"],
      ["G04", 1, "damaged-jpeg", null],
      ["G04", 2, "ok", "P901/G04/2.jpg"],
    ]);
    // The run log says the same.
    const log = JSON.parse(
      readFileSync(join(out, "runs", result.runLogFile!), "utf8"),
    );
    expect(log.sort.photos[1]).toMatchObject({
      status: "not-a-jpeg",
      destination: null,
    });
    // No copy exists for them, and the labels do not list them.
    expect(existsSync(join(out, "P901", "G02", "2.jpg"))).toBe(false);
    expect(existsSync(join(out, "P901", "G04", "1.jpg"))).toBe(false);
    const record = labelsRecordSchema.parse(
      JSON.parse(readFileSync(join(sessionDir, "labels.json"), "utf8")),
    );
    expect(record.labels.map((l) => l.file)).toEqual([
      "P901/G02/1.jpg",
      "P901/G02/3.jpg",
      "P901/G04/2.jpg",
    ]);
    // The summary says so, and names the participant.
    const said = result.lines.map((l) => l.text).join("\n");
    expect(said).toMatch(/IMG_0002\.jpg: not-a-jpeg/);
    expect(said).toMatch(/IMG_0004\.jpg: damaged-jpeg/);
    expect(said).toMatch(
      /Participants with a photo missing from their filed sequence: P901/,
    );
  });

  it("a participant with the wrong count is in review and nothing of theirs is filed, labelled or copied", () => {
    const result = runSorterWithReports(
      args(
        setup([
          { id: "P901", photos: 5 },
          { id: "P902", photos: 6 },
        ]),
      ),
    );
    expect(
      result.sort.participants.map((p) => [p.participant, p.status]),
    ).toEqual([
      ["P901", "ok"],
      ["P902", "needs-review"],
    ]);
    expect(existsSync(join(out, "P902", "G02"))).toBe(false);
    const record = labelsRecordSchema.parse(
      JSON.parse(readFileSync(join(sessionDir, "labels.json"), "utf8")),
    );
    expect(record.labels.every((l) => l.file.startsWith("P901/"))).toBe(true);
    const said = result.lines.map((l) => l.text).join("\n");
    expect(said).toMatch(/P902, 6 photos:.*shotCounts/);
  });

  it("writes no labels.json when nothing was filed", () => {
    const result = runSorterWithReports(
      args(setup([{ id: "P902", photos: 6 }])),
    );
    expect(readdirSync(sessionDir)).toEqual([]);
    expect(result.lines.map((l) => l.text).join("\n")).toMatch(
      /No photo was filed, so labels\.json was not written/,
    );
  });

  it("a dry run writes nothing at all", () => {
    const result = runSorterWithReports(
      args(setup([{ id: "P901", photos: 5 }]), { dryRun: true }),
    );
    expect(existsSync(out)).toBe(false);
    expect(readdirSync(sessionDir)).toEqual([]);
    expect(result.runLogFile).toBeNull();
    expect(result.sort.photos).toHaveLength(5);
  });

  describe("blind labelling in the summary", () => {
    const plant = () => {
      // A claw in a G02 slot, and a left hand in a right-handed participant.
      const reports = setup([{ id: "P901", photos: 5 }]);
      reports[1] = report(reports[1]!.file, card("P901"), 1, "left");
      mkdirSync(join(out, "P901"), { recursive: true });
      writeFileSync(
        join(out, "P901", "participant.json"),
        JSON.stringify({
          ...emptyParticipantRecord("P901", "S001"),
          mouseHand: "right",
        }),
      );
      return reports;
    };

    it("by default shows counts and names only: no pose-check call, hand flag or verdict", () => {
      const result = runSorterWithReports(args(plant()));
      const said = result.lines.map((l) => l.text).join("\n");
      expect(said).not.toMatch(
        /looks like|pose check|MediaPipe|retake|verdict:|Retake/i,
      );
      expect(said).not.toMatch(/IMG_0002\.jpg →/);
      expect(said).toContain(LABEL_FIRST_LINE);
      // The details are in the run log all the same.
      expect(result.sort.photos[1]).toMatchObject({
        status: "pose-mismatch",
        poseCheck: { predicted: "G04", agrees: false },
      });
    });

    it("--show-checks adds them, after the 'label first' line", () => {
      const lines = runSorterWithReports(
        args(plant(), { showChecks: true }),
      ).lines.map((l) => l.text);
      const first = lines.findIndex((l) => l.includes(LABEL_FIRST_LINE));
      const checks = lines.findIndex((l) => l.includes("--show-checks"));
      expect(first).toBeGreaterThanOrEqual(0);
      expect(checks).toBeGreaterThan(first);
      const after = lines.slice(checks).join("\n");
      expect(after).toMatch(
        /IMG_0002\.jpg → P901\/G02\/2\.jpg \(looks like G04\)/,
      );
      expect(after).toMatch(/MediaPipe's hand differs/);
      // Nothing of that before the reminder.
      expect(lines.slice(0, first).join("\n")).not.toMatch(
        /looks like|MediaPipe's hand/,
      );
    });
  });
});
