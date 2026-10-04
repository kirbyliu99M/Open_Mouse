import { describe, expect, it } from "vitest";
import {
  RAW_CALIBRATION,
  evaluate,
  evaluateJson,
  type EvaluateOptions,
  type EvaluationReport,
} from "../../src/lib/m2/evaluate";
import { EvaluationInputError } from "../../src/lib/m2/inputs";
import {
  nothingEvaluatedReason,
  readingValue,
  renderMarkdown,
} from "../../src/lib/m2/markdown";
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

  // The detector says RIGHT on a page printed for the LEFT hand. The sorter
  // still files it (the page is the ground truth of what was asked) but flags
  // it `hand-mismatch`, and the evaluator must pair it with the page's hand.
  describe("a photo whose detected hand contradicts its page (hand-mismatch)", () => {
    const photos = [
      left(170, { detectedHand: "right" }),
      left(172),
      right(190),
    ];
    const log = runLogOf(photos);
    const r = evaluate({ logs: [log], truths: [TRUTH_P001] });

    it("is a real hand-mismatch in the sort (the scenario is not a no-op)", () => {
      const mismatched = log.sort.photos.filter(
        (p) => p.status === "hand-mismatch",
      );
      expect(mismatched).toHaveLength(1);
      expect(mismatched[0]).toMatchObject({ hand: "left", shot: 1 });
      // ...and the report of that photo says the detector saw the other hand.
      const report = log.reports.find((x) => x.file === mismatched[0]!.file)!;
      expect(report.hand!.handedness).toBe("right");
      expect(report.code).toMatchObject({ kind: "gesture", hand: "left" });
    });

    it("is still evaluated, in the group of the page's hand", () => {
      expect(r.counts.measured).toBe(3);
      const rows = field(r, "all", "paper-edge").repeatability.rows;
      // Both left-page photos form one repeat group; the lone right photo has no row.
      expect(rows.map((row) => [row.hand, row.n])).toEqual([["left", 2]]);
      expect(r.excluded.filter((e) => e.stage === "measurement")).toEqual([]);
    });

    it("is compared with the truth of the PAGE's hand (left 170), not the detected hand's (right 190)", () => {
      const s = field(r, "all", "paper-edge").accuracy.stats!;
      // Errors: 170-170 = 0, 172-170 = +2 (both left), 190-190 = 0 (right).
      // Against the detected hand's truth the first would be 170-190 = -20.
      expect(s.n).toBe(3);
      expect(s.maxAbsError).toBeCloseTo(2, 8);
      expect(s.bias).toBeCloseTo(2 / 3, 8);
    });

    it("the product's gates decide 'accepted' on their own record, not the sorter's flag", () => {
      // The synthetic gates accept all three; a hand-mismatch is not a gate.
      expect(r.groups.accepted["paper-edge"]!.photos).toBe(3);
    });
  });

  it("a page hand and a product refusal are independent: a refused left photo still uses the left truth", () => {
    const r = run([
      left(170, { refusedBy: { hand: ["HANDEDNESS_MISMATCH"] } }),
    ]);
    const s = field(r, "all", "paper-edge").accuracy.stats!;
    expect(s.bias).toBeCloseTo(0, 8);
    expect(r.groups.accepted["paper-edge"]!.photos).toBe(0);
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

  it("a photo whose QR code was not read is listed as not filed (NOT_FILED:no-code)", () => {
    const log = runLogOf([right(190), right(190)]);
    const lost = log.reports[2]!.file;
    const unread = {
      ...log,
      reports: log.reports.map((r) =>
        r.file === lost ? { ...r, code: null } : r,
      ),
      // What the sort makes of a photo without a readable code.
      sort: {
        ...log.sort,
        photos: log.sort.photos.map((p) =>
          p.file === lost
            ? {
                ...p,
                status: "no-code" as const,
                gesture: null,
                hand: null,
                shot: null,
                destination: null,
              }
            : p,
        ),
      },
    };
    const r = evaluate({ logs: [unread], truths: [TRUTH_P001] });
    expect(r.counts.measured).toBe(1);
    const row = r.excluded.find((e) => e.reasons[0]!.startsWith("NOT_FILED"))!;
    expect(row.reasons).toEqual(["NOT_FILED:no-code"]);
    expect(row.id).toMatch(/^run1#\d+$/);
  });

  describe("a photo the kit's checker said to retake", () => {
    // Not filed by learn:sort (its QR code is dropped), but its record has the
    // page's code and the planes, so it can be measured: it stays in "all" and
    // never enters "accepted", and it says why.
    const r = run([
      right(190),
      right(188, { retake: true, retakeBecause: ["markers", "sharp"] }),
      right(192, { retake: true, retakeBecause: [] }),
    ]);

    it("stays in the 'all' group, measured on its recorded planes", () => {
      expect(r.counts.measured).toBe(3);
      expect(r.counts.notMeasured).toBe(0);
      expect(r.groups.all["paper-edge"]!.photos).toBe(3);
      const s = field(r, "all", "paper-edge").accuracy.stats!;
      expect(s.n).toBe(3);
      // 190, 188, 192 against the ruler 190: errors 0, -2, +2.
      expect(s.maxAbsError).toBeCloseTo(2, 8);
      expect(field(r, "all", "paper-edge").repeatability.rows[0]).toMatchObject(
        { n: 3, min: 188, max: 192 },
      );
    });

    it("is not in the 'accepted' group, even if the product's gates would take it", () => {
      expect(r.groups.accepted["paper-edge"]!.photos).toBe(1);
      expect(field(r, "accepted", "paper-edge").accuracy.stats!.n).toBe(1);
    });

    it("is listed as KIT_RETAKE with the failed checks, not as NOT_FILED", () => {
      const kit = r.excluded.filter((e) => e.stage === "kit");
      expect(kit.map((e) => e.reasons)).toEqual([
        ["KIT_RETAKE:markers", "KIT_RETAKE:sharp"],
        ["KIT_RETAKE:unspecified"],
      ]);
      expect(kit[0]!.id).toMatch(/^P001\/G01R\/retake@run1#\d+$/);
      expect(
        r.excluded.some((e) =>
          e.reasons.some((x) => x.startsWith("NOT_FILED")),
        ),
      ).toBe(false);
    });

    it("keeps the page's hand for the truth (a left-hand retake uses the left ruler value)", () => {
      const l = run([left(170, { retake: true })]);
      const s = field(l, "all", "paper-edge").accuracy.stats!;
      expect(s.bias).toBeCloseTo(0, 8);
    });

    it("respects the scope: another pose or another participant is out of scope, not measured", () => {
      const o = run(
        [
          right(190),
          right(190, { retake: true, gesture: "G02" }),
          { participant: "P002", hand: "right", paperMm: 190, retake: true },
        ],
        { participants: ["P001"] },
        [TRUTH_P001],
      );
      expect(o.counts.measured).toBe(1);
      expect(o.counts.outOfScope).toBe(2);
    });

    it("cannot be placed without a readable code of this kit version: that stays NOT_FILED", () => {
      const log = runLogOf([right(190), right(190, { retake: true })]);
      const noCode = {
        ...log,
        reports: log.reports.map((x) =>
          x.verdict === "retake" ? { ...x, code: null } : x,
        ),
      };
      const n = evaluate({ logs: [noCode], truths: [TRUTH_P001] });
      expect(n.counts.measured).toBe(1);
      expect(
        n.excluded.find((e) => e.reasons[0]!.startsWith("NOT_FILED"))!.reasons,
      ).toEqual(["NOT_FILED:no-code"]);
      const otherVersion = {
        ...log,
        reports: log.reports.map((x) =>
          x.verdict === "retake" && x.code?.kind === "gesture"
            ? { ...x, code: { ...x.code, version: 2 } }
            : x,
        ),
      };
      const v = evaluate({ logs: [otherVersion], truths: [TRUTH_P001] });
      expect(v.counts.measured).toBe(1);
    });

    it("a retake photo without a plane says NO_PLANE like any other", () => {
      const p = run([
        right(190),
        right(190, { retake: true, markersMm: null }),
      ]);
      expect(p.groups.all.markers!.photos).toBe(1);
      expect(p.groups.all["paper-edge"]!.photos).toBe(2);
    });
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
  it("the baseline changes nothing and names itself after the current model", () => {
    const r = run(LENGTHS.map((mm) => right(mm)));
    // landmark-raw-v2 since 2026-10-04 (landmark heights as a ratio of hand
    // length). The heights a replay uses still come from each run log.
    expect(r.model).toBe("landmark-raw-v2");
    expect(RAW_CALIBRATION.name).toBe("landmark-raw-v2");
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

  it("every kind of exclusion row is named without a file name too (duplicate destination, retake, not in sort, ambiguous name, invalid correction)", () => {
    const one = runLogOf([
      right(188),
      right(190),
      right(189, { retake: true }),
    ]);
    const two = runLogOf([right(191), right(187)]); // same destinations as `one`
    const lost = one.reports[1]!.file;
    const gapped = {
      ...one,
      sort: {
        ...one.sort,
        photos: one.sort.photos.filter((p) => p.file !== lost),
      },
    };
    const twin = {
      ...two,
      reports: two.reports.map((x, i) =>
        i === 2 ? { ...x, file: two.reports[1]!.file } : x,
      ),
    };
    const r = evaluate(
      { logs: [gapped, two, twin], truths: [TRUTH_P001] },
      {
        calibration: {
          name: "odd",
          apply: (m) =>
            m.handLengthMm > 189.5 ? ({ handLengthMm: 1 } as never) : m,
        },
      },
    );
    const reasons = new Set(r.excluded.flatMap((e) => e.reasons));
    for (const wanted of [
      "DUPLICATE_DESTINATION",
      "NOT_IN_SORT",
      "AMBIGUOUS_FILE_NAME",
      "CALIBRATION_INVALID",
      "KIT_RETAKE:markers",
    ]) {
      expect(reasons).toContain(wanted);
    }
    const everything = [JSON.stringify(r), renderMarkdown(r)];
    const names = [...one.reports, ...two.reports].map((x) => x.file);
    for (const text of everything) {
      expect(text).not.toMatch(/IMG_|[.]jpg/i);
      for (const name of names) expect(text).not.toContain(name);
      expect(text).not.toMatch(/session-1|Photos\//);
    }
    // Every id is a participant code, a pose and a shot (or a run position), nothing else.
    for (const row of r.excluded) {
      expect(row.id).toMatch(
        /^(P[0-9]{3}\/G[0-9]{2}[LR]\/([0-9]+|retake@run[0-9]+#[0-9]+)(@run[0-9]+)?|run[0-9]+#[0-9]+)$/,
      );
    }
  });

  it("photos are named by participant code, pose and shot only", () => {
    expect(report.excluded.map((e) => e.id)).toEqual(["P001/G01R/2"]);
    expect(report.inputs.participants).toEqual(["P001"]);
  });

  it("the summary shows the numbers and the candidate label", () => {
    expect(markdown).toMatch(/# M2 evaluation: landmark-raw-v2/);
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

describe("a correction that returns something unusable (CALIBRATION_INVALID)", () => {
  const withApply = (apply: (m: never) => unknown) =>
    run([right(190), right(188), right(192)], {
      calibration: {
        name: "broken",
        apply: apply as never,
      },
    });

  it.each([
    [
      "a non-finite hand length",
      () => ({ handLengthMm: Number.NaN, palmLengthMm: 90, palmWidthMm: 80 }),
    ],
    [
      "an infinite palm width",
      () => ({ handLengthMm: 190, palmLengthMm: 90, palmWidthMm: Infinity }),
    ],
    ["a missing field", () => ({ palmLengthMm: 90, palmWidthMm: 80 })],
    [
      "a value that is not a number",
      () => ({ handLengthMm: "190", palmWidthMm: 80 }),
    ],
    ["nothing", () => undefined],
    [
      "a throw",
      () => {
        throw new RangeError("bad");
      },
    ],
  ])(
    "%s: the photo is excluded with a reason, on that path only",
    (_label, apply) => {
      const r = withApply(apply);
      expect(r.counts.measured).toBe(0);
      expect(r.counts.notMeasured).toBe(3);
      expect(field(r, "all", "paper-edge").accuracy.stats).toBeNull();
      const rows = r.excluded.filter((e) => e.stage === "measurement");
      // 3 photos x 2 paths
      expect(rows).toHaveLength(6);
      expect(new Set(rows.map((e) => e.reasons.join()))).toEqual(
        new Set(["CALIBRATION_INVALID"]),
      );
    },
  );

  it("only the photo it broke is dropped; the rest are measured as usual", () => {
    const r = run([right(190), right(188), right(192)], {
      calibration: {
        name: "picky",
        apply: (m) =>
          m.handLengthMm > 191 ? { ...m, handLengthMm: Number.NaN } : m,
      },
    });
    expect(r.counts.measured).toBe(2);
    expect(field(r, "all", "paper-edge").accuracy.stats!.n).toBe(2);
    expect(
      r.excluded
        .filter((e) => e.reasons[0] === "CALIBRATION_INVALID")
        .map((e) => e.id),
    ).toEqual(["P001/G01R/3", "P001/G01R/3"]);
  });

  it("a field is never half-filled: no photo counts for one measurement and not the other", () => {
    const r = run([right(190), right(188)], {
      calibration: {
        name: "no-palm",
        apply: (m) => ({ handLengthMm: m.handLengthMm }) as never,
      },
    });
    expect(
      field(r, "all", "paper-edge", "palmWidthMm").accuracy.stats,
    ).toBeNull();
    expect(field(r, "all", "paper-edge").accuracy.stats).toBeNull();
  });
});

describe("what the correction is told", () => {
  it("gets the path and the page's hand of each photo, and its answer is what is judged", () => {
    const calls: { path: string; hand: string; length: number }[] = [];
    const r = run(
      [
        right(190),
        left(170, { markersMm: 171 }),
        left(172, { detectedHand: "right" }), // the page decides, not the detector
      ],
      {
        calibration: {
          name: "spy",
          apply: (m, context) => {
            calls.push({
              path: context.path,
              hand: context.hand,
              length: Math.round(m.handLengthMm),
            });
            return { ...m, handLengthMm: m.handLengthMm + 10 };
          },
        },
      },
    );
    // Two paths per photo, in photo order and path order.
    expect(calls).toEqual([
      { path: "markers", hand: "right", length: 190 },
      { path: "paper-edge", hand: "right", length: 190 },
      { path: "markers", hand: "left", length: 171 },
      { path: "paper-edge", hand: "left", length: 170 },
      { path: "markers", hand: "left", length: 172 },
      { path: "paper-edge", hand: "left", length: 172 },
    ]);
    // Its answer (+10) is what is judged, against each hand's own truth:
    // 200 - 190, 180 - 170 and 182 - 170.
    expect(field(r, "all", "paper-edge").accuracy.stats!.bias).toBeCloseTo(
      (10 + 10 + 12) / 3,
      8,
    );
  });

  it("is not called for a photo that has no plane on that path", () => {
    const paths: string[] = [];
    run([right(190, { markersMm: null })], {
      calibration: {
        name: "spy",
        apply: (m, context) => {
          paths.push(context.path);
          return m;
        },
      },
    });
    expect(paths).toEqual(["paper-edge"]);
  });
});

describe("reports the sort cannot place", () => {
  it("a report whose file is not in the log's sort is NOT_IN_SORT", () => {
    const log = runLogOf([right(190), right(189)]);
    const lost = log.reports[2]!.file;
    const trimmed = {
      ...log,
      sort: {
        ...log.sort,
        photos: log.sort.photos.filter((p) => p.file !== lost),
      },
    };
    const r = evaluate({ logs: [trimmed], truths: [TRUTH_P001] });
    expect(r.counts.measured).toBe(1);
    expect(r.counts.notMeasured).toBe(1);
    const row = r.excluded.find((e) => e.reasons[0] === "NOT_IN_SORT")!;
    expect(row).toMatchObject({ stage: "measurement", path: null });
    expect(row.id).toMatch(/^run1#[0-9]+$/);
    expect(row.id).not.toContain(lost);
  });

  it("a file name that appears twice among the reports cannot be told apart (AMBIGUOUS_FILE_NAME), for both", () => {
    const log = runLogOf([right(190), right(189), right(188)]);
    const dup = {
      ...log,
      reports: log.reports.map((x, i) =>
        i === 3 ? { ...x, file: log.reports[2]!.file } : x,
      ),
    };
    const r = evaluate({ logs: [dup], truths: [TRUTH_P001] });
    expect(r.counts.measured).toBe(1); // the third photo only
    const rows = r.excluded.filter(
      (e) => e.reasons[0] === "AMBIGUOUS_FILE_NAME",
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((e) => /^run1#[0-9]+$/.test(e.id))).toBe(true);
  });

  it("a file name that appears twice in the sort is ambiguous too", () => {
    const log = runLogOf([right(190), right(189)]);
    const first = log.sort.photos.find((p) => p.status === "ok")!;
    const dup = {
      ...log,
      sort: { ...log.sort, photos: [...log.sort.photos, { ...first }] },
    };
    const r = evaluate({ logs: [dup], truths: [TRUTH_P001] });
    expect(
      r.excluded.filter((e) => e.reasons[0] === "AMBIGUOUS_FILE_NAME"),
    ).toHaveLength(1);
    expect(r.counts.measured).toBe(1);
  });
});

describe("nothing evaluated: the reason is the real one", () => {
  it("no reports at all", () => {
    const empty = {
      ...runLogOf([right(190)]),
      reports: [],
      sort: { photos: [], coverage: [] },
    };
    expect(
      nothingEvaluatedReason(evaluate({ logs: [empty], truths: [TRUTH_P001] })),
    ).toMatch(/no photo reports at all/);
  });

  it("everything of another pose or participant: says so, with what was selected, and does not point at an empty list", () => {
    const r = run([right(190, { gesture: "G02" })], { participants: ["P001"] });
    expect(r.excluded).toEqual([]);
    const text = nothingEvaluatedReason(r);
    expect(text).toMatch(/1 are participant cards/);
    expect(text).toMatch(/1 are of other poses or participants than selected/);
    expect(text).toMatch(/poses G01; participants P001/);
    expect(text).not.toMatch(/excluded list/);
  });

  it("in scope but unmeasurable: the top reasons with counts", () => {
    const r = run([
      right(190, { noHand: true }),
      right(190, { noHand: true }),
      right(190, { markersMm: null, paperMm: null }),
    ]);
    const text = nothingEvaluatedReason(r);
    expect(text).toMatch(/3 were in scope but could not be measured/);
    expect(text).toMatch(/NO_HAND x4/); // 2 photos x 2 paths
    expect(text).toMatch(/NO_PLANE x2/);
  });
});

describe("how a reading is shown", () => {
  it("two decimals, unless that would make it look equal to its limit", () => {
    expect(readingValue(1.4, 2)).toBe("1.40");
    expect(readingValue(2.4, 2)).toBe("2.40");
    expect(readingValue(null, 2)).toBe("n/a");
    expect(readingValue(2, 2)).toBe("2.00"); // really equal
    expect(readingValue(2.004, 2)).toBe("2.004");
    expect(readingValue(1.9996, 2)).toBe("1.9996");
    expect(readingValue(2.00000001, 2)).toBe("2.00000001");
  });

  it("the summary never says 'X mm against X mm: OUTSIDE'", () => {
    // Errors -2.004 and 0: the worst |error| is 2.004 against the limit 2.
    const r = run([right(187.996), right(190)]);
    const md = renderMarkdown(r);
    expect(md).toMatch(
      /largest \|error\| within the limit: 2\.004 mm against 2\.00 mm: \*\*OUTSIDE\*\*/,
    );
    expect(md).not.toMatch(/: 2\.00 mm against 2\.00 mm: \*\*OUTSIDE\*\*/);
  });
});
