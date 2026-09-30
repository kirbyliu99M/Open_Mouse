import { describe, expect, it } from "vitest";
import {
  RAW_CALIBRATION,
  evaluate,
  evaluateJson,
  type EvaluateOptions,
  type EvaluationReport,
} from "../../src/lib/m2/evaluate";
import { EvaluationInputError } from "../../src/lib/m2/inputs";
import { renderMarkdown } from "../../src/lib/m2/markdown";
import {
  PALM_RATIO,
  runLogOf,
  truthOf,
  type SyntheticPhoto,
} from "./helpers/m2-synth";

// Every expected number is worked out by hand from the lengths below. The
// synthetic planes map pixels to millimetres 1:1, so a photo made with
// `paperMm: 188` measures a hand length of exactly 188 mm.

const LENGTHS = [188, 190, 191, 187, 189]; // errors against 190: -2 0 1 -3 -1

const right = (
  paperMm: number,
  extra: Partial<SyntheticPhoto> = {},
): SyntheticPhoto => ({
  participant: "P001",
  hand: "right",
  paperMm,
  ...extra,
});
const left = (
  paperMm: number,
  extra: Partial<SyntheticPhoto> = {},
): SyntheticPhoto => ({
  participant: "P001",
  hand: "left",
  paperMm,
  ...extra,
});

const TRUTH_P001 = truthOf(
  "P001",
  { handLengthMm: 190, palmWidthMm: 80 },
  { handLengthMm: 170, palmWidthMm: 72 },
);

function run(
  photos: readonly SyntheticPhoto[],
  options: EvaluateOptions = {},
  truths = [TRUTH_P001],
): EvaluationReport {
  return evaluate({ logs: [runLogOf(photos)], truths }, options);
}

const field = (
  r: EvaluationReport,
  group: "accepted" | "all",
  path: "markers" | "paper-edge",
  name = "handLengthMm",
) => r.groups[group][path]!.fields[name]!;

describe("accuracy against the ruler, worked out by hand", () => {
  const report = run(LENGTHS.map((mm) => right(mm, { markersMm: mm + 1 })));

  it("paper-edge path: bias -1, MAE 1.4, worst 3, SD 1.5811, limits [-4.099, 2.099], n 5", () => {
    const s = field(report, "all", "paper-edge").accuracy.stats!;
    expect(s.n).toBe(5);
    expect(s.bias).toBeCloseTo(-1, 8);
    expect(s.mae).toBeCloseTo(1.4, 8);
    expect(s.maxAbsError).toBeCloseTo(3, 8);
    expect(s.sd).toBeCloseTo(1.5811388, 6);
    expect(s.loa!.lower).toBeCloseTo(-4.099, 3);
    expect(s.loa!.upper).toBeCloseTo(2.099, 3);
  });

  it("marker path reads its own plane (each length 1 mm longer): bias 0, MAE 1.2, worst 2, same SD", () => {
    const s = field(report, "all", "markers").accuracy.stats!;
    expect(s.n).toBe(5);
    expect(s.bias).toBeCloseTo(0, 8);
    expect(s.mae).toBeCloseTo(1.2, 8);
    expect(s.maxAbsError).toBeCloseTo(2, 8);
    expect(s.sd).toBeCloseTo(1.5811388, 6);
    expect(s.loa!.upper).toBeCloseTo(3.099, 3);
  });

  it("palm width is judged the same way, against its own ruler value", () => {
    const errors = LENGTHS.map((mm) => mm * PALM_RATIO - 80);
    const expectedBias = errors.reduce((a, b) => a + b, 0) / errors.length;
    const s = field(report, "all", "paper-edge", "palmWidthMm").accuracy.stats!;
    expect(s.n).toBe(5);
    expect(s.bias).toBeCloseTo(expectedBias, 8);
    expect(s.maxAbsError).toBeCloseTo(Math.max(...errors.map(Math.abs)), 8);
  });

  it("repeatability of the five: range 4, SD 1.5811, largest deviation 2", () => {
    const rows = field(report, "all", "paper-edge").repeatability.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      participant: "P001",
      hand: "right",
      gesture: "G01",
      n: 5,
      min: 187,
      max: 191,
    });
    expect(rows[0]!.range).toBeCloseTo(4, 8);
    expect(rows[0]!.sd).toBeCloseTo(1.5811388, 6);
    expect(rows[0]!.maxDeviationFromMean).toBeCloseTo(2, 8);
    const summary = field(report, "all", "paper-edge").repeatability.summary!;
    expect(summary).toMatchObject({ groups: 1 });
    expect(summary.maxRange).toBeCloseTo(4, 8);
  });

  it("the three accuracy readings and the three repeatability readings are all reported, none chosen", () => {
    const f = field(report, "all", "paper-edge");
    expect(f.accuracy.readings.map((r) => r.withinLimit)).toEqual([
      true, // MAE 1.4 <= 2
      false, // worst 3 > 2
      false, // LoA 4.099 > 2
    ]);
    expect(f.repeatability.readings.map((r) => r.withinLimit)).toEqual([
      false, // range 4 > 1.5
      false, // half-range 2 > 1.5
      false, // deviation 2 > 1.5
    ]);
    // Palm width has no limit in the candidate set, so no readings.
    expect(
      field(report, "all", "paper-edge", "palmWidthMm").accuracy.readings,
    ).toEqual([]);
    expect(report.thresholds.status).toMatch(/未拍板/);
  });
});

describe("the product's gates split accepted from all", () => {
  const photos = [
    right(188),
    right(190),
    right(191, { refusedBy: { paper: ["PAPER_CORNER_HIDDEN"] } }),
    right(187, { refusedBy: { hand: ["HANDEDNESS_MISMATCH"] } }),
    right(189),
  ];
  const report = run(photos);

  it("a refused photo leaves the accepted group but stays in all", () => {
    const accepted = field(report, "accepted", "paper-edge");
    const everything = field(report, "all", "paper-edge");
    expect(report.groups.accepted["paper-edge"]!.photos).toBe(3);
    expect(report.groups.all["paper-edge"]!.photos).toBe(5);
    expect(accepted.accuracy.stats!.n).toBe(3);
    expect(everything.accuracy.stats!.n).toBe(5);
    // Accepted: 188 190 189 -> errors -2 0 -1 -> bias -1, MAE 1, worst 2.
    expect(accepted.accuracy.stats!.bias).toBeCloseTo(-1, 8);
    expect(accepted.accuracy.stats!.mae).toBeCloseTo(1, 8);
    expect(accepted.accuracy.stats!.maxAbsError).toBeCloseTo(2, 8);
    // Repeatability uses the same split: 188 190 189 -> range 2.
    expect(accepted.repeatability.rows[0]!.n).toBe(3);
    expect(accepted.repeatability.rows[0]!.range).toBeCloseTo(2, 8);
    expect(everything.repeatability.rows[0]!.range).toBeCloseTo(4, 8);
  });

  it("each refused photo is listed with the product's own reason codes", () => {
    const product = report.excluded.filter((e) => e.stage === "product");
    expect(product).toEqual([
      expect.objectContaining({
        id: "P001/G01R/3",
        reasons: ["paper:PAPER_CORNER_HIDDEN", "hand:NOT_REACHED"],
      }),
      expect.objectContaining({
        id: "P001/G01R/4",
        reasons: ["hand:HANDEDNESS_MISMATCH"],
      }),
    ]);
  });

  it("a photo with no recorded gate verdict is not counted as accepted", () => {
    const log = runLogOf([right(190), right(188)]);
    const stripped = {
      ...log,
      reports: log.reports.map((r) => ({ ...r, productGates: null })),
    };
    const r = evaluate({ logs: [stripped], truths: [TRUTH_P001] });
    expect(r.groups.accepted["paper-edge"]!.photos).toBe(0);
    expect(r.groups.all["paper-edge"]!.photos).toBe(2);
    expect(r.excluded.filter((e) => e.stage === "product")[0]!.reasons).toEqual(
      ["NO_PRODUCT_GATES"],
    );
  });
});

describe("left and right hands are paired with their own ruler values", () => {
  // Right hand: ruler 190, photos 189 191. Left hand: ruler 170, photos 169 171.
  const report = run([right(189), right(191), left(169), left(171)]);

  it("errors are measured against the same hand's truth, not the other one's", () => {
    const s = field(report, "all", "paper-edge").accuracy.stats!;
    expect(s.n).toBe(4);
    expect(s.bias).toBeCloseTo(0, 8);
    expect(s.maxAbsError).toBeCloseTo(1, 8);
    expect(s.mae).toBeCloseTo(1, 8);
  });

  it("repeatability keeps the two hands apart: one row each", () => {
    const rows = field(report, "all", "paper-edge").repeatability.rows;
    expect(rows.map((r) => [r.hand, r.n, r.range])).toEqual([
      ["left", 2, 2],
      ["right", 2, 2],
    ]);
  });

  it("uses the page's hand, so a left-hand photo is not compared with the right-hand truth even when the detector disagreed", () => {
    const r = run([
      left(170, { refusedBy: { hand: ["HANDEDNESS_MISMATCH"] } }),
    ]);
    const s = field(r, "all", "paper-edge").accuracy.stats!;
    // 170 against the LEFT ruler value 170 -> error 0 (against 190 it would be -20).
    expect(s.bias).toBeCloseTo(0, 8);
  });
});

describe("missing things are reasons, never zeros", () => {
  it("a ruler value that was not measured skips that photo's comparison and says so", () => {
    const truth = truthOf(
      "P001",
      { handLengthMm: null, palmWidthMm: 80 },
      { handLengthMm: 170, palmWidthMm: 72 },
    );
    const r = run([right(190), right(191), left(170)], {}, [truth]);
    const s = field(r, "all", "paper-edge").accuracy.stats!;
    expect(s.n).toBe(1); // only the left-hand photo has a hand-length ruler value
    expect(s.bias).toBeCloseTo(0, 8);
    expect(
      r.excluded.filter(
        (e) => e.stage === "truth" && e.field === "handLengthMm",
      ),
    ).toEqual([
      expect.objectContaining({
        id: "P001/G01R/1",
        reasons: ["NO_TRUTH_VALUE:right"],
      }),
      expect.objectContaining({
        id: "P001/G01R/2",
        reasons: ["NO_TRUTH_VALUE:right"],
      }),
    ]);
    // Palm width was measured for that hand, so it is compared as usual.
    expect(field(r, "all", "paper-edge", "palmWidthMm").accuracy.stats!.n).toBe(
      3,
    );
  });

  it("no truth file for a participant: no accuracy for them, but their repeats still count", () => {
    const r = run([right(188), right(190)], {}, []);
    expect(field(r, "all", "paper-edge").accuracy.stats).toBeNull();
    expect(field(r, "all", "paper-edge").accuracy.readings).toEqual([]);
    expect(field(r, "all", "paper-edge").repeatability.rows[0]).toMatchObject({
      n: 2,
      range: 2,
    });
    expect(
      r.excluded.filter((e) => e.reasons[0] === "NO_TRUTH_FILE"),
    ).toHaveLength(2);
  });

  it("a path with no plane is skipped for that path only (NO_PLANE)", () => {
    const r = run([
      right(190, { markersMm: null }),
      right(188, { markersMm: null }),
    ]);
    expect(r.groups.all.markers!.photos).toBe(0);
    expect(field(r, "all", "markers").accuracy.stats).toBeNull();
    expect(r.groups.all["paper-edge"]!.photos).toBe(2);
    expect(
      r.excluded.filter((e) => e.path === "markers").map((e) => e.reasons),
    ).toEqual([["NO_PLANE"], ["NO_PLANE"]]);
  });

  it("a photo with no hand is not measured on either path (NO_HAND)", () => {
    const r = run([right(190), right(190, { noHand: true })]);
    expect(r.counts.measured).toBe(1);
    expect(r.counts.notMeasured).toBe(1);
    expect(r.excluded.find((e) => e.stage === "measurement")!.reasons).toEqual([
      "NO_HAND",
    ]);
  });

  it("a plane that cannot be recomputed says so (RECOMPUTE_FAILED), and does not stop the others", () => {
    const log = runLogOf([right(190), right(189)]);
    const broken = {
      ...log,
      reports: log.reports.map((r, i) =>
        i === 1 && r.paperPlane
          ? {
              ...r,
              paperPlane: {
                ...r.paperPlane,
                // corrected, but with no focal length to correct with
                parallax: {
                  ...r.paperPlane.parallax!,
                  corrected: true,
                  focalPx: null,
                },
              },
            }
          : r,
      ),
    };
    const r = evaluate({ logs: [broken], truths: [TRUTH_P001] });
    expect(r.groups.all["paper-edge"]!.photos).toBe(1);
    expect(r.groups.all.markers!.photos).toBe(2);
    expect(r.excluded.find((e) => e.path === "paper-edge")!.reasons).toEqual([
      "RECOMPUTE_FAILED",
    ]);
  });

  it("a plane of the wrong kind for the path is not used (a strip plane is not the marker plane)", () => {
    const log = runLogOf([right(190), right(189)]);
    const swapped = {
      ...log,
      reports: log.reports.map((r) =>
        r.markerPlane
          ? {
              ...r,
              markerPlane: {
                ...r.markerPlane,
                method: "strip-markers" as const,
              },
            }
          : r,
      ),
    };
    const r = evaluate({ logs: [swapped], truths: [TRUTH_P001] });
    expect(r.groups.all.markers!.photos).toBe(0);
    expect(r.groups.all["paper-edge"]!.photos).toBe(2);
    expect(
      r.excluded.filter((e) => e.path === "markers").map((e) => e.reasons),
    ).toEqual([["NO_PLANE"], ["NO_PLANE"]]);
  });

  it("a pose outside the measurement ranges gives NO_MEASUREMENT, not a number", () => {
    // 60 mm is shorter than any hand the contract accepts (100 to 280).
    const r = run([right(60), right(190)]);
    expect(field(r, "all", "paper-edge").accuracy.stats!.n).toBe(1);
    expect(r.excluded.find((e) => e.path === "paper-edge")!.reasons).toEqual([
      "NO_MEASUREMENT",
    ]);
  });

  it("a photo that was never filed (retake) is listed as such", () => {
    const r = run([right(190), right(190, { retake: true })]);
    expect(r.counts.measured).toBe(1);
    const row = r.excluded.find((e) => e.reasons[0]!.startsWith("NOT_FILED"))!;
    expect(row.reasons).toEqual(["NOT_FILED:no-code"]);
    expect(row.id).toMatch(/^run1#\d+$/);
  });

  it("nothing at all to measure gives an empty report, not a crash", () => {
    const r = run([right(190, { noHand: true })]);
    expect(r.counts.measured).toBe(0);
    expect(field(r, "all", "paper-edge").accuracy.stats).toBeNull();
    expect(field(r, "all", "paper-edge").repeatability.summary).toBeNull();
  });
});

describe("the mm values are recomputed from the planes, not read from the record", () => {
  it("ignores the recorded markerMm and paperMm (set to 999 here)", () => {
    const r = run(LENGTHS.map((mm) => right(mm)));
    expect(field(r, "all", "paper-edge").accuracy.stats!.bias).toBeCloseTo(
      -1,
      8,
    );
  });
});

describe("what is in scope", () => {
  const photos = [
    right(188),
    right(190),
    right(189, { gesture: "G02" }),
    { participant: "P002", hand: "right" as const, paperMm: 200 },
  ];
  const truths = [
    TRUTH_P001,
    truthOf("P002", { handLengthMm: 200, palmWidthMm: 84 }),
  ];

  it("evaluates G01 only by default, the pose the M2 gate is defined on", () => {
    const r = run(photos, {}, truths);
    expect(r.counts.measured).toBe(3); // 2 of P001 and 1 of P002
    expect(r.counts.outOfScope).toBe(1); // the G02 photo
    expect(r.options.gestures).toEqual(["G01"]);
  });

  it("other poses can be asked for", () => {
    const r = run(photos, { gestures: ["G01", "G02"] }, truths);
    expect(r.counts.measured).toBe(4);
    expect(r.counts.outOfScope).toBe(0);
  });

  it("a subset of participants (a fold, or the held-out set) leaves the others out entirely", () => {
    const r = run(photos, { participants: ["P002"] }, truths);
    expect(r.counts.measured).toBe(1);
    expect(r.inputs.participants).toEqual(["P002"]);
    expect(field(r, "all", "paper-edge").accuracy.stats!.n).toBe(1);
    expect(r.options.participants).toEqual(["P002"]);
    // The other participant's truth being present does not matter.
    const only = run(photos, { participants: ["P001"] }, truths);
    expect(only.inputs.participants).toEqual(["P001"]);
    expect(field(only, "all", "paper-edge").accuracy.stats!.n).toBe(2);
  });

  it("a single path can be chosen", () => {
    const r = run(photos, { paths: ["markers"] }, truths);
    expect(Object.keys(r.groups.all)).toEqual(["markers"]);
    expect(r.options.paths).toEqual(["markers"]);
  });
});

describe("several logs", () => {
  it("combine, and the same filed copy in two logs is counted once (learn:sort never overwrites)", () => {
    const one = runLogOf([right(188), right(190)]);
    const two = runLogOf([right(191), right(187)]); // same destinations P001/G01R/1 and /2
    const three = runLogOf([
      { participant: "P002", hand: "right", paperMm: 200 },
    ]);
    const r = evaluate(
      {
        logs: [one, two, three],
        truths: [
          TRUTH_P001,
          truthOf("P002", { handLengthMm: 200, palmWidthMm: 84 }),
        ],
      },
      {},
    );
    expect(r.counts.measured).toBe(3); // two from the first log, one from the third
    expect(
      r.excluded.filter((e) => e.reasons[0] === "DUPLICATE_DESTINATION"),
    ).toHaveLength(2);
    expect(r.inputs.runLogs).toHaveLength(3);
    expect(r.inputs.participants).toEqual(["P001", "P002"]);
    // Each log has a participant card per participant; cards are neither measured nor excluded.
    expect(r.counts.cards).toBe(3);
    expect(r.counts.reports).toBe(3 + 3 + 2); // card + 2 photos, card + 2 photos, card + 1 photo
    expect(
      r.excluded.some((e) => e.reasons.some((x) => x.includes("slate"))),
    ).toBe(false);
    // P001's two filed photos are one repeat group; P002's single photo is none, and the two participants never merge.
    expect(
      field(r, "all", "paper-edge").repeatability.rows.map((row) => [
        row.participant,
        row.n,
      ]),
    ).toEqual([["P001", 2]]);
  });
});

describe("a correction plugged into the evaluator (the frozen calibrated-v1 will go here)", () => {
  it("the baseline changes nothing and names itself landmark-raw-v1", () => {
    const r = run(LENGTHS.map((mm) => right(mm)));
    expect(r.model).toBe("landmark-raw-v1");
    expect(RAW_CALIBRATION.name).toBe("landmark-raw-v1");
  });

  it("a correction shifts every error, and only the correction", () => {
    const baseline = run(LENGTHS.map((mm) => right(mm)));
    const corrected = run(
      LENGTHS.map((mm) => right(mm)),
      {
        calibration: {
          name: "test-offset",
          apply: (m) => ({ ...m, handLengthMm: m.handLengthMm + 3 }),
        },
      },
    );
    const a = field(baseline, "all", "paper-edge").accuracy.stats!;
    const b = field(corrected, "all", "paper-edge").accuracy.stats!;
    expect(corrected.model).toBe("test-offset");
    expect(b.bias).toBeCloseTo(a.bias + 3, 8);
    expect(b.sd).toBeCloseTo(a.sd!, 8);
    expect(b.mae).toBeCloseTo(2.0, 8); // errors +1 +3 +4 0 +2 -> mean 2
    // Palm width was not corrected.
    expect(
      field(corrected, "all", "paper-edge", "palmWidthMm").accuracy.stats!.bias,
    ).toBeCloseTo(
      field(baseline, "all", "paper-edge", "palmWidthMm").accuracy.stats!.bias,
      8,
    );
  });
});

describe("limits", () => {
  it("come from the configuration and can be replaced", () => {
    const r = run(
      LENGTHS.map((mm) => right(mm)),
      {
        thresholds: {
          status: "test",
          accuracyMm: { handLengthMm: 5 },
          repeatabilityMm: { handLengthMm: 5 },
        },
      },
    );
    const f = field(r, "all", "paper-edge");
    expect(f.accuracy.readings.map((x) => x.withinLimit)).toEqual([
      true,
      true,
      true,
    ]);
    expect(f.repeatability.readings.map((x) => x.withinLimit)).toEqual([
      true,
      true,
      true,
    ]);
    expect(r.thresholds.status).toBe("test");
  });
});

describe("what the report holds", () => {
  const photos = [
    right(188),
    right(190, { refusedBy: { paper: ["PAPER_CURLED"] } }),
  ];
  const report = run(photos);
  const json = JSON.stringify(report);
  const markdown = renderMarkdown(report);

  it("no file name, folder, landmark or account name, in the JSON or the summary", () => {
    for (const text of [json, markdown]) {
      expect(text).not.toMatch(/IMG_/);
      expect(text).not.toMatch(/session-1|Photos\//);
      expect(text).not.toMatch(/landmarks/i);
      expect(text).not.toMatch(/kirby|Users|[A-Z]:\\/i);
      expect(text).not.toMatch(/exif|focal/i);
    }
  });

  it("photos are named by participant code, pose and shot only", () => {
    expect(report.excluded.map((e) => e.id)).toEqual(["P001/G01R/2"]);
    expect(report.inputs.participants).toEqual(["P001"]);
  });

  it("the summary shows the numbers and the candidate label", () => {
    expect(markdown).toMatch(/# M2 evaluation: landmark-raw-v1/);
    expect(markdown).toMatch(/未拍板/);
    expect(markdown).toMatch(/PAPER_CURLED/);
    expect(markdown).toMatch(/P001\/G01R\/2/);
    expect(markdown).toMatch(/95% LoA/);
    expect(markdown).toMatch(/Definitions \(candidate/);
  });
});

describe("evaluateJson: inputs off disk are checked", () => {
  const log = runLogOf([right(190), right(189)]);
  const good = JSON.parse(JSON.stringify(log));

  it("a log that went through JSON evaluates like the object", () => {
    const r = evaluateJson([good], [JSON.parse(JSON.stringify(TRUTH_P001))]);
    expect(r.counts.measured).toBe(2);
  });

  it("wrong format, malformed report, bad truth, two truths for one participant, no logs", () => {
    expect(() => evaluateJson([{ ...good, format: "x/1" }], [])).toThrow(
      /run log 1 is not a format-2 run log/,
    );
    const broken = JSON.parse(JSON.stringify(log));
    broken.reports[1].hand.landmarksPx.pop();
    expect(() => evaluateJson([broken], [])).toThrow(
      /run log 1 does not fit the format: .*landmarksPx/,
    );
    expect(() => evaluateJson([good], [{ participant: "P001" }])).toThrow(
      /truth file 1 is not a valid truth file/,
    );
    expect(() => evaluateJson([good], [TRUTH_P001, TRUTH_P001])).toThrow(
      /Two truth files are for participant P001/,
    );
    expect(() => evaluateJson([], [TRUTH_P001])).toThrow(EvaluationInputError);
    expect(() => evaluate({ logs: [log], truths: [] }, { paths: [] })).toThrow(
      /at least one path/,
    );
  });

  it("errors name the input by position, never by path", () => {
    try {
      evaluateJson([good, "nonsense"], []);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toMatch(/^run log 2 /);
    }
  });
});
