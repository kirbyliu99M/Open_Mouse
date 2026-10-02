import { describe, expect, it } from "vitest";
import {
  evaluateLearningPhoto,
  type LearningFindings,
} from "../../src/lib/learning/checks";
import { sheetReference } from "../../src/lib/learning/findings";
import {
  KIT_V1_VERSION,
  LEARNING_KIT_VERSION,
  type KitCode,
} from "../../src/lib/learning/kit";
import { analyseBatch } from "../../src/lib/learning/batch";
import { fileTimeInversions } from "../../src/lib/learning/order";
import {
  assembleFailedReport,
  assembleLearningReport,
  type LearningPhotoReport,
  type ReportFindings,
} from "../../src/lib/learning/report";
import {
  NO_PROVENANCE,
  RUN_LOG_FORMAT,
  RUN_LOG_FORMAT_V2,
  buildRunLog,
  sortReports,
  sortReportsV2,
} from "../../src/lib/learning/runlog";
import {
  PROTOCOL_AGREED_V2,
  SESSION_FORMAT,
  type SessionRecord,
} from "../../src/lib/learning/session";
import { sheetAMarkers } from "../../src/lib/learning/layoutv2";
import { syntheticHand } from "./helpers/synthetic-hand";
import {
  buildSyntheticCamera,
  projectSheetMm,
} from "./helpers/synthetic-camera";
import type { DetectedMarker } from "../../src/client/photo/markers";

const card = (participant: string, version = 2): KitCode => ({
  kind: "participant",
  version,
  participant,
});

const SHARP = 1000;

function checkFindings(over: Partial<LearningFindings> = {}): LearningFindings {
  return {
    code: card("P901"),
    markerIds: [0, 1, 2, 3],
    reprojectionErrorMm: 0.2,
    laplacianVariance: SHARP,
    handFound: true,
    detectedHand: null,
    paperCornersSeen: 4,
    sheet: "A",
    ...over,
  };
}

const ids = (checks: readonly { id: string }[]) => checks.map((c) => c.id);
const tone = (
  checks: readonly { id: string; tone: string }[],
  id: string,
): string | undefined => checks.find((c) => c.id === id)?.tone;

describe("evaluateLearningPhoto, kit v2", () => {
  it("sheet A, everything in order: ready, with the card's participant named", () => {
    const { checks, verdict } = evaluateLearningPhoto(checkFindings());
    expect(verdict).toBe("ready");
    expect(checks[0]).toMatchObject({
      id: "qr",
      tone: "ok",
      message: "Participant P901.",
    });
    expect(ids(checks)).toEqual([
      "qr",
      "markers",
      "fit",
      "paper",
      "sharp",
      "hand",
    ]);
    expect(checks.every((c) => c.tone === "ok")).toBe(true);
  });

  it("never judges the hand against a page, since there is no hand on the page: no handedness check", () => {
    const { checks, verdict } = evaluateLearningPhoto(
      checkFindings({ detectedHand: "left" }),
    );
    expect(ids(checks)).not.toContain("handedness");
    expect(verdict).toBe("ready");
  });

  it("a participant card does not end the checks: a v2 photo is a hand photo, not a slate", () => {
    const { verdict, checks } = evaluateLearningPhoto(
      checkFindings({ handFound: false }),
    );
    expect(verdict).toBe("retake");
    expect(tone(checks, "hand")).toBe("bad");
  });

  it("no QR code, or a code that is not a kit v2 participant card: not identified", () => {
    for (const code of [
      null,
      card("P901", 1),
      { kind: "gesture", version: 2, gesture: "G02", hand: "right" } as KitCode,
    ]) {
      const { checks, verdict } = evaluateLearningPhoto(
        checkFindings({ code }),
      );
      expect(verdict).toBe("unidentified");
      expect(tone(checks, "qr")).toBe("bad");
    }
    expect(
      evaluateLearningPhoto(checkFindings({ code: card("P901", 1) })).checks[0]!
        .message,
    ).toMatch(/kit v1 code and this run is kit v2/);
  });

  it("sheet A needs all four corner markers", () => {
    const { checks, verdict } = evaluateLearningPhoto(
      checkFindings({ markerIds: [0, 1, 3] }),
    );
    expect(verdict).toBe("retake");
    expect(checks.find((c) => c.id === "markers")!.message).toMatch(
      /Corner marker 2 not found/,
    );
  });

  it("sheet B takes any four of its six, and says how many it found", () => {
    const b = (markerIds: number[]) =>
      evaluateLearningPhoto(
        checkFindings({ sheet: "B", markerIds }),
      ).checks.find((c) => c.id === "markers")!;
    expect(b([0, 1, 2, 3, 4, 5])).toMatchObject({ tone: "ok" });
    expect(b([0, 1, 2, 3, 4, 5]).message).toMatch(/6 of 6/);
    expect(b([1, 3, 4, 5])).toMatchObject({ tone: "ok" });
    expect(b([1, 3, 4, 5]).message).toMatch(/4 of 6/);
    expect(b([3, 4, 5])).toMatchObject({ tone: "bad" });
    // Duplicates and ids that are not on the sheet do not count.
    expect(b([0, 0, 0, 0, 6, 7])).toMatchObject({ tone: "bad" });
  });

  it("sheet B with only the bottom row warns that the plane is carried over the hand from one side", () => {
    const c = evaluateLearningPhoto(
      checkFindings({ sheet: "B", markerIds: [2, 3, 4, 5] }),
    );
    expect(tone(c.checks, "markers")).toBe("warn");
    expect(c.verdict).toBe("ready");
  });

  it("a poor fit, a blurry photo and missing paper corners are said apart", () => {
    const bad = evaluateLearningPhoto(
      checkFindings({
        reprojectionErrorMm: 9,
        laplacianVariance: 0,
        paperCornersSeen: 2,
      }),
    );
    expect(tone(bad.checks, "fit")).toBe("bad");
    expect(tone(bad.checks, "sharp")).toBe("bad");
    expect(tone(bad.checks, "paper")).toBe("warn");
    expect(bad.verdict).toBe("retake");
  });

  it("without the sheet it is the kit v1 evaluation, unchanged", () => {
    const v1 = evaluateLearningPhoto({
      ...checkFindings(),
      sheet: undefined,
      code: card("P012", 1),
    });
    expect(v1.verdict).toBe("slate");
  });
});

// ── Reports ────────────────────────────────────────────────────────────────

const camera = buildSyntheticCamera({ tiltDeg: 8, distanceMm: 420, fPx: 3200 });
const toImage = (p: { x: number; y: number }) =>
  projectSheetMm(camera, { x: p.x - 105, y: p.y - 148.5 });
const sheetAMarkerDetections: DetectedMarker[] = sheetAMarkers().map((m) => ({
  id: m.id,
  corners: m.corners.map(toImage) as unknown as DetectedMarker["corners"],
}));

function findings(over: Partial<ReportFindings> = {}): ReportFindings {
  return {
    file: "IMG_0001.jpg",
    width: 3024,
    height: 4032,
    paperSize: "a4",
    exif: null,
    exifFocalPx: null,
    qrText: "https://open-mouse.vercel.app/l/v2/P901",
    code: card("P901"),
    markers: sheetAMarkerDetections,
    laplacianVariance: SHARP,
    reference: sheetReference(sheetAMarkerDetections, "A"),
    paper: null,
    hand: {
      landmarksPx: syntheticHand(
        { curl: 0 },
        { scale: 2, offset: { x: 1500, y: 2500 } },
      ),
      handedness: "right",
      confidence: 0.99,
    },
    sheet: "A",
    ...over,
  };
}

describe("assembleLearningReport, kit v2", () => {
  const report = assembleLearningReport(findings());

  it("is a hand photo: the participant card's code does not blank the hand, the planes or the measurements", () => {
    expect(report.kitVersion).toBe(LEARNING_KIT_VERSION);
    expect(report.code).toEqual(card("P901"));
    expect(report.qrText).toBe("https://open-mouse.vercel.app/l/v2/P901");
    expect(report.hand).not.toBeNull();
    expect(report.hand!.landmarksPx).toHaveLength(21);
    expect(report.markerPlane).not.toBeNull();
    expect(report.markerPlane!.method).toBe("markers");
    expect(report.reprojectionErrorMm).toBeLessThan(1e-6);
    expect(report.verdict).toBe("ready");
  });

  it("the same findings without a sheet are a kit v1 card: no hand, no plane, a slate", () => {
    const v1 = assembleLearningReport(
      findings({ sheet: undefined, code: card("P901", 1) }),
    );
    expect(v1.kitVersion).toBe(KIT_V1_VERSION);
    expect(v1.verdict).toBe("slate");
    expect(v1.hand).toBeNull();
    expect(v1.markerPlane).toBeNull();
  });
});

describe("run log format 3", () => {
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
  const reports = [assembleLearningReport(findings())];

  it("names its format, and keeps the old one for kit v1 logs", () => {
    expect(RUN_LOG_FORMAT).toBe("open-mouse-learning-run/3");
    expect(RUN_LOG_FORMAT_V2).toBe("open-mouse-learning-run/2");
  });

  it("a kit v2 log carries the protocol, the whole session record and the sheet", () => {
    const log = buildRunLog({
      reports,
      sort: sortReportsV2(reports),
      paperSize: "a4",
      input: "../Photos/session-1",
      provenance: NO_PROVENANCE,
      now: new Date("2026-10-03T00:00:00Z"),
      kitV2: { session: SESSION, sheet: "A" },
    });
    expect(log.format).toBe("open-mouse-learning-run/3");
    expect(log.kitVersion).toBe(2);
    expect(log.protocol).toBe("agreed-v2");
    expect(log.session).toEqual(SESSION);
    expect(log.sheet).toBe("A");
    expect(log.reports[0]!.kitVersion).toBe(2);
  });

  it("a download from the checker page has the protocol and sheet but no session", () => {
    const log = buildRunLog({
      reports,
      sort: sortReportsV2(reports),
      paperSize: "a4",
      input: null,
      provenance: NO_PROVENANCE,
      now: new Date(0),
      kitV2: { session: null, sheet: "B" },
    });
    expect([log.kitVersion, log.protocol, log.session, log.sheet]).toEqual([
      2,
      "agreed-v2",
      null,
      "B",
    ]);
  });

  it("a kit v1 log has none of them (null), and kitVersion 1", () => {
    const v1 = [
      assembleLearningReport(
        findings({ sheet: undefined, code: card("P901", 1) }),
      ),
    ];
    const log = buildRunLog({
      reports: v1,
      sort: sortReports(v1),
      paperSize: "a4",
      input: null,
      provenance: NO_PROVENANCE,
      now: new Date(0),
    });
    expect([log.kitVersion, log.protocol, log.session, log.sheet]).toEqual([
      1,
      null,
      null,
      null,
    ]);
  });
});

describe("sortReportsV2", () => {
  /** A report of one photo of a participant: a hand shaped by `curl`, with MediaPipe's label. */
  function shot(
    file: string,
    participant: string,
    curl: number,
    over: Partial<ReportFindings> = {},
    handedness: "left" | "right" = "right",
  ): LearningPhotoReport {
    return assembleLearningReport(
      findings({
        file,
        code: card(participant),
        qrText: `https://open-mouse.vercel.app/l/v2/${participant}`,
        hand: {
          landmarksPx: syntheticHand(
            { curl },
            { scale: 3, rotationDeg: 20, offset: { x: 1500, y: 2500 } },
          ),
          handedness,
          confidence: 0.9,
        },
        ...over,
      }),
    );
  }

  const planned = (participant: string, first: number, curls: number[]) =>
    curls.map((curl, i) => shot(`IMG_${first + i}.jpg`, participant, curl));

  it("goes by natural file-name order, and runs the pose check on each photo's landmarks", () => {
    const reports = [
      // Given out of order: IMG_10 is after IMG_9.
      ...planned("P901", 9, [0, 0, 0, 1, 1]).reverse(),
    ];
    const sort = sortReportsV2(reports);
    expect(
      sort.photos.map((p) => [p.file, p.gesture, p.shot, p.status]),
    ).toEqual([
      ["IMG_9.jpg", "G02", 1, "ok"],
      ["IMG_10.jpg", "G02", 2, "ok"],
      ["IMG_11.jpg", "G02", 3, "ok"],
      ["IMG_12.jpg", "G04", 1, "ok"],
      ["IMG_13.jpg", "G04", 2, "ok"],
    ]);
    expect(sort.photos.map((p) => p.poseCheck)).toEqual([
      { predicted: "G02", agrees: true },
      { predicted: "G02", agrees: true },
      { predicted: "G02", agrees: true },
      { predicted: "G04", agrees: true },
      { predicted: "G04", agrees: true },
    ]);
  });

  it("flags a claw shot in a G02 slot, and does not move it", () => {
    const sort = sortReportsV2(planned("P902", 1, [0, 1, 0, 1, 1]));
    expect(sort.photos[1]).toMatchObject({
      gesture: "G02",
      shot: 2,
      status: "pose-mismatch",
      poseCheck: { predicted: "G04", agrees: false },
      destination: "P902/G02/2.jpg",
    });
  });

  it("does not place an extra photo by the pose check: six photos need shotCounts, whatever the landmarks look like", () => {
    // Three flat, three claws: clear calls, but the check only flags.
    const six = planned("P903", 1, [0, 0, 0, 1, 1, 1]);
    const review = sortReportsV2(six);
    expect(review.photos.every((p) => p.status === "needs-review")).toBe(true);
    expect(review.participants[0]!.reason).toBe("photo-count-not-planned");
    // With Kirby's counts the extra goes where the counts say: here G02, against the calls.
    const counted = sortReportsV2(six, {
      shotCounts: { P903: { G02: 4, G04: 2 } },
    });
    expect(
      counted.photos.map((p) => [p.gesture, p.shot, p.extraShot, p.status]),
    ).toEqual([
      ["G02", 1, false, "ok"],
      ["G02", 2, false, "ok"],
      ["G02", 3, false, "ok"],
      ["G02", 4, true, "pose-mismatch"],
      ["G04", 1, false, "ok"],
      ["G04", 2, false, "ok"],
    ]);
  });

  it("files a photo the product would have you retake: it is data, and dropping it would shift the order", () => {
    const blurry = shot("IMG_2.jpg", "P904", 0, { laplacianVariance: 0 });
    expect(blurry.verdict).toBe("retake");
    const noHand = shot("IMG_3.jpg", "P904", 0, { hand: null });
    expect(noHand.verdict).toBe("retake");
    const reports = [
      shot("IMG_1.jpg", "P904", 0),
      blurry,
      noHand,
      shot("IMG_4.jpg", "P904", 1),
      shot("IMG_5.jpg", "P904", 1),
    ];
    // kit v1's sortReports would not file the two retakes; kit v2 files all five.
    const sort = sortReportsV2(reports);
    expect(sort.photos.every((p) => p.destination !== null)).toBe(true);
    expect(sort.photos.map((p) => p.gesture)).toEqual([
      "G02",
      "G02",
      "G02",
      "G04",
      "G04",
    ]);
    expect(sort.photos[2]!.poseCheck).toEqual({
      predicted: null,
      agrees: null,
    });
  });

  it("takes the hand from the participant record and flags MediaPipe's label when it differs", () => {
    const reports = [
      shot("IMG_1.jpg", "P905", 0, {}, "right"),
      shot("IMG_2.jpg", "P905", 0, {}, "left"),
    ];
    const sort = sortReportsV2(reports, {
      mouseHands: { P905: "right" },
      shotCounts: { P905: { G02: 2, G04: 0 } },
    });
    expect(sort.photos.map((p) => [p.hand, p.status])).toEqual([
      ["right", "ok"],
      ["right", "hand-mismatch"],
    ]);
  });

  it("a report with no QR code (a failed one, a photo of nothing) is not filed", () => {
    const failed = assembleLearningReport(
      findings({ file: "IMG_0.jpg", code: null, qrText: null, hand: null }),
    );
    const sort = sortReportsV2([failed]);
    expect(sort.photos[0]).toMatchObject({
      status: "no-code",
      destination: null,
    });
  });
});

describe("fileTimeInversions", () => {
  const f = (file: string, mtimeMs: number) => ({ file, mtimeMs });

  it("is 0 when file-name order and file-time order agree, or the times are all equal", () => {
    expect(
      fileTimeInversions([
        f("IMG_0001.jpg", 1),
        f("IMG_0002.jpg", 2),
        f("IMG_0010.jpg", 3),
      ]),
    ).toBe(0);
    expect(
      fileTimeInversions([
        f("IMG_0001.jpg", 5),
        f("IMG_0002.jpg", 5),
        f("IMG_0003.jpg", 5),
      ]),
    ).toBe(0);
    expect(fileTimeInversions([])).toBe(0);
    expect(fileTimeInversions([f("a.jpg", 9)])).toBe(0);
  });

  it("counts photos older than the one before them, in natural name order", () => {
    // IMG_9 is before IMG_10 by name; here IMG_10 was written first.
    expect(fileTimeInversions([f("IMG_10.jpg", 1), f("IMG_9.jpg", 2)])).toBe(1);
    // A phone that restarted its numbering: IMG_0001 is newest.
    expect(
      fileTimeInversions([
        f("IMG_0001.jpg", 100),
        f("IMG_0002.jpg", 101),
        f("IMG_9998.jpg", 10),
        f("IMG_9999.jpg", 11),
      ]),
    ).toBe(1);
  });
});

describe("a photo that could not be analysed, in a kit v2 log", () => {
  it("says which kit the run was, and kit v1 by default", () => {
    expect(
      assembleFailedReport("IMG_1.jpg", "a4", "boom", "TypeError").kitVersion,
    ).toBe(KIT_V1_VERSION);
    expect(
      assembleFailedReport(
        "IMG_1.jpg",
        "a4",
        "boom",
        "TypeError",
        LEARNING_KIT_VERSION,
      ).kitVersion,
    ).toBe(LEARNING_KIT_VERSION);
  });

  it("analyseBatch stamps the failed reports of a kit v2 batch as kit v2, the others as they come", async () => {
    const files = [{ name: "IMG_1.jpg" }, { name: "IMG_2.jpg" }];
    const reports = await analyseBatch(
      files,
      async (f) => {
        if (f.name === "IMG_1.jpg") throw new Error("detector crash");
        return assembleLearningReport(findings({ file: f.name }));
      },
      { paperSize: "a4", kitVersion: LEARNING_KIT_VERSION },
    );
    expect(reports.map((r) => [r.file, r.kitVersion])).toEqual([
      ["IMG_1.jpg", 2],
      ["IMG_2.jpg", 2],
    ]);
    // Without the option (kit v1) a failed report stays kit v1.
    const v1 = await analyseBatch(
      [{ name: "IMG_1.jpg" }],
      async () => {
        throw new Error("x");
      },
      { paperSize: "a4" },
    );
    expect(v1[0]!.kitVersion).toBe(KIT_V1_VERSION);
    // And the run log built from a v2 batch has no report claiming v1.
    const log = buildRunLog({
      reports,
      sort: sortReportsV2(reports),
      paperSize: "a4",
      input: null,
      provenance: NO_PROVENANCE,
      now: new Date(0),
      kitV2: { session: null, sheet: "A" },
    });
    expect(log.reports.every((r) => r.kitVersion === log.kitVersion)).toBe(
      true,
    );
  });
});
