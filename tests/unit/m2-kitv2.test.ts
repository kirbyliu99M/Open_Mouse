import { describe, expect, it } from "vitest";
import {
  parseKitV2RunLog,
  EvaluationInputError,
} from "../../src/lib/m2/inputs";
import {
  ACCURACY_DORMANT_REASON,
  DEFAULT_KIT_V2_GESTURES,
  FLAT_POSE,
  CLAW_POSE,
  HAND_LENGTH_LANDMARKS,
  HELD_OUT_NOTICE,
  KIT_V2_EVALUATION_FORMAT,
  KIT_V2_POSES,
  PALM_LENGTH_LANDMARKS,
  evaluateKitV2,
  type KitV2Input,
  type KitV2Report,
} from "../../src/lib/m2/kitv2";
import type { EvaluateOptions } from "../../src/lib/m2/evaluate";
import { MEASUREMENT_DEFINITIONS } from "../../src/lib/contracts/measurement";
import { truthOf } from "./helpers/m2-synth";
import {
  destinationsOf,
  fileNameOf,
  kitV2LogOf,
  labelsRecordOf,
  participantRecordOf,
  sessionRecordOf,
  type KitV2SynthPhoto,
} from "./helpers/m2-kitv2-synth";
import { toAggregateOnly } from "../../src/lib/m2/aggregate";
import { renderMarkdown } from "../../src/lib/m2/markdown";

// Every expected number is worked out by hand from the lengths below. The
// synthetic planes map pixels to millimetres 1:1 (scaled for the marker
// plane), so a photo made with `markersMm: 190` measures a hand length of
// exactly 190 mm on the marker path.

type Extra = Partial<KitV2SynthPhoto>;
const g02 = (
  participant: string,
  markersMm: number,
  paperMm: number | null = markersMm,
  extra: Extra = {},
): KitV2SynthPhoto => ({
  participant,
  gesture: "G02",
  markersMm,
  paperMm,
  ...extra,
});
const g04 = (
  participant: string,
  markersMm: number,
  extra: Extra = {},
): KitV2SynthPhoto => ({
  participant,
  gesture: "G04",
  markersMm,
  ...extra,
});

/**
 * The scenario. Block P001-P004 is complete (P004 is its held-out member),
 * P009 and P010 are in a block with two members (pending), P901 is S0.
 */
const PHOTOS: KitV2SynthPhoto[] = [
  // P001: G02 190 191 189 on the markers, the paper edge 1 mm longer each.
  g02("P001", 190, 191),
  g02("P001", 191, 192),
  g02("P001", 189, 190),
  g04("P001", 152),
  g04("P001", 133, {
    detectedHand: "left",
    refusedBy: { hand: ["HANDEDNESS_MISMATCH"] },
  }),
  // P002: palm ratio 0.6. Paper edge 179 182 180 against markers 180 182 181.
  g02("P002", 180, 179, { palmRatio: 0.6 }),
  g02("P002", 182, 182, { palmRatio: 0.6 }),
  g02("P002", 181, 180, {
    palmRatio: 0.6,
    refusedBy: { paper: ["PAPER_CORNER_HIDDEN"] },
  }),
  g04("P002", 145),
  g04("P002", 145, { noHand: true, refusedBy: { hand: ["HAND_NOT_FOUND"] } }),
  // P003: two G02 photos; one G04 whose hand length (90) is below the
  // contract's 100 mm, so it has landmarks but no measurements.
  g02("P003", 170),
  g02("P003", 170.5),
  g04("P003", 90),
  // P004, the held-out member of block 0.
  g02("P004", 200),
  g02("P004", 205),
  g02("P004", 195),
  g04("P004", 160),
  g04("P004", 160),
  // S0 pilot.
  g02("P901", 185),
  g02("P901", 185),
  g02("P901", 185),
  // P009 and P010: a block that is not complete.
  g02("P009", 175),
  g02("P009", 175),
  g02("P010", 175),
  g02("P010", 175),
];

const RECORDS = [
  participantRecordOf("P001", { gripSelf: "claw" }),
  participantRecordOf("P002", { gripSelf: "palm" }),
  participantRecordOf("P003", { gripSelf: "unsure" }),
  participantRecordOf("P004", { gripSelf: "claw" }),
  participantRecordOf("P901", { gripSelf: "palm" }),
];
const SESSIONS = [sessionRecordOf("S001", { phone: "Phone A, main 1x" })];

function input(
  photos: readonly KitV2SynthPhoto[] = PHOTOS,
  more: Partial<KitV2Input> = {},
  logOptions: Parameters<typeof kitV2LogOf>[1] = {},
): KitV2Input {
  return {
    logs: [parseKitV2RunLog(kitV2LogOf(photos, logOptions), "run log 1")],
    records: RECORDS,
    sessions: SESSIONS,
    ...more,
  };
}

function run(
  options: EvaluateOptions = {},
  photos: readonly KitV2SynthPhoto[] = PHOTOS,
  more: Partial<KitV2Input> = {},
): KitV2Report {
  return evaluateKitV2(input(photos, more), {
    now: new Date("2026-10-05T00:00:00Z"),
    ...options,
  });
}

// Plain arithmetic, written here and not taken from the code under test.
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const quantile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
};

describe("agreed-v2 evaluation: the default run is the calibration set", () => {
  const r = run();

  it("is an agreed-v2 report with accuracy dormant and the default pose G02", () => {
    expect(r.format).toBe(KIT_V2_EVALUATION_FORMAT);
    expect(r.protocol).toBe("agreed-v2");
    expect(r.accuracy).toEqual({ status: "dormant", reason: "no ruler truth" });
    expect(ACCURACY_DORMANT_REASON).toBe("no ruler truth");
    expect(DEFAULT_KIT_V2_GESTURES).toEqual(["G02"]);
    expect(r.options.gestures).toEqual(["G02"]);
    expect(r.options.selection).toBe("calibration");
    expect(r.notices).toEqual([]);
    expect(r.aggregateOnly).toBe(false);
  });

  it("the poses and landmarks come from the contract and the product's definitions", () => {
    expect(KIT_V2_POSES).toEqual(["G02", "G04"]);
    expect(FLAT_POSE).toBe("G02");
    expect(CLAW_POSE).toBe("G04");
    // distance(0, 12) and distance(0, 9), parsed from MEASUREMENT_DEFINITIONS.
    expect(MEASUREMENT_DEFINITIONS.handLengthMm).toBe("distance(0, 12)");
    expect(MEASUREMENT_DEFINITIONS.palmLengthMm).toBe("distance(0, 9)");
    expect(HAND_LENGTH_LANDMARKS).toEqual([0, 12]);
    expect(PALM_LENGTH_LANDMARKS).toEqual([0, 9]);
  });

  it("evaluates P001-P003 only: held-out, S0 and a pending block are left out, and the counts say so", () => {
    expect(r.selection).toMatchObject({
      mode: "calibration",
      seed: "bec9449f79d85ac5",
      known: 7,
      inSet: 3,
      roles: {
        calibration: 3,
        "held-out": 1,
        s0: 1,
        pending: 2,
        unnumbered: 0,
      },
      leftOutPhotos: {
        "held-out": 5, // P004
        s0: 3, // P901
        pending: 4, // P009, P010
        calibration: 0,
        unnumbered: 0,
        notRequested: 0,
      },
      requestedOutsideSetCount: 0,
    });
    expect(r.inputs.participants).toEqual(["P001", "P002", "P003"]);
    expect(r.inputs.participantCount).toBe(3);
    expect(r.counts).toEqual({
      reports: 25,
      cards: 0,
      outOfScope: 12,
      notMeasured: 1, // P002's G04 with no hand
      measured: 12,
    });
  });

  it("G02 repeatability: pooled within-person SD sqrt(4.125 / 5) = 0.908, reference value 1.0 mm (report only), 3 people, 8 photos", () => {
    const rep = r.kitV2.repeatability;
    expect(rep.pooledSdMm).toBeCloseTo(Math.sqrt(4.125 / 5), 9);
    // Report only: 1.0 mm is a reference value, and no verdict is attached to it.
    expect(rep.referenceMm).toBe(1.0);
    expect(rep).not.toHaveProperty("withinLimit");
    expect(rep.people).toBe(3);
    expect(rep.photosBehindSd).toBe(8);
    expect(rep.peopleWithPhotos).toBe(3);
    expect(rep.photos).toBe(8);
    // The photo the product refused (P002's third) is still one of the three.
    expect(rep.rows.find((x) => x.participant === "P002")!.photos).toBe(3);
  });

  it("path agreement: person-level bias 1/9 and SD sqrt(57)/9; photo-level bias 0.125 over 8 photos", () => {
    // P001: +1 +1 +1. P002: -1 0 -1. P003: 0 0.
    const a = r.kitV2.pathAgreement;
    expect(a.personLevel!.n).toBe(3);
    expect(a.personLevel!.biasMm).toBeCloseTo(1 / 9, 9);
    expect(a.personLevel!.sdMm).toBeCloseTo(Math.sqrt(57) / 9, 9);
    expect(a.photoLevel!.n).toBe(8);
    expect(a.photoLevel!.biasMm).toBeCloseTo(0.125, 9);
    expect(a.photoLevel!.sdMm).toBeCloseTo(sd([1, 1, 1, -1, 0, -1, 0, 0]), 9);
    expect(
      a.rows.find((x) => x.participant === "P002")!.meanDifferenceMm,
    ).toBeCloseTo(-2 / 3, 9);
  });

  it("curl ratio: G04 projected length over the person's own mean G02 hand length, using a claw with no field values too", () => {
    const c = r.kitV2.curl;
    const p1 = [152 / 190, 133 / 190];
    const p2 = 145 / 181; // P002's second G04 has no hand: only the first counts
    const p3 = 90 / 170.25; // 90 mm is below the contract's range: landmarks, no measurements
    const means = [mean(p1), p2, p3];
    expect(c.people).toBe(3);
    expect(c.photos).toBe(4);
    expect(c.rows.map((x) => x.participant)).toEqual(["P001", "P002", "P003"]);
    expect(c.rows[0]!.meanRatio).toBeCloseTo(0.75, 9);
    expect(c.rows[0]!.sdRatio).toBeCloseTo(Math.sqrt(0.005), 9);
    expect(c.rows[1]!.meanRatio).toBeCloseTo(p2, 9);
    expect(c.rows[1]!.sdRatio).toBeNull();
    expect(c.rows[2]!.meanRatio).toBeCloseTo(p3, 9);
    const d = c.distribution!;
    expect(d.n).toBe(3);
    expect(d.mean).toBeCloseTo(mean(means), 9);
    expect(d.sd).toBeCloseTo(sd(means), 9);
    expect(d.min).toBeCloseTo(Math.min(...means), 9);
    expect(d.median).toBeCloseTo(quantile(means, 0.5), 9);
    expect(d.max).toBeCloseTo(Math.max(...means), 9);
    // Retake variation: only P001 has two G04 photos.
    expect(c.withinPerson).toMatchObject({ people: 1, photos: 2 });
    expect(c.withinPerson.pooledSd).toBeCloseTo(Math.sqrt(0.005), 9);
    expect(c.skipped).toEqual({ noG02: 0, noG04: 0 });
  });

  it("product-gate rates per pose: G02 7 of 8, G04 3 of 5, with detection and hand-label agreement", () => {
    const [a, b] = r.kitV2.gate.poses;
    expect(a).toMatchObject({
      gesture: "G02",
      photos: 8,
      accepted: 7,
      handDetected: 8,
      handLabelChecked: 8,
      handLabelAgrees: 8,
    });
    expect(a!.acceptedRate).toBeCloseTo(7 / 8, 12);
    expect(b).toMatchObject({
      gesture: "G04",
      photos: 5,
      accepted: 3,
      handDetected: 4,
      handLabelChecked: 4,
      handLabelAgrees: 3,
    });
    expect(b!.detectionRate).toBeCloseTo(0.8, 12);
    expect(b!.handLabelAgreementRate).toBeCloseTo(0.75, 12);
    expect(r.kitV2.gate.extraShots).toBe(0);
  });

  it("coverage: 10 mm bins of each person's mean hand length, and counts by phone, light, sheet and mouse hand", () => {
    const cov = r.kitV2.coverage;
    expect(cov.people).toBe(3);
    expect(cov.photos).toBe(13);
    expect(cov.peopleWithHandLength).toBe(3);
    expect(cov.handLengthBins).toEqual([
      { fromMm: 170, toMm: 180, people: 1 }, // P003, mean 170.25
      { fromMm: 180, toMm: 190, people: 1 }, // P002, mean 181
      { fromMm: 190, toMm: 200, people: 1 }, // P001, mean 190
    ]);
    expect(cov.byPhone).toEqual([
      { value: "Phone A, main 1x", people: 3, photos: 13 },
    ]);
    expect(cov.bySheet).toEqual([{ value: "A", people: 3, photos: 13 }]);
    expect(cov.byLight).toEqual([
      { value: "ceiling LED", people: 3, photos: 13 },
    ]);
    expect(cov.byMouseHand).toEqual([
      { value: "right", people: 3, photos: 13 },
    ]);
  });

  it("grip calibration: r per person from G02, unsure skipped, current thresholds and the best pair", () => {
    const g = r.kitV2.grip;
    expect(g.path).toBe("markers");
    expect(g.people).toBe(2);
    expect(g.skipped).toEqual({
      unsure: 1,
      noAnswer: 0,
      noRecord: 0,
      noG02: 0,
    });
    const cal = g.calibration!;
    expect(cal.current.thresholds).toEqual({
      palmAtOrAbove: 0.58,
      clawAtOrAbove: 0.54,
    });
    // P001 r 0.55 says claw and is predicted claw; P002 r 0.6 says palm and is predicted palm.
    expect(cal.current.matrix.claw.claw).toBe(1);
    expect(cal.current.matrix.palm.palm).toBe(1);
    expect(cal.current.agree).toBe(2);
    expect(cal.current.rate).toBe(1);
    expect(cal.best.agreement.agree).toBe(2);
    expect(cal.best.tiedPairs).toBe(1);
    expect(cal.best.agreement.thresholds.palmAtOrAbove).toBeCloseTo(0.575, 6);
    expect(cal.best.agreement.thresholds.clawAtOrAbove).toBeCloseTo(0.5495, 6);
  });

  it("one row per person, with the person's own numbers", () => {
    const p1 = r.kitV2.people.find((p) => p.participant === "P001")!;
    expect(p1).toMatchObject({
      hand: "right",
      g02: { photos: 3 },
      pathDifference: { photos: 3 },
      curl: { photos: 2 },
      gripSelf: "claw",
      gripPredicted: "claw",
    });
    expect(p1.g02.meanHandLengthMm).toBeCloseTo(190, 9);
    expect(p1.g02.sdMm).toBeCloseTo(1, 9);
    expect(p1.pathDifference.meanMm).toBeCloseTo(1, 9);
    expect(p1.gripRatio).toBeCloseTo(0.55, 9);
    const p3 = r.kitV2.people.find((p) => p.participant === "P003")!;
    expect(p3.gripSelf).toBe("unsure");
    expect(p3.gripPredicted).toBeNull();
    expect(r.kitV2.people.map((p) => p.participant)).toEqual([
      "P001",
      "P002",
      "P003",
    ]);
  });

  it("lists what was left out, by the product's own codes; a claw's missing field values are not an error", () => {
    expect(r.excluded).toEqual([
      expect.objectContaining({
        id: "P001/G04R/2",
        stage: "product",
        reasons: ["hand:HANDEDNESS_MISMATCH"],
      }),
      expect.objectContaining({
        id: "P002/G02R/3",
        stage: "product",
        reasons: ["paper:PAPER_CORNER_HIDDEN", "hand:NOT_REACHED"],
      }),
      expect.objectContaining({
        id: "P002/G04R/2",
        stage: "measurement",
        path: "markers",
        reasons: ["NO_HAND"],
      }),
      expect.objectContaining({
        id: "P002/G04R/2",
        stage: "measurement",
        path: "paper-edge",
        reasons: ["NO_HAND"],
      }),
    ]);
  });

  it("the field tables stay, for G02 only, with accuracy absent: nothing is compared with a truth", () => {
    expect(r.groups.all.markers!.photos).toBe(8);
    expect(r.groups.accepted.markers!.photos).toBe(7);
    const field = r.groups.all.markers!.fields.handLengthMm!;
    expect(field.accuracy).toEqual({ stats: null, readings: [] });
    expect(field.repeatability.rows).toHaveLength(3);
    expect(field.repeatability.readings).toEqual([]); // no candidate limit under agreed-v2
    for (const group of ["accepted", "all"] as const) {
      for (const path of ["markers", "paper-edge"] as const) {
        for (const f of Object.values(r.groups[group][path]!.fields)) {
          expect(f.accuracy.stats).toBeNull();
          expect(f.accuracy.readings).toEqual([]);
        }
      }
    }
  });

  it("holds no file name, path or landmark", () => {
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/IMG_|\.jpg|landmarks/i);
    expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
  });
});

describe("--held-out and --s0 pick the other sets", () => {
  it("held-out: P004 only, with the notice that it is meant to be run once", () => {
    const r = run({ selection: "held-out" });
    expect(r.options.selection).toBe("held-out");
    expect(r.notices).toEqual([HELD_OUT_NOTICE]);
    expect(HELD_OUT_NOTICE).toMatch(/ONCE/);
    expect(HELD_OUT_NOTICE).toMatch(/Claude/);
    expect(HELD_OUT_NOTICE).toMatch(/frozen/);
    expect(r.inputs.participants).toEqual(["P004"]);
    expect(r.selection.inSet).toBe(1);
    expect(r.selection.leftOutPhotos).toMatchObject({
      calibration: 13,
      s0: 3,
      pending: 4,
      "held-out": 0,
    });
    // P004: 200 205 195, SD 5 mm, over the 1.0 criterion.
    expect(r.kitV2.repeatability.pooledSdMm).toBeCloseTo(5, 9);
    expect(r.kitV2.repeatability.referenceMm).toBe(1.0);
    expect(r.kitV2.repeatability.people).toBe(1);
    expect(r.kitV2.curl.rows[0]!.meanRatio).toBeCloseTo(0.8, 9);
  });

  it("S0: the pilot on its own, never mixed with calibration", () => {
    const r = run({ selection: "s0" });
    expect(r.inputs.participants).toEqual(["P901"]);
    expect(r.kitV2.repeatability.pooledSdMm).toBeCloseTo(0, 9);
    expect(r.notices).toEqual([]);
    expect(r.selection.leftOutPhotos.calibration).toBe(13);
  });

  it("--participants narrows within the set; one outside it is named and not evaluated", () => {
    const r = run({ participants: ["P001", "P004"] });
    expect(r.inputs.participants).toEqual(["P001"]);
    expect(r.selection.requestedOutsideSet).toEqual(["P004"]);
    expect(r.selection.requestedOutsideSetCount).toBe(1);
    // P002 (5 photos) and P003 (3) are in the set but were not named.
    expect(r.selection.leftOutPhotos.notRequested).toBe(8);
    // The held-out photos stayed out (P004 is not reachable from the default run).
    expect(r.selection.leftOutPhotos["held-out"]).toBe(5);
    expect(r.kitV2.repeatability.peopleWithPhotos).toBe(1);
  });

  it("a set with nobody in it is a report with nothing measured, not an error", () => {
    const r = run({ participants: ["P004"] });
    expect(r.counts.measured).toBe(0);
    expect(r.kitV2.repeatability.pooledSdMm).toBeNull();
    expect(r.kitV2.coverage.people).toBe(0);
  });
});

// Small scenarios use the S0 ids (P901 and up): the S0 set needs no complete
// block, so a handful of photos is enough to check one mechanic.
const runS0 = (
  photos: readonly KitV2SynthPhoto[],
  options: EvaluateOptions = {},
  more: Partial<KitV2Input> = {},
): KitV2Report => run({ selection: "s0", ...options }, photos, more);

describe("where a photo's identity comes from", () => {
  it("participant, pose, hand and shot come from the sort assignment, never from the QR code", () => {
    const base = run();
    const log = kitV2LogOf(PHOTOS) as {
      reports: { code: unknown; qrText: string }[];
    };
    // Every card now says somebody else, and one says a pose.
    log.reports.forEach((rep, i) => {
      rep.code =
        i === 0
          ? { kind: "gesture", version: 9, gesture: "G01", hand: "left" }
          : { kind: "participant", version: 2, participant: "P999" };
      rep.qrText = "https://example.test/l/v2/P999";
    });
    const changed = evaluateKitV2(
      {
        logs: [parseKitV2RunLog(log, "run log 1")],
        records: RECORDS,
        sessions: SESSIONS,
      },
      { now: new Date("2026-10-05T00:00:00Z") },
    );
    expect(changed).toEqual(base);
  });

  it("a photo the sorter could not place is NOT_ASSIGNED and is not counted anywhere else", () => {
    const r = runS0([
      g02("P901", 190),
      g02("P901", 191),
      g02("P901", 189, 189, { assignedTo: null }),
    ]);
    expect(r.counts).toMatchObject({ measured: 2, notMeasured: 1 });
    expect(r.excluded).toEqual([
      expect.objectContaining({
        stage: "measurement",
        reasons: ["NOT_ASSIGNED:no-code"],
      }),
    ]);
    expect(r.kitV2.gate.poses[0]!.photos).toBe(2);
    expect(r.kitV2.repeatability.photos).toBe(2);
    // A status that is not a plain word is not repeated.
    const odd = runS0([
      g02("P901", 190),
      g02("P901", 189, 189, { assignedTo: null, status: "C:\\Users\\me" }),
    ]);
    expect(odd.excluded[0]!.reasons).toEqual(["NOT_ASSIGNED"]);
  });

  it("a report that is not in the sort is NOT_IN_SORT; a file name used twice is AMBIGUOUS_FILE_NAME", () => {
    const log = kitV2LogOf([
      g02("P901", 190),
      g02("P901", 191),
      g02("P901", 189),
    ]) as {
      reports: { file: string }[];
      sort: { photos: { file: string }[] };
    };
    const lost = log.reports[2]!.file;
    log.sort.photos = log.sort.photos.filter((p) => p.file !== lost);
    log.reports[1]!.file = log.reports[0]!.file;
    const r = evaluateKitV2(
      { logs: [parseKitV2RunLog(log, "run log 1")] },
      { selection: "s0" },
    );
    const reasons = r.excluded.flatMap((e) => e.reasons).sort();
    expect(reasons).toEqual([
      "AMBIGUOUS_FILE_NAME",
      "AMBIGUOUS_FILE_NAME",
      "NOT_IN_SORT",
    ]);
    expect(r.counts.measured).toBe(0);
    // The ids name the run and the report's place, never the file.
    expect(r.excluded.every((e) => /^run1#\d+$/.test(e.id))).toBe(true);
  });

  it("the same participant, pose and shot twice (a folder sorted twice) counts once: the first", () => {
    const photos = [g02("P901", 190), g02("P901", 191), g04("P901", 150)];
    const one = kitV2LogOf(photos);
    const again = kitV2LogOf(photos);
    const opts = { selection: "s0" } as const;
    const twice = evaluateKitV2(
      {
        logs: [
          parseKitV2RunLog(one, "run log 1"),
          parseKitV2RunLog(again, "run log 2"),
        ],
      },
      opts,
    );
    const once = evaluateKitV2(
      { logs: [parseKitV2RunLog(one, "run log 1")] },
      opts,
    );
    expect(twice.kitV2.repeatability).toEqual(once.kitV2.repeatability);
    expect(twice.kitV2.gate).toEqual(once.kitV2.gate);
    expect(twice.kitV2.curl).toEqual(once.kitV2.curl);
    expect(twice.counts.notMeasured).toBe(3);
    expect(
      twice.excluded.filter((e) => e.reasons[0] === "DUPLICATE_ASSIGNMENT"),
    ).toHaveLength(3);
  });

  it("an extra shot is counted and logged, and counts as a repeat", () => {
    const r = runS0([
      g02("P901", 190),
      g02("P901", 191),
      g02("P901", 189),
      g02("P901", 190, 190, { extraShot: true, shot: 4 }),
    ]);
    expect(r.kitV2.gate.extraShots).toBe(1);
    expect(r.kitV2.repeatability.photos).toBe(4);
    expect(r.excluded).toEqual([]);
  });

  it("a photo the sorter could not file (needs-review) is NOT_ASSIGNED with the sorter's status, and is counted nowhere else", () => {
    const log = kitV2LogOf([g02("P901", 190), g02("P901", 191)]) as {
      sort: { photos: Record<string, unknown>[] };
    };
    // As the sorter writes a participant it cannot place by order: the
    // participant is named, but there is no pose, shot or filed copy.
    Object.assign(log.sort.photos[1]!, {
      status: "needs-review",
      gesture: null,
      shot: null,
      destination: null,
    });
    const r = evaluateKitV2(
      { logs: [parseKitV2RunLog(log, "run log 1")] },
      { selection: "s0" },
    );
    expect(r.counts).toMatchObject({ measured: 1, notMeasured: 1 });
    expect(r.excluded).toEqual([
      expect.objectContaining({ reasons: ["NOT_ASSIGNED:needs-review"] }),
    ]);
    expect(r.kitV2.gate.poses[0]!.photos).toBe(1);
  });

  it("--gesture naming another pose gets that pose into the field tables only: never into judgement or the per-person statistics, which are G02 and G04", () => {
    const photos = [
      g02("P901", 190),
      g02("P901", 191),
      g02("P901", 189),
      g02("P901", 200),
      g02("P901", 201),
    ];
    const log = kitV2LogOf(photos) as {
      sort: { photos: Record<string, unknown>[] };
    };
    // The last two photos are of another pose, G03, in the sorter's own entries.
    log.sort.photos[3]!.gesture = "G03";
    log.sort.photos[3]!.destination = "P901/G03/1.jpg";
    log.sort.photos[4]!.gesture = "G03";
    log.sort.photos[4]!.destination = "P901/G03/2.jpg";
    const all = [
      "P901/G02/1.jpg",
      "P901/G02/2.jpg",
      "P901/G02/3.jpg",
      "P901/G03/1.jpg",
      "P901/G03/2.jpg",
    ].map((file) => ({ file, label: "good" as const }));
    const r = evaluateKitV2(
      {
        logs: [parseKitV2RunLog(log, "run log 1")],
        labels: [labelsRecordOf("S001", true, all)],
      },
      { selection: "s0", gestures: ["G03"] },
    );
    // The field tables show the G03 photos, and only those.
    expect(r.groups.all.markers!.photos).toBe(2);
    expect(r.counts.measured).toBe(5);
    // Everything protocol-defined stays on G02 and G04.
    expect(r.kitV2.repeatability.photos).toBe(3);
    expect(r.kitV2.gate.poses.map((p) => [p.gesture, p.photos])).toEqual([
      ["G02", 3],
      ["G04", 0],
    ]);
    expect(r.kitV2.coverage.photos).toBe(3);
    expect(r.kitV2.pathAgreement.photoLevel!.n).toBe(3);
    expect(r.kitV2.judgement.coverage.photos).toBe(3);
    expect(r.kitV2.judgement.headline!.photos).toBe(3);
    expect(r.kitV2.judgement.coverage.labelled).toBe(3);
    // The G03 labels name photos that exist, so they are not "labels with no photo".
    expect(r.kitV2.judgement.coverage.labelsWithNoPhoto).toBe(0);
  });

  it("a status in a sort entry, as a sorter might add, is allowed through and not read", () => {
    const r = runS0([
      g02("P901", 190, 190, { status: "ok" }),
      g02("P901", 191),
    ]);
    expect(r.counts.measured).toBe(2);
  });
});

describe("people are the unit", () => {
  it("a person with more photos does not weigh more in the path agreement", () => {
    // P001 has four photos 1 mm apart, P002 one photo 5 mm apart, P003 one
    // photo 0 apart; P004 completes the block (and is held out).
    const r = run(
      {},
      [
        g02("P001", 190, 191),
        g02("P001", 190, 191),
        g02("P001", 190, 191),
        g02("P001", 190, 191),
        g02("P002", 180, 185),
        g02("P003", 175),
        g02("P004", 175),
      ],
      { records: [] },
    );
    const a = r.kitV2.pathAgreement;
    expect(a.personLevel!.n).toBe(3);
    expect(a.personLevel!.biasMm).toBeCloseTo((1 + 5 + 0) / 3, 9);
    expect(a.photoLevel!.n).toBe(6);
    expect(a.photoLevel!.biasMm).toBeCloseTo((4 * 1 + 5 + 0) / 6, 9);
  });

  it("a participant with photos of both hands is left out of the person-level statistics and listed", () => {
    // Block P005-P008 is complete, P006 is its held-out member; P007 has both hands.
    const r = run(
      {},
      [
        g02("P005", 190),
        g02("P005", 191),
        g02("P007", 180, 180, { hand: "right" }),
        g02("P007", 185, 185, { hand: "left" }),
        g02("P008", 175),
        g02("P008", 176),
        g02("P006", 170),
      ],
      { records: [] },
    );
    expect(r.kitV2.repeatability.peopleWithPhotos).toBe(2); // P005 and P008
    expect(r.excluded).toEqual([
      expect.objectContaining({
        id: "P007",
        stage: "person",
        reasons: ["MIXED_HANDS"],
      }),
    ]);
    // Still counted for coverage, as both hands.
    expect(r.kitV2.coverage.people).toBe(3);
    expect(r.kitV2.coverage.byMouseHand).toContainEqual({
      value: "(both)",
      people: 1,
      photos: 2,
    });
  });
});

describe("a hand that is not recorded", () => {
  // P001-P004 is a complete block (P004 held out); P001's hand is not recorded.
  const photos = [
    g02("P001", 190, 191, { hand: null }),
    g02("P001", 192, 193, { hand: null }),
    g02("P002", 180),
    g02("P003", 170),
    g02("P004", 160),
  ];

  it("is measured all the same (the raw baseline needs no hand), counted as unknown", () => {
    const r = run({}, photos, { records: [] });
    expect(r.counts.measured).toBe(4);
    expect(r.kitV2.repeatability.peopleWithPhotos).toBe(3);
    expect(r.kitV2.coverage.byMouseHand).toEqual([
      { value: "right", people: 2, photos: 2 },
      { value: "unknown", people: 1, photos: 2 },
    ]);
    const row =
      r.groups.all.markers!.fields.handLengthMm!.repeatability.rows[0]!;
    expect(row).toMatchObject({
      participant: "P001",
      hand: null,
      gesture: "G02",
    });
  });

  it("a correction that needs the hand refuses those photos: NO_MOUSE_HAND, and no number from them", () => {
    const r = run(
      {
        calibration: {
          name: "per-hand",
          apply: (m) => ({ ...m, handLengthMm: m.handLengthMm + 1 }),
        },
      },
      photos,
      { records: [] },
    );
    const refused = r.excluded.filter((e) => e.reasons[0] === "NO_MOUSE_HAND");
    expect(refused).toHaveLength(4); // two photos, two planes
    expect(r.kitV2.repeatability.peopleWithPhotos).toBe(2); // P002 and P003
    // Their landmarks exist all the same.
    expect(r.counts.measured).toBe(4);
  });
});

describe("a model correction is judged, on the planes it applies to", () => {
  it("the path agreement uses the corrected values; the curl ratio and the grip ratio stay raw geometry", () => {
    const base = run();
    const corrected = run({
      calibration: {
        name: "paper+10",
        apply: (m, { path }) =>
          path === "paper-edge"
            ? { ...m, handLengthMm: m.handLengthMm + 10 }
            : m,
      },
    });
    expect(corrected.model).toBe("paper+10");
    expect(corrected.kitV2.pathAgreement.personLevel!.biasMm).toBeCloseTo(
      base.kitV2.pathAgreement.personLevel!.biasMm + 10,
      9,
    );
    expect(corrected.kitV2.pathAgreement.personLevel!.sdMm).toBeCloseTo(
      base.kitV2.pathAgreement.personLevel!.sdMm!,
      9,
    );
    expect(corrected.kitV2.curl).toEqual(base.kitV2.curl);
    expect(corrected.kitV2.grip).toEqual(base.kitV2.grip);
    expect(corrected.kitV2.repeatability).toEqual(base.kitV2.repeatability);
  });
});

describe("coverage by phone and sheet", () => {
  it("counts each session's phone from the session records or from a record embedded in the log", () => {
    const logA = kitV2LogOf(
      [g02("P001", 190), g02("P001", 191), g02("P002", 180)],
      { session: "S001", sheet: "A" },
    );
    const embedded = sessionRecordOf("S002", { phone: "Phone B", sheet: "A" });
    const logB = kitV2LogOf(
      [g02("P003", 170), g02("P003", 171), g02("P004", 160)],
      {
        session: embedded,
        sheet: null, // the embedded record's own sheet is used
        firstFile: 100,
      },
    );
    const nobody = kitV2LogOf([g02("P005", 170)], {
      session: null,
      sheet: null,
      firstFile: 200,
    });
    const r = evaluateKitV2(
      {
        logs: [
          parseKitV2RunLog(logA, "run log 1"),
          parseKitV2RunLog(logB, "run log 2"),
          parseKitV2RunLog(nobody, "run log 3"),
        ],
        sessions: SESSIONS,
      },
      { selection: "calibration" },
    );
    // P001-P004 is a complete block (held-out P004); P005 is pending: out of the run.
    expect(r.kitV2.coverage.byPhone).toEqual([
      { value: "Phone A, main 1x", people: 2, photos: 3 },
      { value: "Phone B", people: 1, photos: 2 },
    ]);
    // Sheet A only: the embedded record's own sheet is used when the top level has none.
    expect(r.kitV2.coverage.bySheet).toEqual([
      { value: "A", people: 3, photos: 5 },
    ]);
    expect(r.inputs.runLogs.map((l) => [l.session, l.sheet])).toEqual([
      ["S001", "A"],
      ["S002", "A"],
      [null, null],
    ]);
  });

  it("counts people and photos by the session's light, as typed but cleaned: folded spaces, no control characters, not long", () => {
    const logA = kitV2LogOf(
      [g02("P001", 190), g02("P001", 191), g02("P002", 180)],
      {
        session: sessionRecordOf("S001", { light: "window,   diffuse\u0007" }),
      },
    );
    const logB = kitV2LogOf([g02("P003", 170)], {
      session: sessionRecordOf("S002", { light: "x".repeat(200) }),
      firstFile: 100,
    });
    const logC = kitV2LogOf([g02("P004", 160)], {
      session: null,
      sheet: null,
      firstFile: 200,
    });
    const r = evaluateKitV2(
      {
        logs: [
          parseKitV2RunLog(logA, "run log 1"),
          parseKitV2RunLog(logB, "run log 2"),
          parseKitV2RunLog(logC, "run log 3"),
        ],
      },
      { selection: "calibration" },
    );
    // P004 is held out: P001-P003 are evaluated.
    expect(r.kitV2.coverage.byLight).toEqual([
      { value: "window, diffuse", people: 2, photos: 3 },
      { value: "x".repeat(60), people: 1, photos: 1 },
    ]);
    // No session record at all: "unknown".
    const unknown = evaluateKitV2(
      { logs: [parseKitV2RunLog(logC, "run log 3")] },
      { selection: "s0" },
    );
    expect(unknown.kitV2.coverage.byLight).toEqual([]);
  });

  it("a person whose photos come from two phones is '(several)'", () => {
    const one = kitV2LogOf([g02("P001", 190), g02("P002", 180)], {
      session: "S001",
    });
    const two = kitV2LogOf(
      [g02("P001", 191, 191, { shot: 2 }), g02("P003", 170)],
      { session: "S002", firstFile: 50 },
    );
    const none = kitV2LogOf([g02("P004", 160)], {
      session: null,
      sheet: null,
      firstFile: 90,
    });
    const r = evaluateKitV2(
      {
        logs: [
          parseKitV2RunLog(one, "run log 1"),
          parseKitV2RunLog(two, "run log 2"),
          parseKitV2RunLog(none, "run log 3"),
        ],
        sessions: [
          sessionRecordOf("S001", { phone: "Phone A" }),
          sessionRecordOf("S002", { phone: "Phone B" }),
        ],
      },
      { selection: "calibration" },
    );
    // P004 is held-out, so P001-P003 are evaluated.
    expect(r.kitV2.coverage.byPhone).toEqual([
      { value: "(several)", people: 1, photos: 2 },
      { value: "Phone A", people: 1, photos: 1 },
      { value: "Phone B", people: 1, photos: 1 },
    ]);
  });

  it("a log with no session record, or a bare session id nobody has a record for, is 'unknown'", () => {
    const noSession = evaluateKitV2(
      {
        logs: [
          parseKitV2RunLog(
            kitV2LogOf([g02("P901", 190)], { session: null }),
            "run log 1",
          ),
        ],
      },
      { selection: "s0" },
    );
    expect(noSession.kitV2.coverage.byPhone).toEqual([
      { value: "unknown", people: 1, photos: 1 },
    ]);
    const bareId = evaluateKitV2(
      {
        logs: [
          parseKitV2RunLog(
            kitV2LogOf([g02("P901", 190)], { session: "S001" }),
            "run log 1",
          ),
        ],
      },
      { selection: "s0" },
    );
    expect(bareId.kitV2.coverage.byPhone).toEqual([
      { value: "unknown", people: 1, photos: 1 },
    ]);
  });
});

describe("what agreed-v2 refuses", () => {
  it("a truth file: a candidate-v1 one is the forbidden mix, and any other is not read either", () => {
    const truth = truthOf("P001", { handLengthMm: 190, palmWidthMm: 80 });
    expect(() => run({}, PHOTOS, { truths: [truth] })).toThrow(
      /candidate-v1 file but the run logs are agreed-v2.*never mixed/s,
    );
    expect(() =>
      run({}, PHOTOS, { truths: [{ ...truth, protocol: "agreed-v2" }] }),
    ).toThrow(/agreed-v2 has no ruler truth/);
    expect(() => run({}, PHOTOS, { truths: [truth] })).toThrow(
      EvaluationInputError,
    );
  });

  it("the other protocol, thresholds, and no path", () => {
    expect(() => run({ protocol: "candidate-v1" })).toThrow(
      /run logs are agreed-v2 \(kit v2: format 3 with protocol agreed-v2\) but the protocol asked for is candidate-v1/,
    );
    expect(() => run({ protocol: "agreed-v2" })).not.toThrow();
    expect(() =>
      run({
        thresholds: { status: "x", accuracyMm: {}, repeatabilityMm: {} },
      }),
    ).toThrow(/criteria are frozen in the prereg/);
    expect(() => run({ paths: [] })).toThrow(/at least one path/);
  });

  it("two participant records, or two session records, for the same id", () => {
    expect(() =>
      run({}, PHOTOS, { records: [RECORDS[0]!, RECORDS[0]!] }),
    ).toThrow(/Two participant records are for participant P001/);
    expect(() =>
      run({}, PHOTOS, { sessions: [SESSIONS[0]!, SESSIONS[0]!] }),
    ).toThrow(/Two session records are for session S001/);
  });

  it("without participant records everything else still runs; grip says no record", () => {
    const r = run({}, PHOTOS, { records: [] });
    expect(r.kitV2.repeatability.people).toBe(3);
    expect(r.kitV2.grip.people).toBe(0);
    expect(r.kitV2.grip.skipped.noRecord).toBe(3);
    expect(r.kitV2.grip.calibration).toBeNull();
    expect(r.kitV2.people[0]!.gripSelf).toBe("no-record");
  });

  it("people with no answer or an unusable one are counted, not guessed", () => {
    const r = run({}, PHOTOS, {
      records: [
        participantRecordOf("P001", { gripSelf: null }),
        participantRecordOf("P002", { gripSelf: "unsure" }),
        participantRecordOf("P003", { gripSelf: "fingertip" }),
      ],
    });
    expect(r.kitV2.grip.skipped).toEqual({
      unsure: 1,
      noAnswer: 1,
      noRecord: 0,
      noG02: 0,
    });
    expect(r.kitV2.grip.people).toBe(1); // P003 only
  });
});

describe("people missing a pose", () => {
  it("a person with no G02 photo has no curl ratio and no grip; counted as skipped, not as a zero", () => {
    const r = run({}, [
      g02("P001", 190),
      g02("P001", 191),
      g04("P002", 150),
      g04("P002", 151),
      g02("P003", 170),
      g02("P003", 171),
      g02("P004", 160),
    ]);
    expect(r.kitV2.curl.people).toBe(0);
    expect(r.kitV2.curl.skipped.noG02).toBe(1); // P002
    expect(r.kitV2.curl.skipped.noG04).toBe(2); // P001 and P003
    expect(r.kitV2.curl.distribution).toBeNull();
  });
});

describe("judgement correctness from the blind labels", () => {
  // The in-scope photos of the default run are PHOTOS[0..12] (P001-P003). The
  // product's verdict here is its photo-quality gates, WITHOUT the handedness
  // gate (#4's only refusal is for handedness, so it is accepted).
  //  idx  pose  product            label
  //   0   G02   accepted           good                  agree
  //   1   G02   accepted           good                  agree
  //   2   G02   accepted           bad [blur]            FALSE ACCEPT
  //   3   G04   accepted           good                  agree
  //   4   G04   accepted (handedness refusal only)  bad [corner-hidden]  FALSE ACCEPT
  //   5   G02   accepted           good                  agree
  //   6   G02   accepted           good                  agree
  //   7   G02   retake (paper)     good                  FALSE REJECT
  //   8   G04   accepted           bad [wrong-pose]      FALSE ACCEPT
  //   9   G04   retake (no hand)   bad [hand-off-sheet]  agree
  //  10   G02   accepted           good                  agree
  //  11   G02   accepted           (not in the labels file)
  //  12   G04   accepted           (label still null)
  const dest = destinationsOf(PHOTOS);
  const name = (index: number) => dest[index]!;
  const LABELS = labelsRecordOf("S001", true, [
    { file: name(0), label: "good" },
    { file: name(1), label: "good" },
    { file: name(2), label: "bad", reasons: ["blur"] },
    { file: name(3), label: "good" },
    { file: name(4), label: "bad", reasons: ["corner-hidden"] },
    { file: name(5), label: "good" },
    { file: name(6), label: "good" },
    { file: name(7), label: "good" },
    { file: name(8), label: "bad", reasons: ["wrong-pose"] },
    { file: name(9), label: "bad", reasons: ["hand-off-sheet"] },
    { file: name(10), label: "good" },
    { file: name(12), label: null },
    // A photo of the held-out P004: it names a photo that exists, in this run or not.
    { file: name(13), label: "good" },
    // And one that names nothing.
    { file: "P999/G02/1.jpg", label: "good" },
  ]);

  it("compares the product's photo-quality verdict with the label: 11 labelled, 7 agree, 3 false accepts, 1 false reject", () => {
    const r = run({}, PHOTOS, { labels: [LABELS] });
    const h = r.kitV2.judgement.headline!;
    expect(h.photos).toBe(11);
    expect(h.agree).toBe(7);
    expect(h.agreementRate).toBeCloseTo(7 / 11, 12);
    expect(h.falseAccepts).toBe(3);
    expect(h.falseRejects).toBe(1);
    expect(h.labelGood).toBe(7);
    expect(h.labelBad).toBe(4);
    expect(h.productAccepted).toBe(9);
    expect(h.productRetake).toBe(2);
    expect(h.falseAcceptShareOfBad).toBeCloseTo(3 / 4, 12);
    expect(h.falseRejectShareOfGood).toBeCloseTo(1 / 7, 12);
    expect(r.kitV2.judgement.target).toBe(0.95);
    expect(r.inputs.labelsFiles).toBe(1);
  });

  it("leaves the handedness gate out: a refusal for handedness alone is not a retake here, but still counts against the acceptance rate", () => {
    const photos = [
      g02("P901", 190, 190, { refusedBy: { hand: ["HANDEDNESS_MISMATCH"] } }),
      // Handedness plus a photo-quality refusal: still a retake.
      g02("P901", 191, 191, {
        refusedBy: { hand: ["HANDEDNESS_MISMATCH", "LOW_LANDMARK_CONFIDENCE"] },
      }),
      g02("P901", 192),
    ];
    const d = destinationsOf(photos);
    const r = run({ selection: "s0" }, photos, {
      labels: [
        labelsRecordOf(
          "S001",
          true,
          d.map((file) => ({ file: file!, label: "good" as const })),
        ),
      ],
    });
    const h = r.kitV2.judgement.headline!;
    expect(h.productAccepted).toBe(2); // #1 and #3
    expect(h.productRetake).toBe(1); // #2
    expect(h.falseRejects).toBe(1);
    expect(h.agree).toBe(2);
    // The acceptance rate is the recorded gates as they are: only #3 is accepted.
    expect(r.kitV2.gate.poses[0]).toMatchObject({ photos: 3, accepted: 1 });
    expect(r.kitV2.judgement.verdictBasis).toMatch(/handedness gate left out/);
    // Hand-label agreement stays reported on its own.
    expect(r.kitV2.gate.poses[0]).toHaveProperty("handLabelAgreementRate");
  });

  it("a photo whose paper was refused has no hand verdict and is a retake; one with no gate record is a retake and counted", () => {
    const photos = [
      g02("P901", 190, 190, { refusedBy: { paper: ["PAPER_CORNER_HIDDEN"] } }),
      g02("P901", 191),
    ];
    const log = kitV2LogOf(photos) as {
      reports: { productGates: unknown }[];
    };
    log.reports[1]!.productGates = null;
    const d = destinationsOf(photos);
    const r = evaluateKitV2(
      {
        logs: [parseKitV2RunLog(log, "run log 1")],
        labels: [
          labelsRecordOf("S001", true, [
            { file: d[0]!, label: "bad", reasons: ["corner-hidden"] },
            { file: d[1]!, label: "bad", reasons: ["blur"] },
          ]),
        ],
      },
      { selection: "s0" },
    );
    const h = r.kitV2.judgement.headline!;
    expect(h.productRetake).toBe(2);
    expect(h.agree).toBe(2);
    expect(h.noGateRecord).toBe(1);
  });

  it("by pose and by reason", () => {
    const h = run({}, PHOTOS, { labels: [LABELS] }).kitV2.judgement.headline!;
    expect(h.byPose[0]).toMatchObject({
      gesture: "G02",
      photos: 7,
      agree: 5,
      falseAccepts: 1,
      falseRejects: 1,
    });
    expect(h.byPose[1]).toMatchObject({
      gesture: "G04",
      photos: 4,
      agree: 2,
      falseAccepts: 2,
      falseRejects: 0,
    });
    const by = Object.fromEntries(h.byReason.map((x) => [x.reason, x]));
    expect(by["blur"]).toMatchObject({ badPhotos: 1, retake: 0, accepted: 1 });
    expect(by["corner-hidden"]).toMatchObject({
      badPhotos: 1,
      retake: 0,
      accepted: 1,
    });
    expect(by["wrong-pose"]).toMatchObject({
      badPhotos: 1,
      retake: 0,
      accepted: 1,
    });
    expect(by["hand-off-sheet"]).toMatchObject({
      badPhotos: 1,
      retake: 1,
      accepted: 0,
    });
  });

  it("leaves unlabelled photos out and says how many, and by why", () => {
    const c = run({}, PHOTOS, { labels: [LABELS] }).kitV2.judgement;
    expect(c.coverage.photos).toBe(13);
    expect(c.coverage.labelled).toBe(11);
    expect(c.coverage.unlabelled).toBe(2);
    expect(c.coverage.unlabelledBy).toEqual({
      noLabel: 1,
      notLabelledYet: 1,
      notFiled: 0,
      noLabelsFile: 0,
      noSession: 0,
    });
    // One label names nothing; the held-out photo's label names a photo that exists.
    expect(c.coverage.labelsWithNoPhoto).toBe(1);
    expect(c.sessions).toEqual({
      withPhotos: 1,
      withLabelsFile: 1,
      fullyLabelled: 0,
      blind: 1,
      notBlind: 0,
    });
  });

  it("respects the held-out and S0 exclusions exactly as the other statistics do", () => {
    // Held-out run: only P004. Its one label counts; the P001-P003 labels are not its photos.
    const held = run({ selection: "held-out" }, PHOTOS, { labels: [LABELS] });
    const jh = held.kitV2.judgement;
    expect(jh.coverage.photos).toBe(5); // P004: 3 G02, 2 G04
    expect(jh.coverage.labelled).toBe(1);
    expect(jh.headline!.photos).toBe(1);
    expect(jh.headline!.agree).toBe(1);
    expect(jh.coverage.unlabelledBy.noLabel).toBe(4);
    expect(jh.coverage.labelsWithNoPhoto).toBe(1);
    // S0 run: nobody there is labelled.
    const s0 = run({ selection: "s0" }, PHOTOS, { labels: [LABELS] });
    expect(s0.kitV2.judgement.headline).toBeNull();
    expect(s0.kitV2.judgement.coverage.photos).toBe(3);
    expect(s0.kitV2.judgement.coverage.unlabelledBy.noLabel).toBe(3);
    // A fold narrows the photos too.
    const fold = run({ participants: ["P001"] }, PHOTOS, { labels: [LABELS] });
    expect(fold.kitV2.judgement.coverage.photos).toBe(5);
    expect(fold.kitV2.judgement.headline!.photos).toBe(5);
  });

  it("no labels file: no headline, and the photos are all counted as unlabelled; nothing errors", () => {
    const r = run();
    expect(r.kitV2.judgement.headline).toBeNull();
    expect(r.kitV2.judgement.coverage.unlabelled).toBe(13);
    expect(r.kitV2.judgement.coverage.unlabelledBy.noLabelsFile).toBe(13);
    expect(r.inputs.labelsFiles).toBe(0);
  });

  it("a session marked not blind is reported apart from the headline", () => {
    const photos = [
      g02("P901", 190),
      g02("P901", 191),
      g04("P901", 150, { refusedBy: { hand: ["HAND_NOT_FOUND"] } }),
    ];
    const d = destinationsOf(photos);
    const open = labelsRecordOf("S001", false, [
      { file: d[0]!, label: "good" },
      { file: d[1]!, label: "bad", reasons: ["lighting"] },
      { file: d[2]!, label: "bad" },
    ]);
    const r = run({ selection: "s0" }, photos, { labels: [open] });
    const j = r.kitV2.judgement;
    expect(j.headline).toBeNull();
    expect(j.notBlind!.photos).toBe(3);
    expect(j.notBlind!.agree).toBe(2); // #1 accepted good, #3 retake bad
    expect(j.notBlind!.falseAccepts).toBe(1); // #2
    expect(j.coverage).toMatchObject({
      labelled: 3,
      labelledBlind: 0,
      labelledNotBlind: 3,
    });
    expect(j.sessions).toMatchObject({ blind: 0, notBlind: 1 });
    // The same labels, blind, are the headline.
    const blind = run({ selection: "s0" }, photos, {
      labels: [labelsRecordOf("S001", true, open.labels)],
    });
    expect(blind.kitV2.judgement.headline!.photos).toBe(3);
    expect(blind.kitV2.judgement.notBlind).toBeNull();
  });

  it("a label names the photo's destination verbatim: the file's own name, or another spelling, does not label it", () => {
    const photos = [g02("P901", 190), g02("P901", 191)];
    const r = run({ selection: "s0" }, photos, {
      labels: [
        labelsRecordOf("S001", true, [
          { file: "P901/G02/1.jpg", label: "good" },
          // The log's own file name, and a Windows spelling of the second photo's destination.
          { file: fileNameOf(2), label: "bad", reasons: ["blur"] },
          { file: "P901\\G02\\2.jpg", label: "bad", reasons: ["blur"] },
        ]),
      ],
    });
    const h = r.kitV2.judgement.headline!;
    expect(h.photos).toBe(1);
    expect(h.agree).toBe(1);
    expect(r.kitV2.judgement.coverage.unlabelledBy.noLabel).toBe(1);
    // The two labels that name nothing are counted: a naming mismatch shows up there.
    expect(r.kitV2.judgement.coverage.labelsWithNoPhoto).toBe(2);
  });

  it("labels are tied to their session: another session's labels do not label this one's photos", () => {
    const r = run({ selection: "s0" }, [g02("P901", 190)], {
      labels: [
        labelsRecordOf("S002", true, [
          { file: "P901/G02/1.jpg", label: "good" },
        ]),
      ],
    });
    expect(r.kitV2.judgement.headline).toBeNull();
    expect(r.kitV2.judgement.coverage.unlabelledBy.noLabelsFile).toBe(1);
    expect(r.kitV2.judgement.coverage.labelsWithNoPhoto).toBe(1);
  });

  it("the product's verdict is its own gates, not the kit's retake: a photo the kit checker flagged but the product accepts counts as accepted", () => {
    const r = run(
      { selection: "s0" },
      [g02("P901", 190, 190, { retake: true })],
      {
        labels: [
          labelsRecordOf("S001", true, [
            { file: "P901/G02/1.jpg", label: "good" },
          ]),
        ],
      },
    );
    expect(r.kitV2.judgement.headline!.productAccepted).toBe(1);
    expect(r.kitV2.judgement.headline!.agree).toBe(1);
  });

  it("two labels files for one session, or a photo labelled twice: refused", () => {
    expect(() => run({}, PHOTOS, { labels: [LABELS, LABELS] })).toThrow(
      /Two labels files are for session S001/,
    );
    expect(() =>
      run({}, PHOTOS, {
        labels: [
          labelsRecordOf("S001", true, [
            { file: "P001/G02/1.jpg", label: "good" },
            { file: "P001/G02/1.jpg", label: "bad" },
          ]),
        ],
      }),
    ).toThrow(/labels the same photo twice/);
  });

  it("is not touched by --aggregate-only: it has no per-photo row", () => {
    const full = run({}, PHOTOS, { labels: [LABELS] });
    const aggregate = toAggregateOnly(full) as KitV2Report;
    expect(aggregate.kitV2.judgement).toEqual(full.kitV2.judgement);
    expect(JSON.stringify(aggregate.kitV2.judgement)).not.toMatch(
      /IMG_|P\d{3}/,
    );
  });

  it("the summary shows the target as a target, the numbers behind it, and no verdict", () => {
    const md = renderMarkdown(run({}, PHOTOS, { labels: [LABELS] }));
    expect(md).toContain("## Judgement correctness (headline)");
    expect(md).toMatch(
      /Target: 95\.0%\. It is a target, not a pass or fail threshold\./,
    );
    expect(md).toMatch(/handedness gate left out/);
    expect(md).toMatch(
      /Labelled photos: 11 \(labels: 7 good, 4 bad; product: 9 accepted, 2 retake\)\./,
    );
    expect(md).toMatch(
      /\| agreement \(accepted and good, or retake and bad\) \| 7 \| 63\.6% \|/,
    );
    expect(md).toMatch(
      /\| false accepts \(the product accepted, the label says bad\) \| 3 \| 27\.3% \| 75\.0% of the 4 bad \|/,
    );
    expect(md).toMatch(
      /\| false rejects \(the product asked for a retake, the label says good\) \| 1 \| 9\.1% \| 14\.3% of the 7 good \|/,
    );
    expect(md).toMatch(/\| G02 \| 7 \| 5 \(71\.4%\) \| 1 \| 1 \|/);
    expect(md).toMatch(/\| blur \| 1 \| 0 \| 1 \|/);
    expect(md).toMatch(/Left out as unlabelled: 2 \(/);
    expect(md).toMatch(/Labels that name no photo in the run logs: 1\./);
    // Never a verdict on the target.
    expect(md).not.toMatch(/target (was )?(met|reached|missed|not met)/i);
    expect(md).not.toMatch(/accurate/i);
    // And with no labels it says so.
    expect(renderMarkdown(run())).toMatch(
      /No labels file was given \(--labels\)/,
    );
  });
});
