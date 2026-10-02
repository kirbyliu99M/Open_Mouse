/**
 * End to end, with the real producer: the sorter's own pure code builds the
 * inputs and the evaluator's real entry point reads them. Nothing here is
 * written by hand in the evaluator's input shape.
 *
 *  1. Synthetic reports (`assembleLearningReport`, sheet A) of five
 *     participants: a hand of known shape on a camera of known pose, with the
 *     product's paper and hand gates worked out by the real gate code.
 *  2. The sorter's own main path, `runSorterWithReports`, run twice on a
 *     temporary folder of synthetic JPEGs: the first run writes the
 *     `participant.json` templates, the stripped copies and a blank
 *     `labels.json` (blind: no verdict in it); a person fills both in; the
 *     second run knows the mouse hands and writes the run log that is evaluated.
 *     Two things the sorter does not file are in the scenario: a file that is not
 *     a JPEG, and a participant with seven photos and no `shotCounts`
 *     (`needs-review`).
 *  3. The evaluator: `evaluateRunJson` on the run log, the participant records
 *     and the filled labels, and the real `m2:evaluate` script on the same files.
 *
 * Every expected number is worked out here with plain arithmetic from the
 * scenario table and from the values the producer RECORDED (the millimetre
 * landmarks and measurements in the reports), never from the evaluator.
 */
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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Point2 } from "../../src/client/geometry/homography";
import type { DetectedMarker } from "../../src/client/photo/markers";
import { paperFindings, sheetReference } from "../../src/lib/learning/findings";
import { sheetAMarkers } from "../../src/lib/learning/layoutv2";
import {
  assembleLearningReport,
  type LearningPhotoReport,
} from "../../src/lib/learning/report";
import { NO_PROVENANCE, RUN_LOG_FORMAT } from "../../src/lib/learning/runlog";
import { runSorterWithReports } from "../../src/lib/learning/sorterrun";
import {
  PHOTO_LABEL_REASONS,
  PROTOCOL_AGREED_V2,
  SESSION_FORMAT,
  type GripSelfReport,
  type LabelsRecord,
  type ParticipantRecord,
  type SessionRecord,
} from "../../src/lib/learning/session";
import {
  parseLabelsFile,
  parseParticipantFile,
  parseSessionFile,
  photosMissingLabels,
} from "../../src/lib/learning/sessionfile";
import { toAggregateOnly } from "../../src/lib/m2/aggregate";
import { HELD_OUT_NOTICE, type KitV2Report } from "../../src/lib/m2/kitv2";
import { renderMarkdown } from "../../src/lib/m2/markdown";
import { evaluateRunJson } from "../../src/lib/m2/run";
import { GRIP_PREDICTION } from "../../src/server/fit/coefficients";
import {
  buildSyntheticCamera,
  projectSheetMm,
} from "./helpers/synthetic-camera";
import { JFIF_SEGMENT, exifSegment, phoneSpec } from "./helpers/exif-jpeg";
import { syntheticHand } from "./helpers/synthetic-hand";

/** A small complete JPEG with phone-like EXIF, for the sorter to strip and copy. */
const concat = (...c: Uint8Array[]) => {
  const out = new Uint8Array(c.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of c) {
    out.set(x, at);
    at += x.length;
  }
  return out;
};
const segment = (marker: number, payload: Uint8Array) =>
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
    segment(0xdb, new Uint8Array(65).fill(seed)),
    segment(0xc0, new Uint8Array([8, 0, 16, 0, 16, 1, 1, 0x11, 0])),
    segment(0xda, new Uint8Array([1, 1, 0, 0, 63, 0])),
    new Uint8Array([seed, 0xff, 0x00, seed + 1]),
    new Uint8Array([0xff, 0xd9]),
  );

// The script is started through tsx, which is slow while the whole suite runs.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
const SCRIPT = join(REPO, "scripts", "m2-evaluate.ts");

type Reason = (typeof PHOTO_LABEL_REASONS)[number];
type Pose = "G02" | "G04";

// ── The scenario ────────────────────────────────────────────────────────────

interface Person {
  readonly id: string;
  /** Overall hand size (the palm is 100 mm times this). */
  readonly size: number;
  /** Finger length against the template: moves r = palm / hand length. */
  readonly fingers: number;
  readonly mouseHand: "right" | "left";
  readonly grip: GripSelfReport;
}

// Blocks P001-P004 and P005-P008 are complete (P004 and P006 are their
// held-out members); P901 is S0. P008 is the participant the sorter puts in review.
const PEOPLE: readonly Person[] = [
  { id: "P001", size: 1.0, fingers: 1.0, mouseHand: "right", grip: "claw" },
  { id: "P002", size: 0.95, fingers: 0.8, mouseHand: "right", grip: "palm" },
  { id: "P003", size: 1.08, fingers: 1.25, mouseHand: "left", grip: "claw" },
  { id: "P004", size: 1.02, fingers: 1.0, mouseHand: "right", grip: "claw" },
  { id: "P005", size: 0.98, fingers: 1.0, mouseHand: "right", grip: "claw" },
  { id: "P006", size: 1.0, fingers: 1.0, mouseHand: "right", grip: "claw" },
  { id: "P007", size: 1.05, fingers: 0.85, mouseHand: "right", grip: "palm" },
  { id: "P008", size: 1.0, fingers: 1.0, mouseHand: "right", grip: "claw" },
  { id: "P901", size: 1.0, fingers: 1.0, mouseHand: "right", grip: "palm" },
];

interface Call {
  /** The label: good, bad, or `null` (not labelled yet). */
  readonly label: "good" | "bad" | null;
  readonly reasons?: readonly Reason[];
}
interface Shot {
  readonly pose: Pose;
  /** A small change of hand size and place between retakes, so the repeats differ. */
  readonly size: number;
  readonly dx: number;
  readonly dy: number;
  /** The paper's fourth corner is hidden: the product's paper gate refuses it. */
  readonly paperHidden?: boolean;
  /** MediaPipe is unsure: the product's hand gate refuses it. */
  readonly lowConfidence?: boolean;
  /** MediaPipe's hand label, when it is not the participant's mouse hand. */
  readonly seenAs?: "left" | "right";
  /** The file on disk is not a JPEG: the sorter cannot file a copy of it. */
  readonly notAJpeg?: boolean;
  readonly call: Call;
}

const GOOD: Call = { label: "good" };
const shot = (
  pose: Pose,
  size: number,
  dx: number,
  dy: number,
  call: Call,
  extra: Partial<Shot> = {},
): Shot => ({ pose, size, dx, dy, call, ...extra });

const SHOTS: Readonly<Record<string, readonly Shot[]>> = {
  P001: [
    shot("G02", 1.0, 0, 0, GOOD),
    shot("G02", 1.004, 2, -3, GOOD),
    // Product: retake (paper corner hidden). Label: bad, corner hidden. Agree.
    shot(
      "G02",
      0.996,
      -2,
      3,
      { label: "bad", reasons: ["corner-hidden"] },
      { paperHidden: true },
    ),
    shot("G04", 1.0, 1, 1, GOOD),
    // MediaPipe says left, the record says right: a flag, not a refusal.
    shot("G04", 1.002, -1, 2, GOOD, { seenAs: "left" }),
  ],
  P002: [
    // Product: retake (low confidence). Label: good. A FALSE REJECT.
    shot("G02", 1.0, 0, 0, GOOD, { lowConfidence: true }),
    shot("G02", 1.006, 3, 2, GOOD),
    shot("G02", 0.994, -3, -2, GOOD),
    // Product: accepts. Label: bad, hand off the sheet. A FALSE ACCEPT.
    shot("G04", 1.0, 0, 0, { label: "bad", reasons: ["hand-off-sheet"] }),
    shot("G04", 1.003, 2, 1, GOOD),
  ],
  P003: [
    shot("G02", 1.0, 0, 0, GOOD),
    shot("G02", 1.005, 2, 2, GOOD),
    shot("G02", 0.995, -2, -2, GOOD),
    shot("G04", 1.0, 1, 0, GOOD),
    // Not a JPEG: placed in the shooting order, but not filed and so not labelled.
    shot("G04", 1.002, -1, 1, { label: null }, { notAJpeg: true }),
  ],
  P004: [
    shot("G02", 1.0, 0, 0, GOOD),
    shot("G02", 1.01, 2, 0, GOOD),
    shot("G02", 0.99, -2, 0, { label: "bad", reasons: ["blur"] }),
    shot("G04", 1.0, 0, 1, GOOD),
    shot("G04", 1.0, 0, -1, GOOD),
  ],
  P005: [
    shot("G02", 1.0, 0, 0, GOOD),
    shot("G02", 1.003, 1, 1, GOOD),
    shot("G02", 0.997, -1, -1, GOOD),
    shot("G04", 1.0, 0, 1, GOOD),
    shot("G04", 1.0, 1, 0, GOOD),
  ],
  P006: [
    shot("G02", 1.0, 0, 0, GOOD),
    shot("G02", 1.004, 2, 1, GOOD),
    shot("G02", 0.996, -2, -1, GOOD),
    shot("G04", 1.0, 0, 1, GOOD),
    shot("G04", 1.0, 1, 0, GOOD),
  ],
  P007: [
    shot("G02", 1.0, 0, 0, GOOD),
    shot("G02", 1.005, 2, 2, GOOD),
    shot("G02", 0.995, -2, -2, GOOD),
    shot("G04", 1.0, 1, 1, GOOD),
    shot("G04", 1.0, -1, 0, GOOD),
  ],
  // Seven photos and no shotCounts: not the planned 3 + 2. The sorter files none of them.
  P008: [
    shot("G02", 1.0, 0, 0, { label: null }),
    shot("G02", 1.0, 0, 0, { label: null }),
    shot("G02", 1.0, 0, 0, { label: null }),
    shot("G02", 1.0, 0, 0, { label: null }),
    shot("G04", 1.0, 0, 0, { label: null }),
    shot("G04", 1.0, 0, 0, { label: null }),
    shot("G04", 1.0, 0, 0, { label: null }),
  ],
  P901: [
    shot("G02", 1.0, 0, 0, GOOD),
    shot("G02", 1.0, 1, 0, GOOD),
    shot("G02", 1.0, -1, 0, GOOD),
    shot("G04", 1.0, 0, 1, GOOD),
    shot("G04", 1.0, 0, -1, GOOD),
  ],
};

// ── The synthetic camera, sheet and hands ───────────────────────────────────

const camera = buildSyntheticCamera({ tiltDeg: 8, distanceMm: 420, fPx: 3200 });
/** Sheet-layout mm (top-left origin) to image px. */
const layoutToImage = (p: Point2) =>
  projectSheetMm(camera, { x: p.x - 105, y: p.y - 148.5 });
const MARKERS: DetectedMarker[] = sheetAMarkers().map((m) => ({
  id: m.id,
  corners: m.corners.map(layoutToImage) as unknown as DetectedMarker["corners"],
}));

function paperQuad(hidden: boolean): Parameters<typeof paperFindings>[0] {
  const corners = [
    { x: 0, y: 0 },
    { x: 210, y: 0 },
    { x: 210, y: 297 },
    { x: 0, y: 297 },
  ].map(layoutToImage) as [Point2, Point2, Point2, Point2];
  return {
    corners,
    cornersSeen: hidden ? 3 : 4,
    cornersFound: hidden ? [true, true, true, false] : [true, true, true, true],
    partialCorners: corners,
    minSideCoverage: 0.9,
    edgeFitResidualPx: 0.3,
    worstSideIndex: 0,
    paperRegionFound: true,
  };
}

/** 21 landmarks in sheet mm (centre of the sheet at 0, 0; x right, y down), wrist low, fingers up. */
function handMm(person: Person, shot: Shot): Point2[] {
  const raw = syntheticHand({
    curl: shot.pose === "G04" ? 1 : 0,
    spread: true,
  });
  const pts = raw.map((p) => ({ ...p }));
  // Move each finger's joints along the finger (the thumb is left alone).
  for (let finger = 0; finger < 4; finger++) {
    const mcp = raw[5 + 4 * finger]!;
    for (let joint = 1; joint <= 3; joint++) {
      const i = 5 + 4 * finger + joint;
      pts[i] = {
        x: mcp.x + (raw[i]!.x - mcp.x) * person.fingers,
        y: mcp.y + (raw[i]!.y - mcp.y) * person.fingers,
      };
    }
  }
  const size = person.size * shot.size;
  const mirror = person.mouseHand === "left" ? -1 : 1;
  return pts.map((p) => ({
    x: p.x * size * mirror + shot.dx,
    y: p.y * size + 90 + shot.dy,
  }));
}

function reportOf(file: string, person: Person, s: Shot): LearningPhotoReport {
  return assembleLearningReport({
    file,
    width: 3024,
    height: 4032,
    paperSize: "a4",
    exif: null,
    exifFocalPx: null,
    qrText: `https://open-mouse.vercel.app/l/v2/${person.id}`,
    // The card in the slot, as on every kit v2 photo: a participant code.
    code: { kind: "participant", version: 2, participant: person.id },
    markers: MARKERS,
    laplacianVariance: 1000,
    reference: sheetReference(MARKERS, "A"),
    paper: paperFindings(paperQuad(s.paperHidden === true), "a4"),
    hand: {
      landmarksPx: handMm(person, s).map((p) => projectSheetMm(camera, p)),
      handedness: s.seenAs ?? person.mouseHand,
      confidence: s.lowConfidence ? 0.5 : 0.95,
    },
    sheet: "A",
  });
}

const SESSION: SessionRecord = {
  format: SESSION_FORMAT,
  session: "S001",
  protocol: PROTOCOL_AGREED_V2,
  date: "2026-10-05",
  timeBlock: "afternoon",
  venue: "club room",
  light: "ceiling LED",
  phone: "Phone X, main 1x",
  holding: "handheld",
  sheet: "A",
  paperSize: "a4",
  printCheckMm: 100,
  note: "",
};

// ── Plain arithmetic ────────────────────────────────────────────────────────

const mean = (xs: readonly number[]) =>
  xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: readonly number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const dist = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);

describe("kit v2, end to end: the sorter's own output through the evaluator", () => {
  let scratch: string;
  let input: string;
  let outDir: string;
  let runsDir: string;
  let sessionDir: string;
  let runLogPath: string;
  /** Reports in file order, with who they belong to and the plan for the shot. */
  const photos: {
    report: LearningPhotoReport;
    person: Person;
    shot: Shot;
    destination: string | null;
    status: string;
  }[] = [];
  let log: Record<string, unknown>;
  let records: ParticipantRecord[];
  let labels: LabelsRecord;
  let report: KitV2Report;

  const reportsOf = (id: string, pose?: Pose) =>
    photos
      .filter((p) => p.person.id === id && (pose ? p.shot.pose === pose : true))
      .map((p) => p.report);
  /** Recorded marker-plane hand lengths of the G02 photos of these people. */
  const g02Lengths = (id: string) =>
    reportsOf(id, "G02").map((r) => r.markerMm!.handLengthMm);

  const CALIBRATION = ["P001", "P002", "P003", "P005", "P007"] as const;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "m2-kitv2-e2e-"));
    input = join(scratch, "Photos");
    outDir = join(scratch, "out");
    runsDir = join(outDir, "runs");
    sessionDir = join(scratch, "session");
    mkdirSync(input, { recursive: true });
    mkdirSync(sessionDir, { recursive: true });

    // 1. The reports, in file (shooting) order, participant by participant,
    //    and the photo files they are of. One file is not a JPEG at all.
    const reports: LearningPhotoReport[] = [];
    let n = 0;
    for (const person of PEOPLE) {
      for (const s of SHOTS[person.id]!) {
        const file = `IMG_${String(++n).padStart(4, "0")}.jpg`;
        writeFileSync(
          join(input, file),
          s.notAJpeg ? new Uint8Array([1, 2, 3, 4]) : jpeg(10 + n),
        );
        const r = reportOf(file, person, s);
        reports.push(r);
        photos.push({
          report: r,
          person,
          shot: s,
          destination: null,
          status: "",
        });
      }
    }

    // 2. session.json, as a person writes it, read back the way the sorter does.
    writeFileSync(
      join(sessionDir, "session.json"),
      JSON.stringify(SESSION, null, 2) + "\n",
    );
    const session = parseSessionFile(
      readFileSync(join(sessionDir, "session.json"), "utf8"),
    );
    if (!session.ok) throw new Error(session.message);

    const run = (now: string) =>
      runSorterWithReports({
        reports,
        inputDir: input,
        outDir,
        sessionDir,
        session: session.value,
        cwd: scratch,
        username: null,
        provenance: NO_PROVENANCE,
        now: new Date(now),
        dryRun: false,
        showChecks: false,
        externalServer: false,
      });

    // 3. The sorter, first run: no participant.json yet. It writes the
    //    templates, the stripped copies and a blank labels.json.
    const first = run("2026-10-05T11:00:00Z");
    expect(first.sort.participants.map((p) => p.participant)).toEqual(
      PEOPLE.map((p) => p.id),
    );

    // A person fills in each participant.json from the consent flow.
    for (const person of PEOPLE) {
      const file = join(outDir, person.id, "participant.json");
      const template = parseParticipantFile(
        readFileSync(file, "utf8"),
        person.id,
      );
      if (!template.ok) throw new Error(template.message);
      expect(template.value.mouseHand).toBeNull();
      expect(template.value.shotCounts).toBeNull();
      writeFileSync(
        file,
        JSON.stringify(
          {
            ...template.value,
            mouseHand: person.mouseHand,
            gripSelf: person.grip,
          },
          null,
          2,
        ) + "\n",
      );
    }

    // 4. The sorter again: now the hands are known. This run's log is the one evaluated.
    const second = run("2026-10-05T12:00:00Z");
    runLogPath = join(runsDir, second.runLogFile!);
    second.sort.photos.forEach((p, i) => {
      photos[i]!.destination = p.destination;
      photos[i]!.status = p.status;
    });

    // 5. labels.json, written by the first run: one blank entry per FILED
    //    photo, no verdict in it. Kirby labels them, blind.
    const blank = parseLabelsFile(
      readFileSync(join(sessionDir, "labels.json"), "utf8"),
    );
    if (!blank.ok) throw new Error(blank.message);
    expect(blank.value.blind).toBe(true);
    expect(blank.value.labels.every((l) => l.label === null)).toBe(true);
    const filed = second.sort.photos.flatMap((p) =>
      p.destination ? [p.destination] : [],
    );
    expect(blank.value.labels.map((l) => l.file)).toEqual(filed);
    const byDestination = new Map(
      photos.map((p) => [p.destination, p.shot.call] as const),
    );
    writeFileSync(
      join(sessionDir, "labels.json"),
      JSON.stringify(
        {
          ...blank.value,
          labels: blank.value.labels.map((l) => {
            const call = byDestination.get(l.file)!;
            return {
              ...l,
              label: call.label,
              reasons: [...(call.reasons ?? [])],
            };
          }),
        },
        null,
        2,
      ) + "\n",
    );
    const filledLabels = parseLabelsFile(
      readFileSync(join(sessionDir, "labels.json"), "utf8"),
    );
    if (!filledLabels.ok) throw new Error(filledLabels.message);
    expect(photosMissingLabels(filledLabels.value, filed)).toEqual([]);

    // 6. Everything the evaluator is given comes off disk.
    log = JSON.parse(readFileSync(runLogPath, "utf8")) as Record<
      string,
      unknown
    >;
    records = PEOPLE.map(
      (p) =>
        JSON.parse(
          readFileSync(join(outDir, p.id, "participant.json"), "utf8"),
        ) as ParticipantRecord,
    );
    labels = JSON.parse(
      readFileSync(join(sessionDir, "labels.json"), "utf8"),
    ) as LabelsRecord;
    report = evaluateRunJson(
      { logs: [log], records, labels: [labels] },
      { now: new Date("2026-10-06T00:00:00Z") },
    ) as KitV2Report;
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  // ── The producer's side, as the evaluator will find it ─────────────────────

  it("the log is the sorter's format 3 for kit v2: its protocol, the whole session record, the sheet, destinations and statuses", () => {
    expect(log.format).toBe(RUN_LOG_FORMAT);
    expect(log.protocol).toBe("agreed-v2");
    expect(log.kitVersion).toBe(2);
    expect(log.session).toEqual(SESSION);
    expect(log.sheet).toBe("A");
    const sort = (log.sort as { photos: Record<string, unknown>[] }).photos;
    expect(sort).toHaveLength(47);
    expect(sort[0]).toMatchObject({
      status: "ok",
      destination: "P001/G02/1.jpg",
      participant: "P001",
      gesture: "G02",
      hand: "right",
      shot: 1,
      poseSource: "order",
      extraShot: false,
    });
    // MediaPipe said left for P001's last photo: filed, flagged.
    expect(sort[4]).toMatchObject({
      destination: "P001/G04/2.jpg",
      status: "hand-mismatch",
    });
    // P003 uses the mouse with the left hand, from participant.json.
    expect(sort[10]).toMatchObject({ participant: "P003", hand: "left" });
  });

  it("the sorter leaves two kinds of photo unfiled: a file that is not a JPEG, and a participant in review", () => {
    const sort = (log.sort as { photos: Record<string, unknown>[] }).photos;
    // P003's last photo: placed in the shooting order, but no copy can be made.
    expect(sort[14]).toMatchObject({
      participant: "P003",
      gesture: "G04",
      shot: 2,
      status: "not-a-jpeg",
      destination: null,
    });
    // P008 has seven photos and no shotCounts: all seven are in review.
    const p008 = sort.filter((p) => p.participant === "P008");
    expect(p008).toHaveLength(7);
    expect(p008.every((p) => p.status === "needs-review")).toBe(true);
    expect(
      p008.every((p) => p.destination === null && p.gesture === null),
    ).toBe(true);
    const rows = (
      log.sort as {
        participants: { participant: string; reason: string | null }[];
      }
    ).participants;
    expect(rows.find((p) => p.participant === "P008")).toMatchObject({
      status: "needs-review",
      reason: "photo-count-not-planned",
    });
    // Neither is on the labels list, and neither has a filed copy.
    expect(labels.labels).toHaveLength(35 + 5 - 1);
    expect(existsSync(join(outDir, "P008"))).toBe(true); // only participant.json
    expect(existsSync(join(outDir, "P008", "G02"))).toBe(false);
    expect(existsSync(join(outDir, "P003", "G04", "2.jpg"))).toBe(false);
  });

  it("the real gates give the intended verdicts (the scenario is what it says it is)", () => {
    const accepted = (id: string) =>
      reportsOf(id).map((r) => r.productGates!.accepted);
    expect(accepted("P001")).toEqual([true, true, false, true, true]);
    expect(accepted("P002")).toEqual([false, true, true, true, true]);
    expect(accepted("P003")).toEqual([true, true, true, true, true]);
    const hidden = reportsOf("P001")[2]!.productGates!;
    expect(hidden.paper.errorCodes).toContain("PAPER_CORNER_HIDDEN");
    const unsure = reportsOf("P002")[0]!.productGates!;
    expect(unsure.hand!.errorCodes).toContain("LOW_LANDMARK_CONFIDENCE");
    // The mouse hand is not known to the browser: the handedness gate never fires.
    expect(
      photos.flatMap((p) => p.report.productGates?.hand?.errorCodes ?? []),
    ).not.toContain("HANDEDNESS_MISMATCH");
  });

  // ── The evaluator's side ───────────────────────────────────────────────────

  it("reads the log as kit v2: agreed-v2, accuracy dormant, the calibration set", () => {
    expect(report.protocol).toBe("agreed-v2");
    expect(report.accuracy).toEqual({
      status: "dormant",
      reason: "no ruler truth",
    });
    expect(report.inputs.participants).toEqual([...CALIBRATION]);
    expect(report.inputs.labelsFiles).toBe(1);
    expect(report.inputs.runLogs[0]).toMatchObject({
      session: "S001",
      sheet: "A",
    });
    expect(report.counts).toMatchObject({
      reports: 47,
      outOfScope: 15, // P004, P006 (held out) and P901 (S0)
      notMeasured: 7, // P008, in review: no pose, nothing to measure
      measured: 25, // the not-a-jpeg photo is measured all the same
    });
    expect(
      report.excluded.filter(
        (e) => e.reasons[0] === "NOT_ASSIGNED:needs-review",
      ),
    ).toHaveLength(7);
    expect(report.selection).toMatchObject({
      mode: "calibration",
      known: 9,
      inSet: 6,
      roles: { calibration: 6, "held-out": 2, s0: 1, pending: 0 },
      leftOutPhotos: { "held-out": 10, s0: 5 },
    });
  });

  it("judgement correctness: 24 labelled, 22 agree (91.7 %), 1 false accept, 1 false reject, by pose and reason", () => {
    // Product (photo-quality gates) against the label, from the scenario table:
    // P002: #1 FALSE REJECT, #4 FALSE ACCEPT. Every other labelled photo agrees.
    const j = report.kitV2.judgement;
    const h = j.headline!;
    expect(h.photos).toBe(24);
    expect(h.agree).toBe(22);
    expect(h.agreementRate).toBeCloseTo(22 / 24, 12);
    expect(h.falseAccepts).toBe(1);
    expect(h.falseRejects).toBe(1);
    expect(h.labelGood).toBe(22);
    expect(h.labelBad).toBe(2);
    expect(h.productAccepted).toBe(22);
    expect(h.productRetake).toBe(2);
    expect(h.falseAcceptShareOfBad).toBeCloseTo(1 / 2, 12);
    expect(h.falseRejectShareOfGood).toBeCloseTo(1 / 22, 12);
    expect(j.target).toBe(0.95);
    expect(j.notBlind).toBeNull();
    expect(h.byPose[0]).toMatchObject({
      gesture: "G02",
      photos: 15,
      agree: 14,
      falseRejects: 1,
    });
    expect(h.byPose[1]).toMatchObject({
      gesture: "G04",
      photos: 9,
      agree: 8,
      falseAccepts: 1,
    });
    const by = Object.fromEntries(h.byReason.map((r) => [r.reason, r]));
    expect(by["corner-hidden"]).toMatchObject({
      badPhotos: 1,
      retake: 1,
      accepted: 0,
    });
    expect(by["hand-off-sheet"]).toMatchObject({
      badPhotos: 1,
      retake: 0,
      accepted: 1,
    });
    expect(j.sessions).toMatchObject({
      withPhotos: 1,
      withLabelsFile: 1,
      blind: 1,
    });
  });

  it("the unfiled photos and the participant in review are counted by status and reason, and are not in the judgement", () => {
    const c = report.kitV2.judgement.coverage;
    // 25 photos of evaluated participants have a pose; 24 of them were filed and labelled.
    expect(c).toMatchObject({
      photos: 25,
      labelled: 24,
      unlabelled: 1,
      labelsWithNoPhoto: 0, // labels name the sorter's destinations, verbatim
    });
    expect(c.unlabelledBy).toEqual({
      noSession: 0,
      noLabelsFile: 0,
      noLabel: 0,
      notFiled: 1, // P003's not-a-jpeg
      notLabelledYet: 0,
    });
    // Everything unfiled, by the sorter's status: P008's seven and P003's one.
    expect(c.notFiled).toEqual({
      total: 8,
      byStatus: { "needs-review": 7, "not-a-jpeg": 1 },
    });
    expect(c.participantsInReview).toEqual({
      total: 1,
      byReason: { "photo-count-not-planned": 1 },
    });
    const md = renderMarkdown(report);
    expect(md).toMatch(
      /Photos the sorter did not file, so none can be labelled and none is in the judgement: 8 \(needs-review x7, not-a-jpeg x1\)\. Participants in review \(nothing of theirs is filed\): 1 \(photo-count-not-planned x1\)\./,
    );
  });

  it("G02 repeatability: the pooled within-person SD of the recorded marker hand lengths, 5 people, 15 photos, reference 1.0 mm", () => {
    const groups = CALIBRATION.map(g02Lengths);
    const pooled = Math.sqrt(
      groups.reduce((sum, g) => sum + (g.length - 1) * sd(g) ** 2, 0) /
        groups.reduce((sum, g) => sum + (g.length - 1), 0),
    );
    const rep = report.kitV2.repeatability;
    expect(rep.pooledSdMm).toBeCloseTo(pooled, 6);
    expect(rep.people).toBe(5);
    expect(rep.photos).toBe(15);
    expect(rep.degreesOfFreedom).toBe(10);
    expect(rep.referenceMm).toBe(1.0);
    expect(rep).not.toHaveProperty("withinLimit");
  });

  it("path agreement: paper-edge minus marker, each person's mean first", () => {
    const diffs = (id: string) =>
      reportsOf(id, "G02").map(
        (r) => r.paperMm!.handLengthMm - r.markerMm!.handLengthMm,
      );
    const means = CALIBRATION.map((id) => mean(diffs(id)));
    const a = report.kitV2.pathAgreement;
    expect(a.personLevel!.n).toBe(5);
    expect(a.personLevel!.biasMm).toBeCloseTo(mean(means), 6);
    expect(a.personLevel!.sdMm).toBeCloseTo(sd(means), 6);
    const all = CALIBRATION.flatMap(diffs);
    expect(a.photoLevel!.n).toBe(15);
    expect(a.photoLevel!.biasMm).toBeCloseTo(mean(all), 6);
  });

  it("curl ratio: the recorded sheet-mm wrist-to-fingertip length of each claw over the person's mean G02 hand length", () => {
    const projected = (r: LearningPhotoReport) => {
      const lm = r.markerPlane!.landmarksSheetMm!;
      return dist(lm[0]!, lm[12]!);
    };
    const ratios = (id: string) => {
      const g02 = mean(reportsOf(id, "G02").map(projected));
      return reportsOf(id, "G04").map((r) => projected(r) / g02);
    };
    const c = report.kitV2.curl;
    expect(c.people).toBe(5);
    expect(c.photos).toBe(10); // P003's unfiled claw is one of them
    const personMeans = CALIBRATION.map((id) => mean(ratios(id)));
    expect(c.distribution!.mean).toBeCloseTo(mean(personMeans), 6);
    expect(c.distribution!.min).toBeCloseTo(Math.min(...personMeans), 6);
    expect(c.distribution!.max).toBeCloseTo(Math.max(...personMeans), 6);
    const row = c.rows.find((r) => r.participant === "P001")!;
    expect(row.meanRatio).toBeCloseTo(mean(ratios("P001")), 6);
    expect(row.sdRatio).toBeCloseTo(sd(ratios("P001")), 6);
    // A claw is shorter than the flat hand.
    expect(c.distribution!.max).toBeLessThan(1);
  });

  it("product-gate acceptance and the S0 checks, per pose", () => {
    const [g02, g04] = report.kitV2.gate.poses;
    // P001#3 and P002#1 are refused; every G04 photo is accepted.
    expect(g02).toMatchObject({
      gesture: "G02",
      photos: 15,
      accepted: 13,
      handDetected: 15,
      handLabelChecked: 15,
      handLabelAgrees: 15,
    });
    expect(g04).toMatchObject({
      gesture: "G04",
      photos: 10,
      accepted: 10,
      handDetected: 10,
      handLabelChecked: 10,
      handLabelAgrees: 9,
    });
  });

  it("coverage: 10 mm bins of each person's mean recorded hand length, phone and sheet from the embedded session, the left-handed participant", () => {
    const means = CALIBRATION.map((id) => mean(g02Lengths(id)));
    const cov = report.kitV2.coverage;
    const bins = new Map<number, number>();
    for (const m of means) {
      const from = Math.floor(m / 10) * 10;
      bins.set(from, (bins.get(from) ?? 0) + 1);
    }
    for (const b of cov.handLengthBins) {
      expect(b.people).toBe(bins.get(b.fromMm) ?? 0);
    }
    expect(cov.handLengthBins.reduce((s, b) => s + b.people, 0)).toBe(5);
    // P008 is in review: no measured photo, so not a person of this run's coverage.
    expect(cov.people).toBe(5);
    expect(cov.photos).toBe(25);
    expect(cov.byPhone).toEqual([
      { value: "Phone X, main 1x", people: 5, photos: 25 },
    ]);
    expect(cov.bySheet).toEqual([{ value: "A", people: 5, photos: 25 }]);
    expect(cov.byMouseHand).toEqual([
      { value: "left", people: 1, photos: 5 },
      { value: "right", people: 4, photos: 20 },
    ]);
  });

  it("grip calibration: r from the recorded palm and hand lengths against the grip each person reported, with the product's own thresholds", () => {
    const r = (id: string) =>
      mean(
        reportsOf(id, "G02").map(
          (x) => x.markerMm!.palmLengthMm / x.markerMm!.handLengthMm,
        ),
      );
    const predicted = (ratio: number) =>
      ratio >= GRIP_PREDICTION.palmAtOrAbove
        ? "palm"
        : ratio >= GRIP_PREDICTION.clawAtOrAbove
          ? "claw"
          : "fingertip";
    // By construction: r = 0.55 (claw), 0.61 (palm), 0.50 (fingertip), 0.55 (claw), 0.59 (palm).
    expect(CALIBRATION.map((id) => predicted(r(id)))).toEqual([
      "claw",
      "palm",
      "fingertip",
      "claw",
      "palm",
    ]);
    const g = report.kitV2.grip;
    expect(g.people).toBe(5);
    // P008 (in review) has no photo with a pose, so it is not a person of this run at all.
    expect(g.skipped).toMatchObject({ noG02: 0, noRecord: 0 });
    const cal = g.calibration!;
    expect(cal.current.thresholds).toEqual({
      palmAtOrAbove: GRIP_PREDICTION.palmAtOrAbove,
      clawAtOrAbove: GRIP_PREDICTION.clawAtOrAbove,
    });
    // P003 says claw but is predicted fingertip; the other four agree.
    expect(cal.current.matrix).toEqual({
      palm: { palm: 2, claw: 0, fingertip: 0 },
      claw: { palm: 0, claw: 2, fingertip: 1 },
      fingertip: { palm: 0, claw: 0, fingertip: 0 },
    });
    expect(cal.current.agree).toBe(4);
    // One pair puts all five right: claw from just below P003's r, palm between the claws' r and P007's.
    expect(cal.best.agreement.agree).toBe(5);
    expect(cal.best.tiedPairs).toBe(1);
    expect(cal.best.agreement.thresholds.clawAtOrAbove).toBeLessThan(r("P003"));
    expect(cal.best.agreement.thresholds.palmAtOrAbove).toBeGreaterThan(
      Math.max(r("P001"), r("P005")),
    );
    expect(cal.best.agreement.thresholds.palmAtOrAbove).toBeLessThan(r("P007"));
  });

  it("held-out and S0 are left out by default, and each can be evaluated alone", () => {
    const run = (options: Parameters<typeof evaluateRunJson>[1]) =>
      evaluateRunJson(
        { logs: [log], records, labels: [labels] },
        options,
      ) as KitV2Report;
    const held = run({ selection: "held-out" });
    expect(held.inputs.participants).toEqual(["P004", "P006"]);
    expect(held.notices).toEqual([HELD_OUT_NOTICE]);
    // Their G02 SD from the recorded lengths; P004's labels have one bad (blur, accepted: a false accept).
    const groups = ["P004", "P006"].map(g02Lengths);
    const pooled = Math.sqrt(
      groups.reduce((sum, g) => sum + (g.length - 1) * sd(g) ** 2, 0) /
        groups.reduce((sum, g) => sum + (g.length - 1), 0),
    );
    expect(held.kitV2.repeatability.pooledSdMm).toBeCloseTo(pooled, 6);
    expect(held.kitV2.judgement.headline).toMatchObject({
      photos: 10,
      falseAccepts: 1,
      agree: 9,
    });
    expect(held.kitV2.judgement.coverage.participantsInReview.total).toBe(0);
    const s0 = run({ selection: "s0" });
    expect(s0.inputs.participants).toEqual(["P901"]);
    expect(s0.notices).toEqual([]);
    expect(s0.kitV2.judgement.headline).toMatchObject({ photos: 5, agree: 5 });
    // Neither shows in the default run's numbers: it has 25 photos, not 35 or 30.
    expect(report.kitV2.coverage.photos).toBe(25);
  });

  it("--aggregate-only on the real log leaves no participant code, file name or destination", () => {
    const aggregate = toAggregateOnly(report) as KitV2Report;
    const text = JSON.stringify(aggregate) + renderMarkdown(aggregate);
    expect(text).not.toMatch(/P\d{3}/);
    expect(text).not.toMatch(/IMG_|\.jpg/);
    expect(aggregate.kitV2.judgement).toEqual(report.kitV2.judgement);
    expect(renderMarkdown(report)).toMatch(/handedness gate left out/);
  });

  it("the real script gives the same numbers from the files on disk", () => {
    const out = join(scratch, "reports", "e2e.json");
    const result = spawnSync(
      process.execPath,
      [
        TSX,
        SCRIPT,
        "--log",
        runLogPath,
        "--records",
        outDir,
        "--session",
        sessionDir,
        "--labels",
        sessionDir,
        "--out",
        out,
      ],
      {
        cwd: REPO,
        encoding: "utf8",
        timeout: 90_000,
        env: { ...process.env, CI: "" },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^# M2 evaluation \(agreed-v2\)/);
    expect(result.stdout).toMatch(
      /Labelled photos: 24 \(labels: 22 good, 2 bad; product: 22 accepted, 2 retake\)\./,
    );
    expect(result.stdout).toMatch(
      /\| agreement \(accepted and good, or retake and bad\) \| 22 \| 91\.7% \|/,
    );
    expect(result.stdout).toMatch(/needs-review x7, not-a-jpeg x1/);
    const fromScript = JSON.parse(readFileSync(out, "utf8")) as KitV2Report;
    // The same report as the in-process run (only the clock differs).
    expect(fromScript.kitV2).toEqual(JSON.parse(JSON.stringify(report.kitV2)));
    expect(fromScript.selection).toEqual(
      JSON.parse(JSON.stringify(report.selection)),
    );
    expect(fromScript.counts).toEqual(report.counts);
  });
});
