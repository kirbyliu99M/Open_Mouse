import { describe, expect, it } from "vitest";
import type { KitCode } from "../../src/lib/learning/kit";
import {
  REVIEW_REASON_TEXT,
  placeByOrder,
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
        predictedPoses: PLANNED,
      },
    ]);
  });
});

describe("every entry satisfies the contract, whatever its status", () => {
  it("ok, pose-mismatch, hand-mismatch, needs-review, no-code and version-mismatch alike", () => {
    const sort = sortPhotosV2(
      [
        // ok, pose-mismatch and hand-mismatch
        ...run("P070", 1, ["G04", "G02", "G02", "G04", "G04"], "right"),
        // needs-review
        ...run("P071", 10, [null, null, null, null, null, null]),
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
    const sort = sortPhotosV2([
      photo("IMG_1.JPEG", 1, card("P005")),
      photo("IMG_2", 2, card("P005")),
    ]);
    expect(sort.photos.map((p) => p.destination)).toEqual([
      "P005/G02/1.jpeg",
      "P005/G02/2.jpg",
    ]);
  });

  it("never reads the pose from the folder or the file name", () => {
    // Names that look like poses mean nothing: only the order does.
    const sort = sortPhotosV2([
      photo("G04_flat.jpg", 1, card("P006")),
      photo("claw.jpg", 2, card("P006")),
    ]);
    expect(sort.photos.map((p) => p.gesture)).toEqual(["G02", "G02"]);
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

  it("does not take a hand from an inherited property of the lookup", () => {
    const sort = sortPhotosV2(run("toString", 1, PLANNED), {
      mouseHands: {},
    });
    // "toString" is not a participant; nothing is read from Object.prototype.
    expect(sort.photos).toHaveLength(5);
    const real = sortPhotosV2(run("P013", 1, PLANNED), { mouseHands: {} });
    expect(real.photos.every((p) => p.hand === null)).toBe(true);
  });
});

describe("the pose check is a flag: it never moves a photo", () => {
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
    // The destinations are the order's.
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

describe("one extra shot: the pose check says where it goes", () => {
  it("an extra G02 (the fourth photo looks flat): G02 shots 1 to 4, the last one the extra", () => {
    const sort = sortPhotosV2(
      run("P030", 1, ["G02", "G02", "G02", "G02", "G04", "G04"]),
    );
    expect(
      sort.photos.map((p) => [p.gesture, p.shot, p.extraShot, p.status]),
    ).toEqual([
      ["G02", 1, false, "ok"],
      ["G02", 2, false, "ok"],
      ["G02", 3, false, "ok"],
      ["G02", 4, true, "ok"],
      ["G04", 1, false, "ok"],
      ["G04", 2, false, "ok"],
    ]);
    expect(sort.coverage).toMatchObject([
      { gesture: "G02", expected: 3, got: 4, extra: 1 },
      { gesture: "G04", expected: 2, got: 2, extra: 0 },
    ]);
  });

  it("an extra G04 (the fourth photo looks like a claw): G04 shots 1 to 3, the last one the extra", () => {
    const sort = sortPhotosV2(
      run("P031", 1, ["G02", "G02", "G02", "G04", "G04", "G04"]),
    );
    expect(
      sort.photos.map((p) => [p.gesture, p.shot, p.extraShot, p.destination]),
    ).toEqual([
      ["G02", 1, false, "P031/G02/1.jpg"],
      ["G02", 2, false, "P031/G02/2.jpg"],
      ["G02", 3, false, "P031/G02/3.jpg"],
      ["G04", 1, false, "P031/G04/1.jpg"],
      ["G04", 2, false, "P031/G04/2.jpg"],
      ["G04", 3, true, "P031/G04/3.jpg"],
    ]);
    expect(sort.coverage).toMatchObject([
      { gesture: "G02", expected: 3, got: 3, extra: 0 },
      { gesture: "G04", expected: 2, got: 3, extra: 1 },
    ]);
  });

  it("decides on the photo that tells the two apart, even when the other calls abstain", () => {
    const flat = sortPhotosV2(
      run("P032", 1, [null, null, null, "G02", null, null]),
    );
    expect(flat.photos.map((p) => p.gesture)).toEqual([
      "G02",
      "G02",
      "G02",
      "G02",
      "G04",
      "G04",
    ]);
    const claw = sortPhotosV2(
      run("P032", 1, [null, null, null, "G04", null, null]),
    );
    expect(claw.photos.map((p) => p.gesture)).toEqual([
      "G02",
      "G02",
      "G02",
      "G04",
      "G04",
      "G04",
    ]);
  });

  it("is ambiguous, so the participant goes to review, when that photo's call abstains: none of their photos is filed", () => {
    const sort = sortPhotosV2([
      ...run("P033", 1, ["G02", "G02", "G02", null, "G04", "G04"]),
      ...run("P034", 10, PLANNED),
    ]);
    const p33 = sort.photos.filter((p) => p.participant === "P033");
    expect(p33).toHaveLength(6);
    for (const p of p33) {
      expect(p).toMatchObject({
        status: "needs-review",
        gesture: null,
        shot: null,
        destination: null,
        extraShot: false,
        poseSource: "order",
        poseCheck: null,
      });
    }
    expect(sort.participants.find((r) => r.participant === "P033")).toEqual({
      participant: "P033",
      photos: 6,
      status: "needs-review",
      reason: "extra-shot-placement-unclear",
      hand: null,
      predictedPoses: ["G02", "G02", "G02", null, "G04", "G04"],
    });
    // No coverage rows for a participant in review; the others are untouched.
    expect(sort.coverage.map((r) => r.participant)).toEqual(["P034", "P034"]);
    expect(
      sort.photos
        .filter((p) => p.participant === "P034")
        .every((p) => p.status === "ok" && p.destination !== null),
    ).toBe(true);
  });

  it("is ambiguous when every call abstains or there is no hand", () => {
    for (const calls of [
      [null, null, null, null, null, null],
      [undefined, undefined, undefined, undefined, undefined, undefined],
    ] as Pred[][]) {
      const sort = sortPhotosV2(run("P035", 1, calls));
      expect(sort.photos.every((p) => p.status === "needs-review")).toBe(true);
    }
  });

  it("a hand-mismatch is not hidden by review: a participant in review keeps their recorded hand", () => {
    const sort = sortPhotosV2(
      run("P036", 1, [null, null, null, null, null, null], "right"),
      {
        mouseHands: { P036: "left" },
      },
    );
    expect(sort.photos.every((p) => p.hand === "left")).toBe(true);
    expect(sort.photos.every((p) => p.status === "needs-review")).toBe(true);
  });

  it("more photos than the plan and one extra is review too, never guessed", () => {
    const sort = sortPhotosV2(
      run("P037", 1, ["G02", "G02", "G02", "G02", "G02", "G04", "G04"]),
    );
    expect(sort.photos.every((p) => p.status === "needs-review")).toBe(true);
    expect(sort.participants[0]).toMatchObject({
      status: "needs-review",
      reason: "too-many-photos",
      photos: 7,
    });
  });

  it("every review reason has text for a person", () => {
    for (const reason of [
      "too-many-photos",
      "extra-shot-placement-unclear",
      "unreadable-photo-in-run",
    ] as const) {
      expect(REVIEW_REASON_TEXT[reason].length).toBeGreaterThan(10);
    }
  });
});

describe("fewer photos than planned", () => {
  it("files them in order and reports the shortfall; the pose check still only flags", () => {
    const sort = sortPhotosV2(run("P040", 1, ["G02", "G02", "G04", "G04"]));
    expect(sort.photos.map((p) => [p.gesture, p.shot, p.status])).toEqual([
      ["G02", 1, "ok"],
      ["G02", 2, "ok"],
      ["G02", 3, "pose-mismatch"],
      ["G04", 1, "ok"],
    ]);
    expect(sort.coverage).toMatchObject([
      { gesture: "G02", expected: 3, got: 3 },
      { gesture: "G04", expected: 2, got: 1 },
    ]);
  });

  it("a single photo is the first G02 shot", () => {
    const sort = sortPhotosV2(run("P041", 1, ["G02"]));
    expect(sort.photos[0]).toMatchObject({ gesture: "G02", shot: 1 });
  });
});

describe("photos with no readable card", () => {
  const stray = (file: string, takenAt: number) => photo(file, takenAt, null);

  it("are not filed and name no participant", () => {
    const sort = sortPhotosV2([
      stray("blur.jpg", 1),
      ...run("P050", 2, PLANNED),
    ]);
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

  it("inside a participant's run, when it is short of photos: the participant goes to review (the stray may be theirs)", () => {
    const sort = sortPhotosV2([
      ...run("P051", 1, ["G02", "G02"]),
      stray("no-card.jpg", 3),
      ...run("P051", 4, ["G02", "G04"]),
    ]);
    expect(sort.participants[0]).toMatchObject({
      participant: "P051",
      status: "needs-review",
      reason: "unreadable-photo-in-run",
    });
    expect(
      sort.photos.filter((p) => p.participant === "P051").map((p) => p.status),
    ).toEqual(Array(4).fill("needs-review"));
  });

  it("but not when the participant has all their photos: the stray is an extra or a test shot", () => {
    const sort = sortPhotosV2([
      ...run("P052", 1, ["G02", "G02"]),
      stray("no-card.jpg", 3),
      ...run("P052", 4, ["G02", "G04", "G04"]),
    ]);
    expect(sort.participants[0]!.status).toBe("ok");
    expect(
      sort.photos.filter((p) => p.participant === "P052").map((p) => p.gesture),
    ).toEqual(["G02", "G02", "G02", "G04", "G04"]);
  });

  it("between two runs, flags the short one only", () => {
    const sort = sortPhotosV2([
      ...run("P053", 1, ["G02", "G02", "G02", "G04"]),
      stray("between.jpg", 5),
      ...run("P054", 6, PLANNED),
    ]);
    const status = (id: string) =>
      sort.participants.find((r) => r.participant === id)!.status;
    expect(status("P053")).toBe("needs-review");
    expect(status("P054")).toBe("ok");
  });

  it("before the first run or after the last, flags only the run it touches", () => {
    const before = sortPhotosV2([
      stray("first.jpg", 0),
      ...run("P055", 1, ["G02", "G02", "G02"]),
    ]);
    expect(before.participants[0]!.status).toBe("needs-review");
    const after = sortPhotosV2([
      ...run("P056", 1, PLANNED),
      stray("last.jpg", 9),
      ...run("P057", 10, PLANNED),
      stray("end.jpg", 99),
    ]);
    expect(after.participants.map((r) => r.status)).toEqual(["ok", "ok"]);
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

  it("an unreadable v1 photo inside a short run still sends the run to review", () => {
    const sort = sortPhotosV2([
      ...run("P062", 1, ["G02", "G02"]),
      photo("old.jpg", 3, card("P062", 1)),
      ...run("P062", 4, ["G02"]),
    ]);
    expect(sort.participants[0]!.status).toBe("needs-review");
  });
});

describe("placeByOrder", () => {
  const gestures = (p: ReturnType<typeof placeByOrder>) =>
    p.ok
      ? p.placements.map((x) => `${x.gesture}${x.shot}${x.extra ? "+" : ""}`)
      : p.reason;

  it("places the planned photos, and fewer, by position alone", () => {
    expect(gestures(placeByOrder([]))).toEqual([]);
    expect(gestures(placeByOrder([null]))).toEqual(["G021"]);
    expect(gestures(placeByOrder([null, null, null, null, null]))).toEqual([
      "G021",
      "G022",
      "G023",
      "G041",
      "G042",
    ]);
  });

  it("with an extra, takes the way that contradicts the fewest calls, and only if it is the only best", () => {
    const four = ["G02", "G02", "G02", "G02", "G04", "G04"] as const;
    expect(gestures(placeByOrder(four))).toEqual([
      "G021",
      "G022",
      "G023",
      "G024+",
      "G041",
      "G042",
    ]);
    // All six look like claws: the way with the fewest contradictions wins (3 against 4).
    expect(
      gestures(placeByOrder(["G04", "G04", "G04", "G04", "G04", "G04"])),
    ).toEqual(["G021", "G022", "G023", "G041", "G042", "G043+"]);
    // Nothing to go on.
    expect(gestures(placeByOrder(Array(6).fill(null)))).toBe(
      "extra-shot-placement-unclear",
    );
  });

  it("refuses more photos than the plan plus the allowed extra shots", () => {
    expect(gestures(placeByOrder(Array(7).fill("G02")))).toBe(
      "too-many-photos",
    );
    expect(
      gestures(placeByOrder(Array(6).fill("G02"), AGREED_V2_SEQUENCE, 0)),
    ).toBe("too-many-photos");
  });

  it("follows another plan, as when S0 forces G02 x2 and G04 x2 (a new prereg)", () => {
    const short = [
      { gesture: "G02", shots: 2 },
      { gesture: "G04", shots: 2 },
    ] as const;
    expect(gestures(placeByOrder([null, null, null, null], short))).toEqual([
      "G021",
      "G022",
      "G041",
      "G042",
    ]);
    expect(
      gestures(placeByOrder(["G02", "G02", "G02", "G04", "G04"], short)),
    ).toEqual(["G021", "G022", "G023+", "G041", "G042"]);
  });

  it("can spread two extra shots over the poses when it is allowed two", () => {
    expect(
      gestures(
        placeByOrder(
          ["G02", "G02", "G02", "G02", "G04", "G04", "G04"],
          AGREED_V2_SEQUENCE,
          2,
        ),
      ),
    ).toEqual(["G021", "G022", "G023", "G024+", "G041", "G042", "G043+"]);
  });
});
