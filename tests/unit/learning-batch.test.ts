import { describe, expect, it, vi } from "vitest";
import {
  ANALYSIS_FAILED_MESSAGE,
  analyseBatch,
  analyseSafely,
  failureKind,
} from "../../src/lib/learning/batch";
import {
  assembleFailedReport,
  assembleLearningReport,
  type LearningPhotoReport,
  type ReportFindings,
} from "../../src/lib/learning/report";
import { sortReports } from "../../src/lib/learning/runlog";

function okReport(file: string): LearningPhotoReport {
  const findings: ReportFindings = {
    file,
    width: 100,
    height: 100,
    paperSize: "a4",
    exif: null,
    exifFocalPx: null,
    qrText: "https://open-mouse.vercel.app/l/v1/P007",
    code: { kind: "participant", version: 1, participant: "P007" },
    markers: [],
    laplacianVariance: 300,
    reference: null,
    paper: null,
    hand: null,
  };
  return assembleLearningReport(findings);
}

// What a detector error can carry: a path with an account name, and pixels.
const LEAKY =
  "Cannot read C:\\Users\\kirby\\Pictures\\Session 1\\IMG_0002.jpg: pixel (12,40)=rgb(201,143,120) at offset 4096";

class DetectorCrash extends Error {}

describe("failureKind", () => {
  it("is the class of the error and nothing it says", () => {
    expect(failureKind(new TypeError(LEAKY))).toBe("TypeError");
    expect(failureKind(new RangeError("x"))).toBe("RangeError");
    expect(failureKind(new Error(LEAKY))).toBe("Error");
    expect(failureKind(new DetectorCrash(LEAKY))).toBe("DetectorCrash");
    const named = new Error(LEAKY);
    named.name = "EncodingError";
    expect(failureKind(named)).toBe("EncodingError");
  });

  it("does not trust a name that could carry text, and copes with things that are not errors", () => {
    const odd = new Error("x");
    odd.name = "C:\\Users\\kirby\\IMG_0002.jpg failed";
    expect(failureKind(odd)).toBe("Error");
    expect(failureKind("C:\\Users\\kirby\\IMG_0002.jpg")).toBe("NonError");
    expect(failureKind(null)).toBe("NonError");
    expect(failureKind({ message: LEAKY })).toBe("NonError");
  });
});

describe("analyseSafely", () => {
  it("passes a good report through untouched", async () => {
    const good = okReport("IMG_0001.jpg");
    expect(await analyseSafely("IMG_0001.jpg", "a4", async () => good)).toBe(
      good,
    );
  });

  it("turns a throw into that photo's failed report: fixed text, the error's type, no message, no path", async () => {
    const report = await analyseSafely("IMG_0002.jpg", "letter", async () => {
      throw new TypeError(LEAKY);
    });
    expect(report).toMatchObject({
      file: "IMG_0002.jpg",
      paperSize: "letter",
      verdict: "unidentified",
      error: ANALYSIS_FAILED_MESSAGE,
      errorKind: "TypeError",
      hand: null,
      markerPlane: null,
      paperPlane: null,
      markerMm: null,
      paperMm: null,
    });
    const text = JSON.stringify(report);
    for (const secret of ["kirby", "Session 1", "C:", "rgb(", "offset"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("also catches a rejection that is not an Error", async () => {
    const report = await analyseSafely("IMG_0003.jpg", "a4", () =>
      Promise.reject("C:\\Users\\kirby\\IMG_0003.jpg"),
    );
    expect(report.errorKind).toBe("NonError");
    expect(JSON.stringify(report)).not.toContain("kirby");
  });

  it("a failed report from the assembler carries the kind only when given one", () => {
    expect(assembleFailedReport("a.jpg", "a4", "msg")).not.toHaveProperty(
      "errorKind",
    );
    expect(assembleFailedReport("a.jpg", "a4", "msg", "X").errorKind).toBe("X");
  });
});

describe("analyseBatch", () => {
  const files = ["IMG_0001.jpg", "IMG_0002.jpg", "IMG_0003.jpg"].map(
    (name) => ({ name }),
  );

  it("finishes the batch when the detector throws on one photo; only that photo is a failure", async () => {
    const seen: string[] = [];
    const reports = await analyseBatch(
      files,
      async (file) => {
        seen.push(file.name);
        if (file.name === "IMG_0002.jpg") throw new DetectorCrash(LEAKY);
        return okReport(file.name);
      },
      { paperSize: "a4" },
    );
    // Every photo was tried, in order, including the one after the failure.
    expect(seen).toEqual(files.map((f) => f.name));
    expect(reports.map((r) => [r.file, r.verdict])).toEqual([
      ["IMG_0001.jpg", "slate"],
      ["IMG_0002.jpg", "unidentified"],
      ["IMG_0003.jpg", "slate"],
    ]);
    expect(reports[1]).toMatchObject({
      error: ANALYSIS_FAILED_MESSAGE,
      errorKind: "DetectorCrash",
    });
    expect(JSON.stringify(reports)).not.toMatch(/kirby|Session 1|rgb\(/);
  });

  it("the failed photo does not disturb sorting of the others (it is not filed)", async () => {
    const reports = await analyseBatch(
      files,
      async (file) => {
        if (file.name === "IMG_0002.jpg") throw new Error(LEAKY);
        return okReport(file.name);
      },
      { paperSize: "a4" },
    );
    const sort = sortReports(reports);
    expect(sort.photos.map((p) => [p.file, p.status])).toEqual([
      ["IMG_0001.jpg", "slate"],
      ["IMG_0002.jpg", "no-code"],
      ["IMG_0003.jpg", "slate"],
    ]);
  });

  it("reports progress after every photo, the failed one included", async () => {
    const onProgress = vi.fn();
    await analyseBatch(
      files,
      async (file) => {
        if (file.name === "IMG_0001.jpg") throw new Error("boom");
        return okReport(file.name);
      },
      { paperSize: "a4", onProgress },
    );
    expect(onProgress.mock.calls.map(([done]) => done.length)).toEqual([
      1, 2, 3,
    ]);
  });

  it("an empty batch is an empty result", async () => {
    expect(
      await analyseBatch([], async () => okReport("x"), { paperSize: "a4" }),
    ).toEqual([]);
  });
});
