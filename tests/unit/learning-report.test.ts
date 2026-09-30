import { describe, expect, it } from "vitest";
import type { Point2 } from "../../src/client/geometry/homography";
import type { DetectedMarker } from "../../src/client/photo/markers";
import { computeSheetLayout } from "../../src/client/sheet/layout";
import { readExifWhitelist } from "../../src/lib/learning/exif";
import {
  markerReference,
  paperFindings,
  stripReference,
} from "../../src/lib/learning/findings";
import { LEARNING_KIT_VERSION, type KitCode } from "../../src/lib/learning/kit";
import { computeKitLayout } from "../../src/lib/learning/layout";
import { recomputePlane } from "../../src/lib/learning/plane";
import {
  assembleFailedReport,
  assembleLearningReport,
  stampProvenance,
  type LearningPhotoReport,
  type ReportFindings,
} from "../../src/lib/learning/report";
import { sortReports } from "../../src/lib/learning/runlog";
import { buildExifJpeg, phoneSpec, PRIVATE } from "./helpers/exif-jpeg";
import {
  INDEPENDENT_SCENE,
  TRUE_HAND_LENGTH_MM,
  TRUE_PALM_WIDTH_MM,
  independentShot,
} from "./helpers/learning-scene";
import { independentSceneCamera } from "./helpers/independent-scene";

const G01R: KitCode = {
  kind: "gesture",
  version: 1,
  gesture: "G01",
  hand: "right",
};
const SLATE: KitCode = {
  kind: "participant",
  version: 1,
  participant: "P007",
};

const shot = independentShot();
const camera = independentSceneCamera(shot.scene);

/** ArUco detections the printed layout would give through the scene's camera. */
function detect(
  markers: readonly { id: number; corners: readonly Point2[] }[],
  ids: readonly number[],
): DetectedMarker[] {
  return markers
    .filter((m) => ids.includes(m.id))
    .map((m) => ({
      id: m.id,
      corners: m.corners.map((c) => camera.project(c.x, c.y, 0)) as [
        Point2,
        Point2,
        Point2,
        Point2,
      ],
    }));
}

const flatMarkers = detect(computeSheetLayout().markers, [0, 1, 2, 3]);
const stripMarkers = detect(computeKitLayout("side").markers, [4, 5]);

const HAND = {
  landmarksPx: shot.landmarksPx,
  handedness: "right" as const,
  confidence: 0.93,
};

function findings(over: Partial<ReportFindings> = {}): ReportFindings {
  return {
    file: "IMG_0001.jpg",
    width: shot.imageSize.width,
    height: shot.imageSize.height,
    paperSize: "a4",
    exif: readExifWhitelist(buildExifJpeg(phoneSpec())),
    exifFocalPx: shot.exifFocalPx,
    qrText: "https://open-mouse.vercel.app/l/v1/G01R",
    code: G01R,
    markers: flatMarkers,
    laplacianVariance: 400,
    reference: markerReference(flatMarkers),
    paper: paperFindings(shot.quad, "a4"),
    hand: HAND,
    ...over,
  };
}

const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("markerReference / stripReference", () => {
  it("builds the flat homography from the four corner markers, with a tiny fit error", () => {
    const ref = markerReference(flatMarkers)!;
    expect(ref.method).toBe("markers");
    expect(ref.reprojectionErrorMm).toBeLessThan(1e-6);
  });

  it("needs all four", () => {
    expect(markerReference(flatMarkers.slice(0, 3))).toBeNull();
    expect(markerReference([])).toBeNull();
  });

  it("builds the strip homography from both strip markers, and only then", () => {
    const ref = stripReference(stripMarkers)!;
    expect(ref.method).toBe("strip-markers");
    expect(ref.reprojectionErrorMm).toBeNull();
    expect(stripReference(stripMarkers.slice(0, 1))).toBeNull();
    expect(stripReference(flatMarkers)).toBeNull();
  });
});

describe("a top-down report (format 2)", () => {
  const report = assembleLearningReport(findings());

  it("names the code that made it and the sheet it assumed", () => {
    expect(report.kitVersion).toBe(LEARNING_KIT_VERSION);
    expect(report.paperSize).toBe("a4");
    expect(report.gitSha).toBeNull();
    expect(report.gitDirty).toBeNull();
    expect(report.file).toBe("IMG_0001.jpg");
  });

  it("holds both planes, each with a 3x3 homography and 21 sheet-mm landmarks", () => {
    for (const plane of [report.markerPlane!, report.paperPlane!]) {
      expect(plane.homography).toHaveLength(3);
      for (const row of plane.homography) expect(row).toHaveLength(3);
      expect(plane.landmarksSheetMm).toHaveLength(21);
      expect(plane.parallax).toMatchObject({
        corrected: true,
        focalSource: "exif",
      });
    }
    expect(report.markerPlane!.method).toBe("markers");
    expect(report.paperPlane!.method).toBe("paper-edge");
    expect(report.markerPlane!.fit.reprojectionErrorMm).not.toBeNull();
    expect(report.paperPlane!.fit.edgeFitResidualMm).not.toBeNull();
  });

  it("measures through both planes with the product's parallax-corrected algorithm", () => {
    for (const mm of [report.markerMm!, report.paperMm!]) {
      expect(Math.abs(mm.handLengthMm - TRUE_HAND_LENGTH_MM)).toBeLessThan(0.5);
      expect(Math.abs(mm.palmWidthMm - TRUE_PALM_WIDTH_MM)).toBeLessThan(0.5);
    }
  });

  it("is a ready photo: four markers, four paper corners, a hand of the page's hand", () => {
    expect(report.verdict).toBe("ready");
    expect(report.checks.map((c) => c.id)).not.toContain("handedness");
  });

  it("can be recomputed from the saved JSON alone, and agrees with the live values", () => {
    const saved = roundTrip(report);
    for (const [plane, live] of [
      [saved.markerPlane!, report.markerMm],
      [saved.paperPlane!, report.paperMm],
    ] as const) {
      const again = recomputePlane(saved.hand!.landmarksPx, plane);
      expect(again.points).toEqual(plane.landmarksSheetMm);
      expect(again.measurements).toEqual(live);
    }
  });

  it("survives a JSON round trip unchanged", () => {
    expect(roundTrip(report)).toEqual(report);
  });
});

describe("the sheet size is a parameter", () => {
  const letter = {
    ...INDEPENDENT_SCENE,
    paperWidthMm: 215.9,
    paperHeightMm: 279.4,
  };
  const letterShot = independentShot(letter, "letter");

  it("a Letter sheet analysed as Letter measures the hand correctly", () => {
    expect(letterShot.quad.corners).not.toBeNull();
    const report = assembleLearningReport(
      findings({
        paperSize: "letter",
        paper: paperFindings(letterShot.quad, "letter"),
        hand: { ...HAND, landmarksPx: letterShot.landmarksPx },
        exifFocalPx: letterShot.exifFocalPx,
        reference: null,
      }),
    );
    expect(report.paperSize).toBe("letter");
    expect(
      Math.abs(report.paperMm!.handLengthMm - TRUE_HAND_LENGTH_MM),
    ).toBeLessThan(0.5);
  });

  it("the same quad told it is A4 gives a different plane, so the size is not hard-coded", () => {
    const asLetter = paperFindings(letterShot.quad, "letter")!;
    const asA4 = paperFindings(letterShot.quad, "a4")!;
    expect(asA4.homography).not.toEqual(asLetter.homography);
    const report = assembleLearningReport(
      findings({
        paper: asA4,
        hand: { ...HAND, landmarksPx: letterShot.landmarksPx },
        exifFocalPx: letterShot.exifFocalPx,
        reference: null,
      }),
    );
    expect(
      Math.abs(report.paperMm!.handLengthMm - TRUE_HAND_LENGTH_MM),
    ).toBeGreaterThan(2);
  });
});

describe("EXIF in a report", () => {
  const bytes = buildExifJpeg(phoneSpec());

  it("keeps the white-listed values", () => {
    const report = assembleLearningReport(findings());
    expect(report.exif).toEqual({
      focalLengthMm: 6.765,
      focalLengthIn35mmFilm: 24,
      pixelXDimension: 4032,
      pixelYDimension: 3024,
    });
  });

  it("never carries GPS, time, serial number or device, however the EXIF arrives", () => {
    const wide = {
      ...readExifWhitelist(bytes),
      make: PRIVATE.make,
      model: PRIVATE.model,
      bodySerialNumber: PRIVATE.serial,
      dateTimeOriginal: PRIVATE.dateTime,
      gpsLatitude: PRIVATE.latitudeSeconds,
      gpsAltitude: PRIVATE.altitude,
      lensModel: PRIVATE.lens,
    };
    for (const exif of [wide, readExifWhitelist(bytes)]) {
      const text = JSON.stringify(assembleLearningReport(findings({ exif })));
      for (const secret of [
        PRIVATE.make,
        PRIVATE.model,
        PRIVATE.serial,
        PRIVATE.dateTime,
        PRIVATE.lens,
        PRIVATE.uniqueId,
        PRIVATE.software,
        String(PRIVATE.latitudeSeconds),
        String(PRIVATE.longitudeSeconds),
        String(PRIVATE.altitude),
      ]) {
        expect(text).not.toContain(secret);
      }
    }
  });

  it("has exactly the four white-listed keys in every report, with nulls where the photo had none", () => {
    const empty = assembleLearningReport(findings({ exif: {} }));
    expect(Object.keys(empty.exif).sort()).toEqual([
      "focalLengthIn35mmFilm",
      "focalLengthMm",
      "pixelXDimension",
      "pixelYDimension",
    ]);
    expect(Object.values(empty.exif).every((v) => v === null)).toBe(true);
    expect(
      Object.keys(assembleFailedReport("x.jpg", "a4", "bad").exif).sort(),
    ).toEqual(Object.keys(empty.exif).sort());
  });
});

describe("the detected hand is compared with the page's hand", () => {
  const withHand = (handedness: "left" | "right" | null) =>
    assembleLearningReport(findings({ hand: { ...HAND, handedness } }));

  it("warns when they differ, and still calls the photo ready", () => {
    const report = withHand("left");
    const check = report.checks.find((c) => c.id === "handedness");
    expect(check?.tone).toBe("warn");
    expect(check?.message).toMatch(/left hand on a right-hand page/);
    expect(report.verdict).toBe("ready");
  });

  it("says nothing when they match, or when no label was given", () => {
    for (const h of ["right", null] as const) {
      expect(withHand(h).checks.map((c) => c.id)).not.toContain("handedness");
    }
  });

  it("files a differing photo but flags it, and files a matching one plainly (learn:sort and the checker page)", () => {
    const mismatched = withHand("left");
    const matched = withHand("right");
    const named = (r: LearningPhotoReport, file: string) => ({ ...r, file });
    const sort = sortReports([
      named(assembleLearningReport(findings({ code: SLATE })), "IMG_0001.jpg"),
      named(matched, "IMG_0002.jpg"),
      named(mismatched, "IMG_0003.jpg"),
    ]);
    expect(sort.photos.map((p) => [p.file, p.status, p.destination])).toEqual([
      ["IMG_0001.jpg", "slate", "P007/slate.jpg"],
      ["IMG_0002.jpg", "ok", "P007/G01R/1.jpg"],
      ["IMG_0003.jpg", "hand-mismatch", "P007/G01R/2.jpg"],
    ]);
  });

  it("does not file a photo that has to be retaken, even if it read the QR code", () => {
    const blurry = assembleLearningReport(findings({ laplacianVariance: 1 }));
    expect(blurry.verdict).toBe("retake");
    const sort = sortReports([
      assembleLearningReport(findings({ code: SLATE, file: "IMG_0001.jpg" })),
      { ...blurry, file: "IMG_0002.jpg" },
    ]);
    expect(sort.photos[1]!.status).toBe("no-code");
  });
});

describe("other kinds of photo", () => {
  it("a participant card carries no hand, planes or measurements, even if a hand is passed in", () => {
    const report = assembleLearningReport(
      findings({
        code: SLATE,
        qrText: "https://open-mouse.vercel.app/l/v1/P007",
      }),
    );
    expect(report.verdict).toBe("slate");
    expect(report.hand).toBeNull();
    expect(report.markerPlane).toBeNull();
    expect(report.paperPlane).toBeNull();
    expect(report.markerMm).toBeNull();
    expect(report.paperMm).toBeNull();
    expect(report.paperCorners).toBeNull();
    expect(report.paperCornersSeen).toBe(0);
    expect(report.reprojectionErrorMm).toBeNull();
    expect(report.kitVersion).toBe(LEARNING_KIT_VERSION);
  });

  it("a side page records the strip plane and the flat projection, with no paper plane and no measurements", () => {
    const report = assembleLearningReport(
      findings({
        code: { kind: "gesture", version: 1, gesture: "G06", hand: "right" },
        markers: stripMarkers,
        reference: stripReference(stripMarkers),
        paper: null,
      }),
    );
    expect(report.markerPlane!.method).toBe("strip-markers");
    expect(report.markerPlane!.parallax).toBeNull();
    expect(report.markerPlane!.landmarksSheetMm).toHaveLength(21);
    expect(report.paperPlane).toBeNull();
    expect(report.markerMm).toBeNull();
    expect(report.paperMm).toBeNull();
    expect(report.reprojectionErrorMm).toBeNull();
  });

  it("a photo with no hand still records where the planes are", () => {
    const report = assembleLearningReport(findings({ hand: null }));
    expect(report.verdict).toBe("retake");
    expect(report.markerPlane!.homography).toHaveLength(3);
    expect(report.paperPlane!.homography).toHaveLength(3);
    expect(report.markerPlane!.landmarksSheetMm).toBeNull();
    expect(report.markerMm).toBeNull();
  });

  it("a photo whose paper was not found has no paper plane but keeps the marker plane", () => {
    const report = assembleLearningReport(
      findings({
        paper: {
          corners: null,
          cornersSeen: 2,
          homography: null,
          edgeFitResidualMm: null,
        },
      }),
    );
    expect(report.paperPlane).toBeNull();
    expect(report.paperMm).toBeNull();
    expect(report.markerMm).not.toBeNull();
    expect(report.paperCornersSeen).toBe(2);
    expect(report.checks.find((c) => c.id === "paper")?.tone).toBe("warn");
  });

  it("a photo that cannot be decoded says so and has no planes", () => {
    const report = assembleFailedReport("IMG_9.jpg", "letter", "Not an image.");
    expect(report).toMatchObject({
      kitVersion: LEARNING_KIT_VERSION,
      file: "IMG_9.jpg",
      paperSize: "letter",
      verdict: "unidentified",
      error: "Not an image.",
      markerPlane: null,
      paperPlane: null,
    });
  });
});

describe("stampProvenance", () => {
  it("adds the commit without touching anything else", () => {
    const report = assembleLearningReport(findings());
    const sha = "a".repeat(40);
    const stamped = stampProvenance(report, { gitSha: sha, gitDirty: true });
    expect(stamped).toEqual({ ...report, gitSha: sha, gitDirty: true });
    expect(report.gitSha).toBeNull();
  });
});
