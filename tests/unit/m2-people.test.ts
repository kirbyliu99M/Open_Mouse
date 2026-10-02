import { describe, expect, it } from "vitest";
import {
  G02_REPEATABILITY_LIMIT_MM,
  countByLabel,
  curlRatios,
  distributionOf,
  g02Repeatability,
  histogram,
  pathAgreement,
  poseRates,
  quantileOfSorted,
} from "../../src/lib/m2/people";

// Every expected number below is worked out by hand from the values written
// next to it, not by running the code under test.

describe("quantile and distribution", () => {
  it("interpolates linearly between ranks", () => {
    const xs = [1, 2, 3, 4];
    expect(quantileOfSorted(xs, 0)).toBe(1);
    expect(quantileOfSorted(xs, 1)).toBe(4);
    expect(quantileOfSorted(xs, 0.5)).toBeCloseTo(2.5, 12);
    expect(quantileOfSorted(xs, 0.25)).toBeCloseTo(1.75, 12);
    expect(quantileOfSorted([], 0.5)).toBeNull();
    expect(quantileOfSorted([7], 0.9)).toBe(7);
    expect(() => quantileOfSorted(xs, 1.5)).toThrow(RangeError);
  });

  it("summarises an unsorted list", () => {
    // 1 2 3 4: mean 2.5, sample SD sqrt(5/3).
    const d = distributionOf([3, 1, 4, 2])!;
    expect(d).toMatchObject({ n: 4, min: 1, max: 4 });
    expect(d.mean).toBeCloseTo(2.5, 12);
    expect(d.median).toBeCloseTo(2.5, 12);
    expect(d.q1).toBeCloseTo(1.75, 12);
    expect(d.q3).toBeCloseTo(3.25, 12);
    expect(d.sd).toBeCloseTo(Math.sqrt(5 / 3), 12);
    expect(distributionOf([])).toBeNull();
    expect(distributionOf([5])!.sd).toBeNull();
  });
});

describe("G02 repeatability: pooled within-person SD of hand length", () => {
  // P001 190 191 189: mean 190, SD 1 (squares 0 1 1, over 2).
  // P002 180 182 181: mean 181, SD 1.
  // P003 170 170.5:   SD sqrt(0.125) = 0.353553 (one degree of freedom).
  // P004 200:         one photo, no SD, not in the pooled value.
  const people = [
    { participant: "P004", values: [200] },
    { participant: "P002", values: [180, 182, 181] },
    { participant: "P001", values: [190, 191, 189] },
    { participant: "P003", values: [170, 170.5] },
  ];
  const r = g02Repeatability(people);

  it("pools by degrees of freedom: sqrt((2*1 + 2*1 + 1*0.125) / 5) = 0.908295", () => {
    expect(r.pooledSdMm).toBeCloseTo(Math.sqrt(4.125 / 5), 10);
    expect(r.pooledSdMm).toBeCloseTo(0.908295, 6);
    expect(r.degreesOfFreedom).toBe(5);
  });

  it("says how many people and photos stand behind it", () => {
    expect(r.peopleWithPhotos).toBe(4);
    expect(r.photos).toBe(9);
    expect(r.people).toBe(3); // the person with one photo carries no SD
    expect(r.photosBehindSd).toBe(8);
  });

  it("holds the criterion from the prereg, 1.0 mm, and reads against it", () => {
    expect(G02_REPEATABILITY_LIMIT_MM).toBe(1.0);
    expect(r.limitMm).toBe(1.0);
    expect(r.withinLimit).toBe(true);
    // Not the same thing as the mean of the people's SDs.
    expect(r.meanSdMm).toBeCloseTo((1 + 1 + Math.sqrt(0.125)) / 3, 10);
    expect(r.worstRangeMm).toBeCloseTo(2, 10);
  });

  it("has one row per person, in participant order, one SD per person", () => {
    expect(r.rows.map((x) => x.participant)).toEqual([
      "P001",
      "P002",
      "P003",
      "P004",
    ]);
    expect(r.rows[0]).toMatchObject({
      photos: 3,
      meanMm: 190,
      sdMm: 1,
      rangeMm: 2,
    });
    expect(r.rows[3]).toMatchObject({
      photos: 1,
      meanMm: 200,
      sdMm: null,
      rangeMm: null,
    });
  });

  it("is exactly at the limit when the pooled SD is 1.0: within (at most 1.0)", () => {
    const edge = g02Repeatability([
      { participant: "P001", values: [190, 191, 189] },
    ]);
    expect(edge.pooledSdMm).toBeCloseTo(1, 12);
    expect(edge.withinLimit).toBe(true);
  });

  it("is outside the limit above 1.0", () => {
    // 190, 192.4, 187.6: deviations 0, 2.4, -2.4; SD = sqrt(11.52 / 2) = 2.4.
    const bad = g02Repeatability([
      { participant: "P001", values: [190, 192.4, 187.6] },
    ]);
    expect(bad.pooledSdMm).toBeCloseTo(2.4, 10);
    expect(bad.withinLimit).toBe(false);
  });

  it("has no value, and no verdict, when nobody has two photos", () => {
    const none = g02Repeatability([
      { participant: "P001", values: [190] },
      { participant: "P002", values: [] },
    ]);
    expect(none.pooledSdMm).toBeNull();
    expect(none.withinLimit).toBeNull();
    expect(none.people).toBe(0);
    expect(none.peopleWithPhotos).toBe(1);
    expect(g02Repeatability([]).photos).toBe(0);
  });

  it("a person with more photos weighs more, by degrees of freedom", () => {
    // 4 photos with SD sqrt(5/3)=1.29099 (1 2 3 4) and 2 photos with SD 0.5*sqrt(2).
    const mixed = g02Repeatability([
      { participant: "P001", values: [101, 102, 103, 104] },
      { participant: "P002", values: [100, 101] },
    ]);
    // P002: SD = sqrt(0.5) = 0.707107.
    const expected = Math.sqrt((3 * (5 / 3) + 1 * 0.5) / 4);
    expect(mixed.pooledSdMm).toBeCloseTo(expected, 10);
  });
});

describe("path agreement: paper-edge minus marker, people first", () => {
  // P001 has four photos all 1 mm apart, P002 has one photo 5 mm apart.
  const people = [
    { participant: "P002", differences: [5] },
    { participant: "P001", differences: [1, 1, 1, 1] },
    { participant: "P003", differences: [] },
  ];
  const a = pathAgreement(people);

  it("person-level: the people's means are 1 and 5, so bias 3 and SD sqrt(8)", () => {
    expect(a.personLevel!.n).toBe(2);
    expect(a.personLevel!.biasMm).toBeCloseTo(3, 12);
    expect(a.personLevel!.sdMm).toBeCloseTo(Math.sqrt(8), 12);
  });

  it("photo-level counts photos as if independent: five photos, bias 1.8, SD sqrt(3.2)", () => {
    expect(a.photoLevel!.n).toBe(5);
    expect(a.photoLevel!.biasMm).toBeCloseTo(1.8, 12);
    expect(a.photoLevel!.sdMm).toBeCloseTo(Math.sqrt(3.2), 12);
    // The two levels differ: a person with more photos does not count for more at person level.
    expect(a.photoLevel!.biasMm).not.toBeCloseTo(a.personLevel!.biasMm, 3);
  });

  it("lists each person once with the person's own mean, nobody without a photo", () => {
    expect(a.rows).toEqual([
      { participant: "P001", photos: 4, meanDifferenceMm: 1 },
      { participant: "P002", photos: 1, meanDifferenceMm: 5 },
    ]);
  });

  it("has no SD for one person, and nothing for nobody", () => {
    const one = pathAgreement([{ participant: "P001", differences: [2, 4] }]);
    expect(one.personLevel).toEqual({ n: 1, biasMm: 3, sdMm: null });
    expect(one.photoLevel!.n).toBe(2);
    expect(pathAgreement([]).personLevel).toBeNull();
    expect(pathAgreement([]).photoLevel).toBeNull();
  });
});

describe("curl ratio: G04 projected length over the same person's mean G02 hand length", () => {
  // P001: G02 mean 190; G04 152 and 133 -> ratios 0.8 and 0.7: mean 0.75, SD 0.0707107.
  // P002: G02 mean 200; G04 160 -> 0.8, one photo, no SD.
  // P003: G02 only. P004: G04 only. Neither has a ratio.
  const c = curlRatios([
    { participant: "P004", g02LengthsMm: [], g04ProjectedMm: [150] },
    {
      participant: "P001",
      g02LengthsMm: [190, 192, 188],
      g04ProjectedMm: [152, 133],
    },
    { participant: "P003", g02LengthsMm: [180], g04ProjectedMm: [] },
    { participant: "P002", g02LengthsMm: [200, 200], g04ProjectedMm: [160] },
    { participant: "P005", g02LengthsMm: [], g04ProjectedMm: [] },
  ]);

  it("per person: the mean ratio and the retake SD, in participant order", () => {
    expect(c.rows.map((r) => r.participant)).toEqual(["P001", "P002"]);
    expect(c.rows[0]!.g02MeanMm).toBeCloseTo(190, 12);
    expect(c.rows[0]!.meanRatio).toBeCloseTo(0.75, 12);
    expect(c.rows[0]!.sdRatio).toBeCloseTo(Math.sqrt(0.005), 12); // 0.0707107
    expect(c.rows[0]).toMatchObject({ g02Photos: 3, g04Photos: 2 });
    expect(c.rows[1]!.meanRatio).toBeCloseTo(0.8, 12);
    expect(c.rows[1]!.sdRatio).toBeNull();
  });

  it("overall: the distribution of the people's mean ratios (0.75 and 0.8)", () => {
    expect(c.people).toBe(2);
    expect(c.photos).toBe(3);
    const d = c.distribution!;
    expect(d.n).toBe(2);
    expect(d.mean).toBeCloseTo(0.775, 12);
    expect(d.sd).toBeCloseTo(0.05 / Math.SQRT2, 12); // 0.0353553
    expect(d.min).toBeCloseTo(0.75, 12);
    expect(d.q1).toBeCloseTo(0.7625, 12);
    expect(d.median).toBeCloseTo(0.775, 12);
    expect(d.q3).toBeCloseTo(0.7875, 12);
    expect(d.max).toBeCloseTo(0.8, 12);
  });

  it("retake variation is pooled over the people with two or more G04 photos only", () => {
    expect(c.withinPerson.people).toBe(1);
    expect(c.withinPerson.photos).toBe(2);
    expect(c.withinPerson.pooledSd).toBeCloseTo(Math.sqrt(0.005), 12);
    expect(c.withinPerson.meanSd).toBeCloseTo(Math.sqrt(0.005), 12);
  });

  it("people with only one of the two poses are counted as skipped, not as a zero", () => {
    expect(c.skipped).toEqual({ noG02: 1, noG04: 1 });
  });

  it("with nothing to work with: no distribution, no pooled SD", () => {
    const none = curlRatios([]);
    expect(none.distribution).toBeNull();
    expect(none.withinPerson.pooledSd).toBeNull();
    expect(none.people).toBe(0);
  });
});

describe("product-gate acceptance and the S0 checks, per pose", () => {
  const obs = [
    {
      gesture: "G02",
      accepted: true,
      handDetected: true,
      handLabel: "agrees" as const,
    },
    {
      gesture: "G02",
      accepted: true,
      handDetected: true,
      handLabel: "agrees" as const,
    },
    {
      gesture: "G02",
      accepted: false,
      handDetected: true,
      handLabel: "differs" as const,
    },
    { gesture: "G04", accepted: false, handDetected: false, handLabel: null },
    {
      gesture: "G04",
      accepted: true,
      handDetected: true,
      handLabel: "agrees" as const,
    },
  ];
  const rows = poseRates(obs, ["G02", "G04", "G01"]);

  it("accepted over all, per pose, in the order asked", () => {
    expect(rows.map((r) => r.gesture)).toEqual(["G02", "G04", "G01"]);
    expect(rows[0]).toMatchObject({ photos: 3, accepted: 2 });
    expect(rows[0]!.acceptedRate).toBeCloseTo(2 / 3, 12);
    expect(rows[1]).toMatchObject({
      photos: 2,
      accepted: 1,
      acceptedRate: 0.5,
    });
  });

  it("hand detection over all photos; label agreement over the photos where both labels are known", () => {
    expect(rows[0]).toMatchObject({ handDetected: 3, detectionRate: 1 });
    expect(rows[0]).toMatchObject({ handLabelChecked: 3, handLabelAgrees: 2 });
    expect(rows[0]!.handLabelAgreementRate).toBeCloseTo(2 / 3, 12);
    expect(rows[1]).toMatchObject({ handDetected: 1, detectionRate: 0.5 });
    expect(rows[1]).toMatchObject({
      handLabelChecked: 1,
      handLabelAgrees: 1,
      handLabelAgreementRate: 1,
    });
  });

  it("a pose with no photo has zeros and no rate, never 0 percent", () => {
    expect(rows[2]).toEqual({
      gesture: "G01",
      photos: 0,
      accepted: 0,
      acceptedRate: null,
      handDetected: 0,
      detectionRate: null,
      handLabelChecked: 0,
      handLabelAgrees: 0,
      handLabelAgreementRate: null,
    });
  });
});

describe("coverage", () => {
  it("bins hand length in 10 mm steps, an edge value belongs to the bin that starts there, empty bins are kept", () => {
    const bins = histogram([172.0, 175.5, 181, 199.9, 200.0, 230]);
    expect(bins).toEqual([
      { fromMm: 170, toMm: 180, people: 2 },
      { fromMm: 180, toMm: 190, people: 1 },
      { fromMm: 190, toMm: 200, people: 1 },
      { fromMm: 200, toMm: 210, people: 1 },
      { fromMm: 210, toMm: 220, people: 0 },
      { fromMm: 220, toMm: 230, people: 0 },
      { fromMm: 230, toMm: 240, people: 1 },
    ]);
    expect(histogram([])).toEqual([]);
    expect(histogram([185]).map((b) => [b.fromMm, b.people])).toEqual([
      [180, 1],
    ]);
  });

  it("counts people and photos by label, in label order", () => {
    const rows = countByLabel([
      { label: "Phone B", photos: 5 },
      { label: "Phone A", photos: 5 },
      { label: "Phone A", photos: 4 },
    ]);
    expect(rows).toEqual([
      { value: "Phone A", people: 2, photos: 9 },
      { value: "Phone B", people: 1, photos: 5 },
    ]);
  });
});
