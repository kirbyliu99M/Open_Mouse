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
import { NO_EXIF, readExifWhitelist } from "../../src/lib/learning/exif";
import { inventoryJpegMetadata } from "../../src/lib/learning/exifstrip";
import {
  fileStrippedCopies,
  findUnfileable,
  readParticipantRecords,
  writeParticipantTemplates,
} from "../../src/lib/learning/filing";
import type { KitCode } from "../../src/lib/learning/kit";
import {
  PARTICIPANT_FORMAT,
  PROTOCOL_AGREED_V2,
  SESSION_FORMAT,
  emptyParticipantRecord,
  type SessionRecord,
} from "../../src/lib/learning/session";
import {
  parseParticipantFile,
  parseSessionFile,
} from "../../src/lib/learning/sessionfile";
import { sortPhotosV2 } from "../../src/lib/learning/sortv2";
import {
  JFIF_SEGMENT,
  PRIVATE,
  exifSegment,
  phoneSpec,
} from "./helpers/exif-jpeg";

// ── Synthetic photos (invented bytes, no real photo) ───────────────────────

const enc = (text: string) => new TextEncoder().encode(text);
const concat = (...chunks: Uint8Array[]) => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
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
const PICTURE = (seed: number) =>
  concat(
    seg(0xdb, new Uint8Array(65).fill(seed)),
    seg(0xc0, new Uint8Array([8, 0, 16, 0, 16, 1, 1, 0x11, 0])),
    seg(0xda, new Uint8Array([1, 1, 0, 0, 63, 0])),
    new Uint8Array([seed, 0xff, 0x00, seed + 1, seed + 2]),
    new Uint8Array([0xff, 0xd9]),
  );
/** A phone-like JPEG: JFIF, a full EXIF with GPS, an XMP block, then the picture. */
const phoneJpeg = (seed: number) =>
  concat(
    new Uint8Array([0xff, 0xd8]),
    JFIF_SEGMENT,
    exifSegment(phoneSpec()),
    seg(0xfe, enc("comment with ZP-9000")),
    PICTURE(seed),
  );

const participantCard = (participant: string): KitCode => ({
  kind: "participant",
  version: 2,
  participant,
});

const SESSION: SessionRecord = {
  format: SESSION_FORMAT,
  session: "S001",
  protocol: PROTOCOL_AGREED_V2,
  date: "2026-10-03",
  timeBlock: "morning",
  venue: "the office",
  light: "window, overcast",
  phone: "Phone X, main 1x lens",
  holding: "hand-held",
  sheet: "A",
  paperSize: "a4",
  printCheckMm: 100,
  note: "",
};

describe("parseSessionFile", () => {
  const text = (o: object = {}) => JSON.stringify({ ...SESSION, ...o });

  it("reads a valid session", () => {
    const parsed = parseSessionFile(text());
    expect(parsed).toEqual({ ok: true, value: SESSION });
  });

  it("reads a file with a UTF-8 byte-order mark in front (Windows editors add one)", () => {
    expect(parseSessionFile("\uFEFF" + text())).toEqual({
      ok: true,
      value: SESSION,
    });
    const bad = parseSessionFile("\uFEFF{ nope");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/not valid JSON/);
  });

  it("says what is wrong, naming the field and never the value", () => {
    const secret = "SECRET-VALUE-9931";
    const bad = parseSessionFile(text({ sheet: secret, date: secret }));
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.message).toMatch(/sheet/);
    expect(bad.message).toMatch(/date/);
    expect(bad.message).not.toContain(secret);
  });

  it.each([
    ["not JSON", "{ nope"],
    ["an empty file", ""],
    ["an array", "[]"],
    ["an unknown extra field", text({ gps: "25N 121E" })],
    ["a missing field", JSON.stringify({ ...SESSION, phone: undefined })],
    ["another protocol", text({ protocol: "candidate-v1" })],
    ["another format", text({ format: "open-mouse-learning-session/9" })],
    ["a sheet that does not exist", text({ sheet: "C" })],
    ["a bad session id", text({ session: "7" })],
  ])("refuses %s", (_name, body) => {
    expect(parseSessionFile(body).ok).toBe(false);
  });
});

describe("parseParticipantFile", () => {
  it("reads the template the sorter writes", () => {
    const template = emptyParticipantRecord("P007", "S001");
    const parsed = parseParticipantFile(JSON.stringify(template), "P007");
    expect(parsed).toEqual({ ok: true, value: template });
    expect(template.format).toBe(PARTICIPANT_FORMAT);
    expect(template.mouseHand).toBeNull();
  });

  it("refuses another participant's record", () => {
    const parsed = parseParticipantFile(
      JSON.stringify(emptyParticipantRecord("P008", "S001")),
      "P007",
    );
    expect(parsed.ok).toBe(false);
  });
});

describe("filing a run", () => {
  let scratch: string;
  let input: string;
  let out: string;
  const originals: Record<string, Uint8Array> = {};

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "learn-filing-"));
    input = join(scratch, "photos");
    out = join(scratch, "out");
    mkdirSync(input);
    mkdirSync(out);
    for (const [i, name] of [
      "IMG_0001.jpg",
      "IMG_0002.jpg",
      "IMG_0003.jpg",
      "IMG_0004.jpg",
      "IMG_0005.jpg",
    ].entries()) {
      originals[name] = phoneJpeg(10 + i * 10);
      writeFileSync(join(input, name), originals[name]!);
    }
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  const sorted = () =>
    sortPhotosV2(
      [1, 2, 3, 4, 5].map((n) => ({
        file: `IMG_000${n}.jpg`,
        takenAt: n,
        code: participantCard("P007"),
        predictedPose: null,
      })),
    );

  it("writes an EXIF-stripped copy of each filed photo, keeps the picture and the orientation, and never touches the originals", () => {
    const before = Object.fromEntries(
      Object.keys(originals).map((name) => {
        const path = join(input, name);
        return [
          name,
          { bytes: readFileSync(path), mtime: statSync(path).mtimeMs },
        ];
      }),
    );
    const listing = readdirSync(input).sort();

    const result = fileStrippedCopies({
      photos: sorted().photos,
      inputDir: input,
      outDir: out,
    });
    expect(result.refused).toEqual([]);
    expect(result.existing).toEqual([]);
    expect(result.copied).toEqual([
      "P007/G02/1.jpg",
      "P007/G02/2.jpg",
      "P007/G02/3.jpg",
      "P007/G04/1.jpg",
      "P007/G04/2.jpg",
    ]);

    for (const [i, destination] of result.copied.entries()) {
      const original = originals[`IMG_000${i + 1}.jpg`]!;
      const copy = new Uint8Array(readFileSync(join(out, destination)));
      // Everything the EXIF carried is gone: no GPS, time, make, model, serial, comment.
      for (const secret of [
        PRIVATE.make,
        PRIVATE.model,
        PRIVATE.serial,
        PRIVATE.dateTime,
        PRIVATE.uniqueId,
        "ZP-9000",
      ]) {
        expect(Buffer.from(copy).includes(secret)).toBe(false);
      }
      expect(readExifWhitelist(copy)).toEqual(NO_EXIF);
      // The Orientation tag (6 in the phone spec) survives, as the only Exif.
      expect(inventoryJpegMetadata(copy).exif).toHaveLength(36);
      // The picture is byte for byte the original's.
      const pictureAt = (b: Uint8Array) => {
        for (let k = 2; k + 1 < b.length; k++)
          if (b[k] === 0xff && b[k + 1] === 0xdb) return b.subarray(k);
        throw new Error("no DQT");
      };
      expect(Array.from(pictureAt(copy))).toEqual(
        Array.from(pictureAt(original)),
      );
    }

    // The originals: same bytes, same modification time, same folder contents.
    for (const [name, was] of Object.entries(before)) {
      const path = join(input, name);
      expect(Buffer.compare(readFileSync(path), was.bytes)).toBe(0);
      expect(statSync(path).mtimeMs).toBe(was.mtime);
      expect(Buffer.from(originals[name]!).includes(PRIVATE.make)).toBe(true);
    }
    expect(readdirSync(input).sort()).toEqual(listing);
  });

  it("run again, leaves what is there alone", () => {
    fileStrippedCopies({
      photos: sorted().photos,
      inputDir: input,
      outDir: out,
    });
    const target = join(out, "P007", "G02", "2.jpg");
    const stamp = statSync(target).mtimeMs;
    const content = readFileSync(target);
    const again = fileStrippedCopies({
      photos: sorted().photos,
      inputDir: input,
      outDir: out,
    });
    expect(again.copied).toEqual([]);
    expect(again.existing).toHaveLength(5);
    expect(statSync(target).mtimeMs).toBe(stamp);
    expect(Buffer.compare(readFileSync(target), content)).toBe(0);
  });

  it("never overwrites an existing destination, whatever it holds", () => {
    const target = join(out, "P007", "G02", "3.jpg");
    mkdirSync(join(out, "P007", "G02"), { recursive: true });
    writeFileSync(target, "someone's edit");
    const result = fileStrippedCopies({
      photos: sorted().photos,
      inputDir: input,
      outDir: out,
    });
    expect(result.copied).toHaveLength(4);
    expect(result.existing).toEqual(["P007/G02/3.jpg"]);
    expect(readFileSync(target, "utf8")).toBe("someone's edit");
  });

  it("refuses a PNG and a damaged JPEG: no copy is made, and the file names come back", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
    ]);
    const cut = phoneJpeg(77).subarray(0, 120);
    writeFileSync(join(input, "SHOT_1.png"), png);
    writeFileSync(join(input, "SHOT_2.jpg"), cut);
    const photos = sortPhotosV2(
      ["SHOT_1.png", "SHOT_2.jpg"].map((file, i) => ({
        file,
        takenAt: i,
        code: participantCard("P099"),
        predictedPose: null,
      })),
      { shotCounts: { P099: { G02: 2, G04: 0 } } },
    ).photos;
    const result = fileStrippedCopies({ photos, inputDir: input, outDir: out });
    expect(result.copied).toEqual([]);
    expect(result.refused).toEqual([
      { file: "SHOT_1.png", reason: "not-a-jpeg" },
      { file: "SHOT_2.jpg", reason: "malformed" },
    ]);
    expect(existsSync(join(out, "P099"))).toBe(false);
    // Whatever was refused is still only in the input folder.
    expect(JSON.stringify(result)).not.toContain(scratch);
  });

  it("skips a photo that is not filed (no destination)", () => {
    const photos = sortPhotosV2([
      { file: "IMG_0001.jpg", takenAt: 1, code: null, predictedPose: null },
    ]).photos;
    const result = fileStrippedCopies({
      photos,
      inputDir: input,
      outDir: join(scratch, "nowhere"),
    });
    expect(result).toEqual({ copied: [], existing: [], refused: [] });
    expect(existsSync(join(scratch, "nowhere"))).toBe(false);
  });
});

describe("participant.json", () => {
  let scratch: string;
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "learn-participants-"));
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("writes a template for each participant, never overwrites a filled one, and writes no truth.json", () => {
    const first = writeParticipantTemplates({
      participants: ["P007", "P008"],
      session: "S001",
      outDir: scratch,
    });
    expect(first).toEqual({ created: ["P007", "P008"], existing: [] });
    const path = join(scratch, "P007", "participant.json");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(
      emptyParticipantRecord("P007", "S001"),
    );

    // Filled in from the consent flow.
    const filled = {
      ...emptyParticipantRecord("P007", "S001"),
      mouseHand: "left",
      gripSelf: "claw",
      note: "typed by hand",
    };
    writeFileSync(path, JSON.stringify(filled));
    const second = writeParticipantTemplates({
      participants: ["P007", "P008", "P009"],
      session: "S002",
      outDir: scratch,
    });
    expect(second).toEqual({ created: ["P009"], existing: ["P007", "P008"] });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(filled);

    const everything = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? everything(join(dir, e.name)) : [e.name],
      );
    expect(everything(scratch).sort()).toEqual([
      "participant.json",
      "participant.json",
      "participant.json",
    ]);
    expect(everything(scratch)).not.toContain("truth.json");
  });

  it("reads the mouse hands: filled in, still empty, missing, and unusable", () => {
    const dir = mkdtempSync(join(scratch, "hands-"));
    const put = (id: string, body: string) => {
      mkdirSync(join(dir, id), { recursive: true });
      writeFileSync(join(dir, id, "participant.json"), body);
    };
    put(
      "P001",
      JSON.stringify({
        ...emptyParticipantRecord("P001", "S001"),
        mouseHand: "right",
      }),
    );
    put("P002", JSON.stringify(emptyParticipantRecord("P002", "S001")));
    put("P004", "{ broken");
    put("P005", JSON.stringify(emptyParticipantRecord("P006", "S001")));
    const read = readParticipantRecords({
      participants: ["P001", "P002", "P003", "P004", "P005"],
      outDir: dir,
    });
    expect(read.hands).toEqual({
      P001: "right",
      P002: null,
      P003: null,
      P004: null,
      P005: null,
    });
    expect(read.shotCounts).toEqual({
      P001: null,
      P002: null,
      P003: null,
      P004: null,
      P005: null,
    });
    expect(read.missing).toEqual(["P003"]);
    expect(read.problems.map((p) => p.participant)).toEqual(["P004", "P005"]);
    for (const p of read.problems) expect(p.message).not.toContain(dir);
  });

  it("reads shotCounts as Kirby wrote them, and refuses a malformed one", () => {
    const dir = mkdtempSync(join(scratch, "counts-"));
    const put = (id: string, shotCounts: unknown) => {
      mkdirSync(join(dir, id), { recursive: true });
      writeFileSync(
        join(dir, id, "participant.json"),
        JSON.stringify({ ...emptyParticipantRecord(id, "S001"), shotCounts }),
      );
    };
    put("P001", { G02: 4, G04: 2 });
    put("P002", null);
    put("P003", { G02: 4 }); // G04 missing
    put("P004", { G02: -1, G04: 2 });
    const read = readParticipantRecords({
      participants: ["P001", "P002", "P003", "P004"],
      outDir: dir,
    });
    expect(read.shotCounts).toEqual({
      P001: { G02: 4, G04: 2 },
      P002: null,
      P003: null,
      P004: null,
    });
    expect(read.problems.map((p) => p.participant)).toEqual(["P003", "P004"]);
  });

  it("reads a file saved by a Windows editor with a UTF-8 byte-order mark in front", () => {
    const dir = mkdtempSync(join(scratch, "bom-"));
    mkdirSync(join(dir, "P001"));
    writeFileSync(
      join(dir, "P001", "participant.json"),
      "\uFEFF" +
        JSON.stringify({
          ...emptyParticipantRecord("P001", "S001"),
          mouseHand: "left",
        }),
    );
    const read = readParticipantRecords({
      participants: ["P001"],
      outDir: dir,
    });
    expect(read.hands).toEqual({ P001: "left" });
    expect(read.problems).toEqual([]);
  });
});

describe("findUnfileable", () => {
  let scratch: string;
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "learn-unfileable-"));
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("names every file whose stripped copy cannot be made, and why, reading only", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
    ]);
    const heic = concat(
      new Uint8Array([0, 0, 0, 24]),
      enc("ftypheic"),
      new Uint8Array(12),
    );
    writeFileSync(join(scratch, "ok.jpg"), phoneJpeg(5));
    writeFileSync(join(scratch, "shot.png"), png);
    writeFileSync(join(scratch, "shot.heic"), heic);
    writeFileSync(join(scratch, "cut.jpg"), phoneJpeg(5).subarray(0, 100));
    const before = readFileSync(join(scratch, "ok.jpg"));
    const result = findUnfileable({
      inputDir: scratch,
      files: ["ok.jpg", "shot.png", "shot.heic", "cut.jpg", "gone.jpg"],
    });
    expect(result).toEqual({
      "shot.png": "not-a-jpeg",
      "shot.heic": "not-a-jpeg",
      "cut.jpg": "damaged-jpeg",
      "gone.jpg": "damaged-jpeg",
    });
    expect(Buffer.compare(readFileSync(join(scratch, "ok.jpg")), before)).toBe(
      0,
    );
    expect(readdirSync(scratch).sort()).toEqual([
      "cut.jpg",
      "ok.jpg",
      "shot.heic",
      "shot.png",
    ]);
  });
});
