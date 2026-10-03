import { describe, expect, it } from "vitest";
import type { KitCode } from "../../src/lib/learning/kit";
import {
  REVIEW_REASON_TEXT,
  sortPhotosV2,
  type IdentifiedPhotoV2,
} from "../../src/lib/learning/sortv2";
import type { PoseGuess } from "../../src/lib/learning/posecheck";
import {
  AGREED_V2_MAX_EXTRA_SHOTS,
  AGREED_V2_SEQUENCE,
  type KitV2PhotoAssignment,
} from "../../src/lib/learning/session";

const card = (participant: string, version = 2): KitCode => ({
  kind: "participant",
  version,
  participant,
});

type Pred = PoseGuess | null | undefined;

function photo(
  file: string,
  takenAt: number,
  code: KitCode | null,
  predictedPose?: Pred,
  detectedHand?: "left" | "right" | null,
): IdentifiedPhotoV2 {
  return { file, takenAt, code, predictedPose, detectedHand };
}

/** One participant's run: the files IMG_<start>.. in order, each with its pose-check call. */
function run(
  participant: string,
  start: number,
  predictions: readonly Pred[],
  detectedHand?: "left" | "right" | null,
): IdentifiedPhotoV2[] {
  return predictions.map((pred, i) =>
    photo(
      `IMG_${String(start + i).padStart(4, "0")}.jpg`,
      start + i,
      card(participant),
      pred,
      detectedHand,
    ),
  );
}

const PLANNED: Pred[] = ["G02", "G02", "G02", "G04", "G04"];
const NO_CALLS = (n: number): Pred[] => Array(n).fill(null);

/** The fields of KitV2PhotoAssignment, sorted: an entry has these and nothing else. */
const CONTRACT_KEYS = [
  "destination",
  "extraShot",
  "file",
  "gesture",
  "hand",
  "participant",
  "poseCheck",
  "poseSource",
  "shot",
  "status",
];

describe("the plan the sorter follows", () => {
  it("is the agreed-v2 sequence: G02 x3 then G04 x2, one extra shot", () => {
    expect(AGREED_V2_SEQUENCE).toEqual([
      { gesture: "G02", shots: 3 },
      { gesture: "G04", shots: 2 },
    ]);
    expect(AGREED_V2_MAX_EXTRA_SHOTS).toBe(1);
  });
});

describe("a participant's five planned photos", () => {
  const sort = sortPhotosV2(run("P007", 1, PLANNED));

  it("get their pose and shot from the order", () => {
    expect(
      sort.photos.map((p) => [p.file, p.gesture, p.shot, p.destination]),
    ).toEqual([
      ["IMG_0001.jpg", "G02", 1, "P007/G02/1.jpg"],
      ["IMG_0002.jpg", "G02", 2, "P007/G02/2.jpg"],
      ["IMG_0003.jpg", "G02", 3, "P007/G02/3.jpg"],
      ["IMG_0004.jpg", "G04", 1, "P007/G04/1.jpg"],
      ["IMG_0005.jpg", "G04", 2, "P007/G04/2.jpg"],
    ]);
  });

  it("carry every field the evaluator reads, and no other (KitV2PhotoAssignment)", () => {
    for (const p of sort.photos) {
      const assignment: KitV2PhotoAssignment = p;
      expect(Object.keys(assignment).sort()).toEqual(CONTRACT_KEYS);
      expect(p).toMatchObject({
        status: "ok",
        participant: "P007",
        poseSource: "order",
        extraShot: false,
        hand: null,
      });
      expect(p.poseCheck).toEqual({
        predicted: expect.stringMatching(/^G0[24]$/),
        agrees: true,
      });
    }
  });

  it("report coverage and the participant", () => {
    expect(sort.coverage).toEqual([
      {
        participant: "P007",
        gesture: "G02",
        hand: null,
        expected: 3,
        got: 3,
        extra: 0,
      },
      {
        participant: "P007",
        gesture: "G04",
        hand: null,
        expected: 2,
        got: 2,
        extra: 0,
      },
    ]);
    expect(sort.participants).toEqual([
      {
        participant: "P007",
        photos: 5,
        status: "ok",
        reason: null,
        hand: null,
        unfiled: 0,
        predictedPoses: PLANNED,
      },
    ]);
  });
});

describe("every entry satisfies the contract, whatever its status", () => {
  it("ok, pose-mismatch, hand-mismatch, needs-review, no-code and version-mismatch alike", () => {
    const sort = sortPhotosV2(
      [
        // pose-mismatch and hand-mismatch (and ok)
        ...run("P070", 1, ["G04", "G02", "G02", "G04", "G04"], "right"),
        // needs-review
        ...run("P071", 10, NO_CALLS(6)),
        // no-code, version-mismatch
        photo("nocard.jpg", 20, null),
        photo("old.jpg", 21, card("P072", 1)),
      ],
      { mouseHands: { P070: "left" } },
    );
    const entries = sort.photos satisfies readonly KitV2PhotoAssignment[];
    expect(new Set(entries.map((e) => e.status))).toEqual(
      new Set([
        "pose-mismatch",
        "hand-mismatch",
        "needs-review",
        "no-code",
        "version-mismatch",
      ]),
    );
    for (const e of entries) {
      expect(Object.keys(e).sort()).toEqual(CONTRACT_KEYS);
      expect(e.poseSource).toBe("order");
      expect(typeof e.extraShot).toBe("boolean");
      expect(
        e.destination === null ||
          /^P\d{3}\/G0[24]\/\d+\.jpg$/.test(e.destination),
      ).toBe(true);
    }
    // A filed photo has a destination with forward slashes; the others have none.
    expect(
      entries.every(
        (e) =>
          (e.destination !== null) ===
          ["pose-mismatch", "hand-mismatch", "ok"].includes(e.status),
      ),
    ).toBe(true);
  });
});

describe("participants and capture order", () => {
  it("groups by the card's code, wherever the photos sit in the folder", () => {
    const a = run("P001", 1, PLANNED);
    const b = run("P002", 1, PLANNED).map((p, i) => ({
      ...p,
      file: `B_${i}.jpg`,
      takenAt: 0.5 + i,
    }));
    // Interleaved in time.
    const sort = sortPhotosV2([...a, ...b]);
    const of = (id: string) =>
      sort.photos.filter((p) => p.participant === id).map((p) => p.destination);
    expect(of("P001")).toEqual([
      "P001/G02/1.jpg",
      "P001/G02/2.jpg",
      "P001/G02/3.jpg",
      "P001/G04/1.jpg",
      "P001/G04/2.jpg",
    ]);
    expect(of("P002")).toEqual([
      "P002/G02/1.jpg",
      "P002/G02/2.jpg",
      "P002/G02/3.jpg",
      "P002/G04/1.jpg",
      "P002/G04/2.jpg",
    ]);
    expect(sort.participants.map((r) => r.participant)).toEqual([
      "P002", // its first photo (takenAt 0.5) comes first
      "P001",
    ]);
  });

  it("goes by capture time, not input order, and ties keep input order", () => {
    const shuffled = run("P003", 1, PLANNED).reverse();
    const sort = sortPhotosV2(shuffled);
    expect(sort.photos.map((p) => p.file)).toEqual(
      shuffled
        .slice()
        .reverse()
        .map((p) => p.file),
    );
    expect(sort.photos[0]!.gesture).toBe("G02");
    const ties = sortPhotosV2(
      ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg"].map((f) =>
        photo(f, 7, card("P004")),
      ),
    );
    expect(ties.photos.map((p) => [p.file, p.gesture, p.shot])).toEqual([
      ["a.jpg", "G02", 1],
      ["b.jpg", "G02", 2],
      ["c.jpg", "G02", 3],
      ["d.jpg", "G04", 1],
      ["e.jpg", "G04", 2],
    ]);
  });

  it("keeps the file's extension in lower case, and .jpg when there is none", () => {
    const sort = sortPhotosV2(
      ["IMG_1.JPEG", "IMG_2", "IMG_3.jpg", "IMG_4.jpg", "IMG_5.jpg"].map(
        (f, i) => photo(f, i, card("P005")),
      ),
    );
    expect(sort.photos.slice(0, 2).map((p) => p.destination)).toEqual([
      "P005/G02/1.jpeg",
      "P005/G02/2.jpg",
    ]);
  });

  it("never reads the pose from the folder or the file name", () => {
    // Names that look like poses mean nothing: only the order does.
    const sort = sortPhotosV2(
      ["G04_flat.jpg", "claw.jpg", "x.jpg", "y.jpg", "z.jpg"].map((f, i) =>
        photo(f, i, card("P006")),
      ),
    );
    expect(sort.photos.slice(0, 3).map((p) => p.gesture)).toEqual([
      "G02",
      "G02",
      "G02",
    ]);
  });
});

describe("the hand comes from participant.json; MediaPipe only checks it", () => {
  it("uses the recorded mouse hand, whatever MediaPipe says", () => {
    const sort = sortPhotosV2(run("P010", 1, PLANNED, "right"), {
      mouseHands: { P010: "left" },
    });
    for (const p of sort.photos) {
      expect(p.hand).toBe("left");
      // MediaPipe said right: flagged, still filed in its place.
      expect(p.status).toBe("hand-mismatch");
      expect(p.destination).toMatch(/^P010\/G0[24]\/\d\.jpg$/);
    }
    expect(sort.coverage.every((r) => r.hand === "left")).toBe(true);
    expect(sort.participants[0]!.hand).toBe("left");
  });

  it("says nothing when they agree or when MediaPipe found no hand", () => {
    const agree = sortPhotosV2(run("P011", 1, PLANNED, "left"), {
      mouseHands: { P011: "left" },
    });
    expect(agree.photos.every((p) => p.status === "ok")).toBe(true);
    const none = sortPhotosV2(run("P011", 1, PLANNED, null), {
      mouseHands: { P011: "left" },
    });
    expect(none.photos.every((p) => p.status === "ok")).toBe(true);
  });

  it("flags nothing and records no hand while participant.json is not filled in", () => {
    for (const hands of [undefined, {}, { P012: null }, { P012: undefined }]) {
      const sort = sortPhotosV2(run("P012", 1, PLANNED, "right"), {
        mouseHands: hands,
      });
      expect(sort.photos.every((p) => p.hand === null)).toBe(true);
      expect(sort.photos.every((p) => p.status === "ok")).toBe(true);
    }
  });

  it("takes no hand from the lookup's inherited properties: a participant named like one gets none", () => {
    // Object.prototype has toString, constructor, __proto__ ...; none is a record.
    for (const name of [
      "toString",
      "constructor",
      "__proto__",
      "hasOwnProperty",
    ]) {
      const sort = sortPhotosV2(run(name, 1, PLANNED, "right"), {
        mouseHands: {},
        shotCounts: {},
      });
      expect(sort.photos).toHaveLength(5);
      expect(sort.photos.every((p) => p.hand === null)).toBe(true);
      expect(sort.photos.every((p) => p.status === "ok")).toBe(true);
      expect(sort.participants[0]!.hand).toBeNull();
    }
    // And an own entry still works beside them.
    const own = sortPhotosV2(run("P013", 1, PLANNED), {
      mouseHands: { P013: "right" },
    });
    expect(own.photos.every((p) => p.hand === "right")).toBe(true);
  });
});

describe("the pose check is a flag: it never places or moves a photo", () => {
  it("flags a photo whose call disagrees, and leaves it in the pose the order gave it", () => {
    // The third G02 shot looks like a claw; the second G04 shot looks flat.
    const sort = sortPhotosV2(
      run("P020", 1, ["G02", "G02", "G04", "G04", "G02"]),
    );
    expect(
      sort.photos.map((p) => [p.gesture, p.shot, p.status, p.poseCheck]),
    ).toEqual([
      ["G02", 1, "ok", { predicted: "G02", agrees: true }],
      ["G02", 2, "ok", { predicted: "G02", agrees: true }],
      ["G02", 3, "pose-mismatch", { predicted: "G04", agrees: false }],
      ["G04", 1, "ok", { predicted: "G04", agrees: true }],
      ["G04", 2, "pose-mismatch", { predicted: "G02", agrees: false }],
    ]);
    expect(sort.photos.map((p) => p.destination)).toEqual([
      "P020/G02/1.jpg",
      "P020/G02/2.jpg",
      "P020/G02/3.jpg",
      "P020/G04/1.jpg",
      "P020/G04/2.jpg",
    ]);
  });

  it("an abstention or a missing hand flags nothing", () => {
    const sort = sortPhotosV2(
      run("P021", 1, [null, undefined, "G02", null, "G04"]),
    );
    expect(sort.photos.map((p) => p.poseCheck)).toEqual([
      { predicted: null, agrees: null },
      { predicted: null, agrees: null },
      { predicted: "G02", agrees: true },
      { predicted: null, agrees: null },
      { predicted: "G04", agrees: true },
    ]);
    expect(sort.photos.every((p) => p.status === "ok")).toBe(true);
  });

  it("a pose mismatch outranks a hand mismatch in the one status", () => {
    const sort = sortPhotosV2(
      run("P022", 1, ["G04", "G02", "G02", "G04", "G04"], "right"),
      { mouseHands: { P022: "left" } },
    );
    expect(sort.photos[0]!.status).toBe("pose-mismatch");
    expect(sort.photos[1]!.status).toBe("hand-mismatch");
  });
});

describe("any count but five needs Kirby's shotCounts: the pose check does not place an extra photo", () => {
  it("six photos without shotCounts go to review, even when every pose-check call is clear and agrees on one arrangement", () => {
    // Four flat then two claws, each called: the old rule would have placed the extra by this.
    const sort = sortPhotosV2(
      run("P030", 1, ["G02", "G02", "G02", "G02", "G04", "G04"]),
    );
    expect(sort.photos.every((p) => p.status === "needs-review")).toBe(true);
    expect(sort.photos.every((p) => p.destination === null)).toBe(true);
    expect(
      sort.photos.every((p) => p.gesture === null && p.shot === null),
    ).toBe(true);
    expect(sort.participants[0]).toMatchObject({
      status: "needs-review",
      reason: "photo-count-not-planned",
      photos: 6,
    });
    expect(sort.coverage).toEqual([]);
  });

  it.each([1, 2, 3, 4, 7])(
    "%i photos without shotCounts go to review too: fewer than five is not guessed either",
    (n) => {
      const sort = sortPhotosV2(run("P031", 1, NO_CALLS(n)));
      expect(sort.photos.every((p) => p.status === "needs-review")).toBe(true);
      expect(sort.participants[0]!.reason).toBe("photo-count-not-planned");
    },
  );

  it("a review message tells Kirby to fill shotCounts and run again", () => {
    for (const reason of [
      "photo-count-not-planned",
      "shot-counts-do-not-match",
      "unreadable-photo-in-run",
    ] as const) {
      expect(REVIEW_REASON_TEXT[reason]).toMatch(/shotCounts/);
      expect(REVIEW_REASON_TEXT[reason]).toMatch(/run the sorter again/);
    }
  });

  it("with shotCounts {G02: 4, G04: 2} the fourth photo is an extra G02, whatever the pose check says", () => {
    // The calls say the fourth photo is a claw; the counts decide, the check only flags.
    const sort = sortPhotosV2(
      run("P032", 1, ["G02", "G02", "G02", "G04", "G04", "G04"]),
      { shotCounts: { P032: { G02: 4, G04: 2 } } },
    );
    expect(
      sort.photos.map((p) => [p.gesture, p.shot, p.extraShot, p.status]),
    ).toEqual([
      ["G02", 1, false, "ok"],
      ["G02", 2, false, "ok"],
      ["G02", 3, false, "ok"],
      ["G02", 4, true, "pose-mismatch"],
      ["G04", 1, false, "ok"],
      ["G04", 2, false, "ok"],
    ]);
    expect(sort.coverage).toMatchObject([
      { gesture: "G02", expected: 3, got: 4, extra: 1 },
      { gesture: "G04", expected: 2, got: 2, extra: 0 },
    ]);
  });

  it("with {G02: 3, G04: 3} the extra is the third G04 shot", () => {
    const sort = sortPhotosV2(run("P033", 1, NO_CALLS(6)), {
      shotCounts: { P033: { G02: 3, G04: 3 } },
    });
    expect(
      sort.photos.map((p) => [p.gesture, p.shot, p.extraShot, p.destination]),
    ).toEqual([
      ["G02", 1, false, "P033/G02/1.jpg"],
      ["G02", 2, false, "P033/G02/2.jpg"],
      ["G02", 3, false, "P033/G02/3.jpg"],
      ["G04", 1, false, "P033/G04/1.jpg"],
      ["G04", 2, false, "P033/G04/2.jpg"],
      ["G04", 3, true, "P033/G04/3.jpg"],
    ]);
  });

  it("with shotCounts for a short run ({G02: 3, G04: 1}) the four photos are filed in those slots", () => {
    const sort = sortPhotosV2(run("P034", 1, NO_CALLS(4)), {
      shotCounts: { P034: { G02: 3, G04: 1 } },
    });
    expect(sort.photos.map((p) => [p.gesture, p.shot, p.status])).toEqual([
      ["G02", 1, "ok"],
      ["G02", 2, "ok"],
      ["G02", 3, "ok"],
      ["G04", 1, "ok"],
    ]);
    expect(sort.coverage).toMatchObject([
      { gesture: "G02", expected: 3, got: 3 },
      { gesture: "G04", expected: 2, got: 1 },
    ]);
  });

  it("shotCounts that do not add up to the photos, or allow two extras, go to review", () => {
    const wrongTotal = sortPhotosV2(run("P035", 1, NO_CALLS(6)), {
      shotCounts: { P035: { G02: 3, G04: 2 } },
    });
    expect(wrongTotal.participants[0]).toMatchObject({
      status: "needs-review",
      reason: "shot-counts-do-not-match",
    });
    const twoExtras = sortPhotosV2(run("P036", 1, NO_CALLS(7)), {
      shotCounts: { P036: { G02: 4, G04: 3 } },
    });
    expect(twoExtras.participants[0]!.reason).toBe("shot-counts-do-not-match");
    expect(twoExtras.photos.every((p) => p.destination === null)).toBe(true);
  });

  it("shotCounts null means as planned: five photos are placed, any other count is review", () => {
    const five = sortPhotosV2(run("P037", 1, NO_CALLS(5)), {
      shotCounts: { P037: null },
    });
    expect(five.photos.every((p) => p.status === "ok")).toBe(true);
    const six = sortPhotosV2(run("P037", 1, NO_CALLS(6)), {
      shotCounts: { P037: null },
    });
    expect(six.participants[0]!.reason).toBe("photo-count-not-planned");
  });

  it("a review keeps the recorded hand and leaves other participants alone", () => {
    const sort = sortPhotosV2(
      [...run("P038", 1, NO_CALLS(6), "right"), ...run("P039", 10, PLANNED)],
      { mouseHands: { P038: "left" } },
    );
    expect(
      sort.photos
        .filter((p) => p.participant === "P038")
        .every((p) => p.hand === "left"),
    ).toBe(true);
    expect(
      sort.photos
        .filter((p) => p.participant === "P039")
        .every((p) => p.status === "ok"),
    ).toBe(true);
    expect(sort.coverage.map((r) => r.participant)).toEqual(["P039", "P039"]);
  });
});

describe("photos with no readable card", () => {
  const stray = (file: string, takenAt: number) => photo(file, takenAt, null);

  it("are not filed and name no participant", () => {
    const sort = sortPhotosV2(
      [stray("blur.jpg", 1), ...run("P050", 2, PLANNED)],
      {
        shotCounts: { P050: { G02: 3, G04: 2 } },
      },
    );
    expect(sort.photos[0]).toMatchObject({
      file: "blur.jpg",
      status: "no-code",
      participant: null,
      gesture: null,
      hand: null,
      shot: null,
      destination: null,
      poseSource: "order",
      extraShot: false,
      poseCheck: null,
    });
  });

  it("beside a participant's run they send it to review: the stray may be theirs", () => {
    const inside = sortPhotosV2([
      ...run("P051", 1, ["G02", "G02"]),
      stray("no-card.jpg", 3),
      ...run("P051", 4, ["G02", "G04", "G04"]),
    ]);
    // Five identified photos, but one with no card in the middle: not guessed.
    expect(inside.participants[0]).toMatchObject({
      status: "needs-review",
      reason: "unreadable-photo-in-run",
    });
    expect(
      inside.photos
        .filter((p) => p.participant === "P051")
        .map((p) => p.status),
    ).toEqual(Array(5).fill("needs-review"));
  });

  it("unless Kirby has written shotCounts for them: then the counts decide", () => {
    const sort = sortPhotosV2(
      [
        ...run("P052", 1, ["G02", "G02"]),
        stray("no-card.jpg", 3),
        ...run("P052", 4, ["G02", "G04", "G04"]),
      ],
      { shotCounts: { P052: { G02: 3, G04: 2 } } },
    );
    expect(sort.participants[0]!.status).toBe("ok");
    expect(
      sort.photos.filter((p) => p.participant === "P052").map((p) => p.gesture),
    ).toEqual(["G02", "G02", "G02", "G04", "G04"]);
  });

  it("between two runs both are suspect; before the first or after the last, the run it touches", () => {
    const between = sortPhotosV2([
      ...run("P053", 1, PLANNED),
      stray("between.jpg", 6),
      ...run("P054", 7, PLANNED),
    ]);
    expect(between.participants.map((r) => r.status)).toEqual([
      "needs-review",
      "needs-review",
    ]);
    const edges = sortPhotosV2([
      stray("first.jpg", 0),
      ...run("P055", 1, PLANNED),
      ...run("P056", 6, PLANNED),
      stray("end.jpg", 99),
    ]);
    expect(edges.participants.map((r) => r.status)).toEqual([
      "needs-review",
      "needs-review",
    ]);
    // A stray in the middle of nowhere, between runs far apart, touches only its neighbours.
    const apart = sortPhotosV2([
      ...run("P057", 1, PLANNED),
      ...run("P058", 6, PLANNED),
      stray("end.jpg", 99),
    ]);
    expect(apart.participants.map((r) => r.status)).toEqual([
      "ok",
      "needs-review",
    ]);
  });
});

describe("photos of another kit version", () => {
  it("a kit v1 card or pose page is a version mismatch and names nobody", () => {
    const sort = sortPhotosV2([
      photo("v1-card.jpg", 1, card("P060", 1)),
      photo("v1-pose.jpg", 2, {
        kind: "gesture",
        version: 1,
        gesture: "G01",
        hand: "right",
      }),
      ...run("P061", 3, PLANNED),
    ]);
    expect(sort.photos.slice(0, 2)).toMatchObject([
      { status: "version-mismatch", participant: null, destination: null },
      { status: "version-mismatch", participant: null, destination: null },
    ]);
    expect(sort.participants.map((r) => r.participant)).toEqual(["P061"]);
  });

  it("a pose page's code, even at this version, is not a participant card", () => {
    const sort = sortPhotosV2([
      photo("pose.jpg", 1, {
        kind: "gesture",
        version: 2,
        gesture: "G02",
        hand: "left",
      }),
    ]);
    expect(sort.photos[0]).toMatchObject({
      status: "no-code",
      participant: null,
      gesture: null,
    });
  });
});

describe("a photo whose copy cannot be made keeps its slot but is not filed", () => {
  it("the photos after it do not shift pose; it has no destination and a status naming why", () => {
    const sort = sortPhotosV2(run("P080", 1, NO_CALLS(5)), {
      unfileable: {
        "IMG_0002.jpg": "not-a-jpeg",
        "IMG_0004.jpg": "damaged-jpeg",
      },
    });
    expect(
      sort.photos.map((p) => [p.gesture, p.shot, p.status, p.destination]),
    ).toEqual([
      ["G02", 1, "ok", "P080/G02/1.jpg"],
      ["G02", 2, "not-a-jpeg", null],
      ["G02", 3, "ok", "P080/G02/3.jpg"],
      ["G04", 1, "damaged-jpeg", null],
      ["G04", 2, "ok", "P080/G04/2.jpg"],
    ]);
    // Coverage and the participant row count what is actually filed.
    expect(sort.coverage).toMatchObject([
      { gesture: "G02", expected: 3, got: 2 },
      { gesture: "G04", expected: 2, got: 1 },
    ]);
    expect(sort.participants[0]).toMatchObject({
      status: "ok",
      photos: 5,
      unfiled: 2,
    });
  });

  it("still carries the whole contract entry", () => {
    const sort = sortPhotosV2(run("P081", 1, NO_CALLS(5)), {
      unfileable: { "IMG_0001.jpg": "copy-failed" },
    });
    const e = sort.photos[0]! satisfies KitV2PhotoAssignment;
    expect(Object.keys(e).sort()).toEqual(CONTRACT_KEYS);
    expect(e).toMatchObject({
      status: "copy-failed",
      destination: null,
      gesture: "G02",
      shot: 1,
    });
  });

  it("does not turn a participant's file into a refusal of another's, and ignores inherited names", () => {
    const sort = sortPhotosV2(run("P082", 1, NO_CALLS(5)), {
      unfileable: { "other.jpg": "not-a-jpeg" },
    });
    expect(sort.photos.every((p) => p.destination !== null)).toBe(true);
    const proto = sortPhotosV2([photo("toString", 1, card("P083"))], {
      unfileable: {},
    });
    expect(proto.photos[0]!.status).toBe("needs-review");
  });
});
