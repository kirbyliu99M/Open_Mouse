import { describe, expect, it } from "vitest";
import { EvaluationInputError } from "../../src/lib/m2/inputs";
import {
  JUDGEMENT_TARGET,
  JUDGEMENT_VERDICT_BASIS,
  REASON_KEYS,
  buildLabelIndex,
  judge,
  judgementStats,
  type JudgedPhoto,
  type KnownPhoto,
} from "../../src/lib/m2/judgement";
import {
  emptyLabelsRecord,
  type LabelsRecord,
  type PHOTO_LABEL_REASONS,
} from "../../src/lib/learning/session";

// Every expected number is worked out by hand from the photos listed in the
// scenario, not by running the code under test. A label names its photo by the
// photo's `destination`, verbatim.

type Reason = (typeof PHOTO_LABEL_REASONS)[number];

const label = (
  file: string,
  value: "good" | "bad" | null,
  reasons: Reason[] = [],
  note = "",
) => ({ file, label: value, reasons, note });

function record(
  session: string,
  blind: boolean,
  labels: ReturnType<typeof label>[],
): LabelsRecord {
  return { ...emptyLabelsRecord(session, []), session, blind, labels };
}

const photo = (
  session: string | null,
  destination: string | null,
  gesture: "G02" | "G04",
  accepted: boolean,
  extra: Partial<JudgedPhoto> = {},
): JudgedPhoto => ({
  session,
  destination,
  gesture,
  accepted,
  hasGateRecord: true,
  ...extra,
});

const asKnown = (p: JudgedPhoto): KnownPhoto => ({
  session: p.session,
  destination: p.destination,
});

describe("the label index refuses what would make a count a guess", () => {
  it("two labels files for one session", () => {
    expect(() =>
      buildLabelIndex([record("S001", true, []), record("S001", true, [])]),
    ).toThrow(/Two labels files are for session S001/);
    expect(() =>
      buildLabelIndex([record("S001", true, []), record("S001", true, [])]),
    ).toThrow(EvaluationInputError);
  });

  it("one photo labelled twice", () => {
    expect(() =>
      buildLabelIndex([
        record("S001", true, [
          label("P901/G02/1.jpg", "good"),
          label("P901/G02/1.jpg", "bad", ["blur"]),
        ]),
      ]),
    ).toThrow(/Labels file 1 labels the same photo twice/);
  });
});

describe("judgement correctness, worked out by hand", () => {
  // Session S001, blind. Thirteen photos of the evaluated participants:
  //  #  pose  product   label
  //  1  G02   accepted   good                        agree
  //  2  G02   accepted   good                        agree
  //  3  G02   accepted   bad  [corner-hidden]        FALSE ACCEPT
  //  4  G02   retake     bad  [blur]                 agree
  //  5  G02   retake     bad  [hand-off-sheet, blur] agree
  //  6  G02   retake     good                        FALSE REJECT
  //  7  G04   accepted   good                        agree
  //  8  G04   accepted   bad  [wrong-pose]           FALSE ACCEPT
  //  9  G04   retake     bad  []                     agree
  // 10  G04   retake     good                        FALSE REJECT
  // 11  G04   retake     bad  [other] (no recorded verdict, so "retake")  agree
  // 12  G04   accepted   (no label at all)
  // 13  G04   retake     (label is still null)
  // Session S002 is NOT blind: #14 accepted good (agree), #15 accepted bad (false accept).
  // Session S003 has no labels file (3 photos); one photo's log names no session.
  const s1: JudgedPhoto[] = [
    photo("S001", "a1.jpg", "G02", true),
    photo("S001", "a2.jpg", "G02", true),
    photo("S001", "a3.jpg", "G02", true),
    photo("S001", "a4.jpg", "G02", false),
    photo("S001", "a5.jpg", "G02", false),
    photo("S001", "a6.jpg", "G02", false),
    photo("S001", "a7.jpg", "G04", true),
    photo("S001", "a8.jpg", "G04", true),
    photo("S001", "a9.jpg", "G04", false),
    photo("S001", "a10.jpg", "G04", false),
    photo("S001", "a11.jpg", "G04", false, { hasGateRecord: false }),
    photo("S001", "a12.jpg", "G04", true),
    photo("S001", "a13.jpg", "G04", false),
  ];
  const s2: JudgedPhoto[] = [
    photo("S002", "b1.jpg", "G02", true),
    photo("S002", "b2.jpg", "G02", true),
  ];
  const s3: JudgedPhoto[] = [
    photo("S003", "c1.jpg", "G02", true),
    photo("S003", "c2.jpg", "G02", false),
    photo("S003", "c3.jpg", "G04", true),
  ];
  const nameless = photo(null, "d1.jpg", "G02", true);
  const photos = [...s1, ...s2, ...s3, nameless];

  const labels = buildLabelIndex([
    record("S001", true, [
      label("a1.jpg", "good"),
      label("a2.jpg", "good"),
      label("a3.jpg", "bad", ["corner-hidden"]),
      label("a4.jpg", "bad", ["blur"]),
      label("a5.jpg", "bad", ["hand-off-sheet", "blur"]),
      label("a6.jpg", "good"),
      label("a7.jpg", "good"),
      label("a8.jpg", "bad", ["wrong-pose"]),
      label("a9.jpg", "bad", []),
      label("a10.jpg", "good"),
      label("a11.jpg", "bad", ["other"], "glare on the card"),
      label("a13.jpg", null),
      // A good label that names no photo in the logs (a typo, say).
      label("zz99.jpg", "good"),
      // A label for a photo of someone left out of this run: it names a real photo.
      label("held-out-photo.jpg", "good"),
    ]),
    record("S002", false, [
      label("b1.jpg", "good"),
      label("b2.jpg", "bad", ["lighting"]),
    ]),
  ]);
  const known: KnownPhoto[] = [
    ...photos.map(asKnown),
    { session: "S001", destination: "held-out-photo.jpg" },
  ];
  const j = judge({ photos, known, labels, poses: ["G02", "G04"] });

  it("the target is 95 %, carried as a target: nothing says met or not met", () => {
    expect(JUDGEMENT_TARGET).toBe(0.95);
    expect(j.target).toBe(0.95);
    // The words of the verdict basis are not a verdict on the target either.
    const text = JSON.stringify({ ...j, verdictBasis: "" });
    expect(text).not.toMatch(/\b(pass|fail|met|within|outside)\b/i);
    expect(Object.keys(j.headline!)).not.toContain("met");
  });

  it("says what the product's verdict is made of: photo-quality gates, the handedness gate left out", () => {
    expect(j.verdictBasis).toBe(JUDGEMENT_VERDICT_BASIS);
    expect(JUDGEMENT_VERDICT_BASIS).toMatch(/photo-quality gates/);
    expect(JUDGEMENT_VERDICT_BASIS).toMatch(/handedness gate left out/);
  });

  it("the headline counts blind labels only: 11 photos, 7 agree (63.6 %)", () => {
    const h = j.headline!;
    expect(h.photos).toBe(11);
    expect(h.agree).toBe(7);
    expect(h.agreementRate).toBeCloseTo(7 / 11, 12);
    expect(h.labelGood).toBe(5);
    expect(h.labelBad).toBe(6);
    expect(h.productAccepted).toBe(5);
    expect(h.productRetake).toBe(6);
  });

  it("false accepts and false rejects: counts, and rates over all labelled and over their own group", () => {
    const h = j.headline!;
    expect(h.falseAccepts).toBe(2); // #3 and #8
    expect(h.falseAcceptRate).toBeCloseTo(2 / 11, 12);
    expect(h.falseAcceptShareOfBad).toBeCloseTo(2 / 6, 12);
    expect(h.falseRejects).toBe(2); // #6 and #10
    expect(h.falseRejectRate).toBeCloseTo(2 / 11, 12);
    expect(h.falseRejectShareOfGood).toBeCloseTo(2 / 5, 12);
    // Agreement, false accepts and false rejects are the whole.
    expect(h.agree + h.falseAccepts + h.falseRejects).toBe(h.photos);
  });

  it("a photo with no recorded verdict is counted as not accepted, and the count says so", () => {
    expect(j.headline!.noGateRecord).toBe(1);
  });

  it("by pose: G02 4 of 6 agree, G04 3 of 5", () => {
    const [g02, g04] = j.headline!.byPose;
    expect(g02).toMatchObject({
      gesture: "G02",
      photos: 6,
      agree: 4,
      falseAccepts: 1,
      falseRejects: 1,
    });
    expect(g02!.agreementRate).toBeCloseTo(4 / 6, 12);
    expect(g04).toMatchObject({
      gesture: "G04",
      photos: 5,
      agree: 3,
      falseAccepts: 1,
      falseRejects: 1,
    });
    expect(g04!.agreementRate).toBeCloseTo(3 / 5, 12);
  });

  it("by the label's reason: a bad photo with two reasons is in two rows; one with none is 'none-given'", () => {
    const by = Object.fromEntries(
      j.headline!.byReason.map((r) => [r.reason, r]),
    );
    expect(j.headline!.byReason.map((r) => r.reason)).toEqual(REASON_KEYS);
    expect(by["corner-hidden"]).toMatchObject({
      badPhotos: 1,
      retake: 0,
      accepted: 1,
    });
    expect(by["blur"]).toMatchObject({ badPhotos: 2, retake: 2, accepted: 0 });
    expect(by["hand-off-sheet"]).toMatchObject({
      badPhotos: 1,
      retake: 1,
      accepted: 0,
    });
    expect(by["wrong-pose"]).toMatchObject({
      badPhotos: 1,
      retake: 0,
      accepted: 1,
    });
    expect(by["other"]).toMatchObject({ badPhotos: 1, retake: 1, accepted: 0 });
    expect(by["none-given"]).toMatchObject({
      badPhotos: 1,
      retake: 1,
      accepted: 0,
    });
    expect(by["lighting"]).toMatchObject({
      badPhotos: 0,
      retake: 0,
      accepted: 0,
    });
    expect(by["fingers-not-per-protocol"]).toMatchObject({ badPhotos: 0 });
    // Reasons describe photos: only bad ones are counted anywhere.
    expect(by["blur"]!.retake + by["blur"]!.accepted).toBe(
      by["blur"]!.badPhotos,
    );
  });

  it("a session that was not blind is reported apart and is not in the headline", () => {
    const n = j.notBlind!;
    expect(n.photos).toBe(2);
    expect(n.agree).toBe(1);
    expect(n.falseAccepts).toBe(1);
    expect(n.agreementRate).toBeCloseTo(0.5, 12);
    // The headline did not take them (it would be 12 photos otherwise).
    expect(j.headline!.photos).toBe(11);
  });

  it("unlabelled photos are left out and counted, by why; nothing is good or bad by default", () => {
    const c = j.coverage;
    expect(c.photos).toBe(19);
    expect(c.labelled).toBe(13);
    expect(c.labelledBlind).toBe(11);
    expect(c.labelledNotBlind).toBe(2);
    expect(c.unlabelled).toBe(6);
    expect(c.unlabelledBy).toEqual({
      noSession: 1, // the photo whose log names no session
      noLabelsFile: 3, // S003
      noLabel: 1, // #12
      notFiled: 0,
      notLabelledYet: 1, // #13
    });
    expect(c.notFiled).toEqual({ total: 0, byStatus: {} });
    expect(c.participantsInReview).toEqual({ total: 0, byReason: {} });
    expect(c.labelled + c.unlabelled).toBe(c.photos);
  });

  it("a label that names no photo is counted (a naming mismatch shows up here); one for a left-out participant is not", () => {
    // zz99 names nothing; held-out-photo.jpg names a photo that is not evaluated but exists.
    expect(j.coverage.labelsWithNoPhoto).toBe(1);
  });

  it("sessions: with photos, with a labels file, fully labelled, blind and not", () => {
    expect(j.sessions).toEqual({
      withPhotos: 3,
      withLabelsFile: 2,
      fullyLabelled: 1, // S002; S001 has two photos without a call
      blind: 1,
      notBlind: 1,
    });
  });
});

describe("matching a label to its photo: by destination, verbatim", () => {
  it("a label names the photo's destination", () => {
    const p = photo("S001", "P901/G02/2.jpg", "G02", true);
    const labels = buildLabelIndex([
      record("S001", true, [label("P901/G02/2.jpg", "good")]),
    ]);
    const r = judge({
      photos: [p],
      known: [asKnown(p)],
      labels,
      poses: ["G02"],
    });
    expect(r.headline!.photos).toBe(1);
    expect(r.headline!.agree).toBe(1);
    expect(r.coverage.labelsWithNoPhoto).toBe(0);
  });

  it("verbatim means verbatim: another case, another separator or another spelling does not match", () => {
    const p = photo("S001", "P901/G02/2.jpg", "G02", true);
    for (const spelling of [
      "p901/g02/2.jpg",
      "P901\\G02\\2.jpg",
      "./P901/G02/2.jpg",
      "P901/G02R/2.jpg",
      "IMG_0007.jpg",
    ]) {
      const labels = buildLabelIndex([
        record("S001", true, [label(spelling, "good")]),
      ]);
      const r = judge({
        photos: [p],
        known: [asKnown(p)],
        labels,
        poses: ["G02"],
      });
      expect(r.headline).toBeNull();
      expect(r.coverage.unlabelledBy.noLabel).toBe(1);
      // And the label that matched nothing is counted, so the mismatch shows.
      expect(r.coverage.labelsWithNoPhoto).toBe(1);
    }
  });

  it("a photo that was not filed has no destination and cannot be labelled", () => {
    const p = photo("S001", null, "G02", true);
    const labels = buildLabelIndex([
      record("S001", true, [label("P901/G02/1.jpg", "good")]),
    ]);
    const r = judge({
      photos: [p],
      known: [asKnown(p)],
      labels,
      poses: ["G02"],
    });
    expect(r.headline).toBeNull();
    // Counted on its own, not as a label the file failed to mention.
    expect(r.coverage.unlabelledBy.notFiled).toBe(1);
    expect(r.coverage.unlabelledBy.noLabel).toBe(0);
    // And the label, which names nothing, shows as a label with no photo.
    expect(r.coverage.labelsWithNoPhoto).toBe(1);
  });

  it("the photos the sorter did not file, and the participants it put in review, are counted by status and reason", () => {
    const r = judge({
      photos: [],
      known: [],
      labels: buildLabelIndex([]),
      poses: ["G02"],
      notFiledByStatus: {
        "needs-review": 5,
        "not-a-jpeg": 1,
        "damaged-jpeg": 2,
      },
      reviewByReason: { "photo-count-not-planned": 1 },
    });
    expect(r.coverage.notFiled).toEqual({
      total: 8,
      byStatus: { "needs-review": 5, "not-a-jpeg": 1, "damaged-jpeg": 2 },
    });
    expect(r.coverage.participantsInReview).toEqual({
      total: 1,
      byReason: { "photo-count-not-planned": 1 },
    });
  });

  it("the same destination in another session is another photo", () => {
    const a = photo("S001", "P901/G02/1.jpg", "G02", true);
    const b = photo("S002", "P901/G02/1.jpg", "G02", true);
    const labels = buildLabelIndex([
      record("S001", true, [label("P901/G02/1.jpg", "good")]),
      record("S002", true, [label("P901/G02/1.jpg", "bad", ["blur"])]),
    ]);
    const r = judge({
      photos: [a, b],
      known: [asKnown(a), asKnown(b)],
      labels,
      poses: ["G02"],
    });
    expect(r.headline!.photos).toBe(2);
    expect(r.headline!.falseAccepts).toBe(1);
    expect(r.headline!.agree).toBe(1);
  });
});

describe("when there is little or nothing to judge", () => {
  it("no labels at all: no headline, every photo counted as unlabelled", () => {
    const p = [
      photo("S001", "a.jpg", "G02", true),
      photo(null, "b.jpg", "G04", true),
    ];
    const r = judge({
      photos: p,
      known: p.map(asKnown),
      labels: buildLabelIndex([]),
      poses: ["G02", "G04"],
    });
    expect(r.headline).toBeNull();
    expect(r.notBlind).toBeNull();
    expect(r.coverage).toMatchObject({ photos: 2, labelled: 0, unlabelled: 2 });
    expect(r.coverage.unlabelledBy.noLabelsFile).toBe(1);
    expect(r.coverage.unlabelledBy.noSession).toBe(1);
    expect(r.sessions).toEqual({
      withPhotos: 1,
      withLabelsFile: 0,
      fullyLabelled: 0,
      blind: 0,
      notBlind: 0,
    });
  });

  it("no photos at all", () => {
    const r = judge({
      photos: [],
      known: [],
      labels: buildLabelIndex([]),
      poses: ["G02"],
    });
    expect(r.headline).toBeNull();
    expect(r.coverage.photos).toBe(0);
    expect(judgementStats([], ["G02"])).toBeNull();
  });

  it("only good photos: no share of bad, never 0 percent", () => {
    const stats = judgementStats(
      [
        {
          gesture: "G02",
          accepted: true,
          hasGateRecord: true,
          label: "good",
          reasons: [],
        },
        {
          gesture: "G02",
          accepted: false,
          hasGateRecord: true,
          label: "good",
          reasons: [],
        },
      ],
      ["G02", "G04"],
    )!;
    expect(stats.labelBad).toBe(0);
    expect(stats.falseAcceptShareOfBad).toBeNull();
    expect(stats.falseRejectShareOfGood).toBeCloseTo(0.5, 12);
    expect(stats.agreementRate).toBeCloseTo(0.5, 12);
    // A pose with no labelled photo has zeros and no rate.
    expect(stats.byPose[1]).toEqual({
      gesture: "G04",
      photos: 0,
      agree: 0,
      agreementRate: null,
      falseAccepts: 0,
      falseRejects: 0,
    });
  });

  it("every photo agrees: 100 %, no false accepts or rejects", () => {
    const stats = judgementStats(
      [
        {
          gesture: "G02",
          accepted: true,
          hasGateRecord: true,
          label: "good",
          reasons: [],
        },
        {
          gesture: "G04",
          accepted: false,
          hasGateRecord: true,
          label: "bad",
          reasons: ["blur"],
        },
      ],
      ["G02", "G04"],
    )!;
    expect(stats.agreementRate).toBe(1);
    expect(stats.falseAccepts).toBe(0);
    expect(stats.falseRejects).toBe(0);
  });
});
