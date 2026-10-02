import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGREED_V2_MAX_EXTRA_SHOTS,
  AGREED_V2_SEQUENCE,
  S0_PARTICIPANTS,
  emptyLabelsRecord,
  emptyParticipantRecord,
  isS0Participant,
  labelsRecordSchema,
  looksLikeContactDetails,
  participantRecordSchema,
  planShots,
  sessionRecordSchema,
} from "@/lib/learning/session";

const PROPOSAL = join(
  process.cwd(),
  "docs/design/learning-kit-v2-proposal-2026-10-02",
);
const PREREG_V1 = join(PROPOSAL, "prereg-2026-10-02.frozen.txt");
const PREREG_V2 = join(PROPOSAL, "prereg-2026-10-02-v2.frozen.txt");

const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

const session = {
  format: "open-mouse-learning-session/1",
  session: "S001",
  protocol: "agreed-v2",
  date: "2026-10-05",
  timeBlock: "afternoon",
  venue: "club room",
  light: "ceiling LED, diffuse",
  phone: "Phone A, main 1x",
  holding: "handheld",
  sheet: "A",
  paperSize: "a4",
  printCheckMm: 100,
  note: "",
};

const withLabel = (label: object) => ({
  ...emptyLabelsRecord("S001", ["P901/G02/1.jpg"]),
  labels: [label],
});
const bad = (reasons: string[], note = "") => ({
  file: "P901/G02/1.jpg",
  label: "bad",
  reasons,
  note,
});

describe("the frozen preregistrations", () => {
  it("are byte-for-byte the files Kirby approved", () => {
    expect(sha256(PREREG_V1)).toBe(
      "9e512612de4c8aeb2ef6faaeabec8079e629c4f0216c66b777e64a75deb3ce75",
    );
    expect(sha256(PREREG_V2)).toBe(
      "51cebf6df10bbd2f9a9f5be062f549965c9989ee063e3c6793e475ba1d87d0d5",
    );
  });

  it("state the same shooting order, S0 range and sheet as the contract", () => {
    const v2 = readFileSync(PREREG_V2, "utf8");
    expect(AGREED_V2_SEQUENCE).toEqual([
      { gesture: "G02", shots: 3 },
      { gesture: "G04", shots: 2 },
    ]);
    expect(v2).toContain("G02 平放張開 ×3，G04 爪握 ×2");
    expect(S0_PARTICIPANTS).toEqual({ first: 901, last: 912 });
    expect(v2).toContain("P901–P912");
    expect(v2).toContain("只用 A 版");
    expect(AGREED_V2_MAX_EXTRA_SHOTS).toBe(1);
    expect(v2).toContain("多拍 1 張");
  });
});

describe("session.json", () => {
  it("accepts a complete sheet-A, A4 session record", () => {
    expect(sessionRecordSchema.parse(session)).toEqual(session);
    expect(() =>
      sessionRecordSchema.parse({ ...session, printCheckMm: null }),
    ).not.toThrow();
  });

  it.each([
    ["another protocol", { protocol: "candidate-v1" }],
    ["sheet B (built, not used)", { sheet: "B" }],
    ["sheet C", { sheet: "C" }],
    ["Letter paper", { paperSize: "letter" }],
    ["a date that does not exist", { date: "2026-13-45" }],
    ["February 30", { date: "2026-02-30" }],
    ["a malformed date", { date: "5 Oct 2026" }],
    ["an unknown time block", { timeBlock: "night" }],
    ["a zero print check", { printCheckMm: 0 }],
    ["a negative print check", { printCheckMm: -100 }],
    ["a malformed session id", { session: "1" }],
    ["contact details in a note", { note: "call 0912-345-678" }],
    ["an email in the venue", { venue: "host a@b.co" }],
    ["an unknown field", { extra: 1 }],
  ])("rejects %s", (_, change) => {
    expect(() =>
      sessionRecordSchema.parse({ ...session, ...change }),
    ).toThrow();
  });
});

describe("participant.json", () => {
  const t = emptyParticipantRecord("P007", "S001");

  it("writes a template that parses and holds no answers yet", () => {
    expect(participantRecordSchema.parse(t)).toEqual(t);
    expect([t.mouseHand, t.gripSelf, t.ageBand, t.shotCounts]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("accepts every allowed answer", () => {
    expect(() =>
      participantRecordSchema.parse({
        ...t,
        mouseHand: "left",
        gripSelf: "unsure",
        ageBand: "60-plus",
        shotCounts: { G02: 4, G04: 2 },
      }),
    ).not.toThrow();
  });

  it.each([
    ["a malformed participant id", { participant: "P7" }],
    ["a malformed session id", { session: "1" }],
    ["a name field", { name: "someone" }],
    ["a contact field", { email: "a@b.co" }],
    ["an unknown grip", { gripSelf: "mixed" }],
    ["an unknown hand", { mouseHand: "both" }],
    ["an unknown age band", { ageBand: "25" }],
    ["shotCounts missing a pose", { shotCounts: { G02: 4 } }],
    ["shotCounts with another key", { shotCounts: { G02: 3, G04: 2, G01: 1 } }],
    ["a negative shot count", { shotCounts: { G02: -1, G04: 2 } }],
    ["a fractional shot count", { shotCounts: { G02: 2.5, G04: 2 } }],
    ["a phone number in the note", { note: "+886 912 345 678" }],
    ["an email in the note", { note: "x.y@example.com" }],
  ])("rejects %s", (_, change) => {
    expect(() => participantRecordSchema.parse({ ...t, ...change })).toThrow();
  });
});

describe("free text", () => {
  it("flags emails and phone-like digit runs, not ordinary notes", () => {
    expect(looksLikeContactDetails("a@b.co")).toBe(true);
    expect(looksLikeContactDetails("0912345678")).toBe(true);
    expect(looksLikeContactDetails("(02) 2345-6789")).toBe(true);
    expect(looksLikeContactDetails("3 G02 then 2 G04")).toBe(false);
    expect(looksLikeContactDetails("Phone A, main 1x")).toBe(false);
    expect(looksLikeContactDetails("afternoon, by the window")).toBe(false);
    expect(looksLikeContactDetails("")).toBe(false);
  });
});

describe("planShots", () => {
  it("follows the planned order when there are exactly 3 + 2 photos", () => {
    expect(planShots(5, null)).toEqual(["G02", "G02", "G02", "G04", "G04"]);
  });

  it("never guesses: any other count without Kirby's numbers goes to review", () => {
    for (const n of [0, 1, 4, 6, 7]) expect(planShots(n, null)).toBeNull();
  });

  it("uses Kirby's counts for an extra or a missing shot", () => {
    expect(planShots(6, { G02: 4, G04: 2 })).toEqual([
      "G02",
      "G02",
      "G02",
      "G02",
      "G04",
      "G04",
    ]);
    expect(planShots(6, { G02: 3, G04: 3 })).toEqual([
      "G02",
      "G02",
      "G02",
      "G04",
      "G04",
      "G04",
    ]);
    expect(planShots(4, { G02: 2, G04: 2 })).toEqual([
      "G02",
      "G02",
      "G04",
      "G04",
    ]);
  });

  it.each([
    ["counts that do not add up to the photos", 6, { G02: 4, G04: 1 }],
    ["more than one extra in total", 7, { G02: 4, G04: 3 }],
    ["a lopsided count", 6, { G02: 0, G04: 6 }],
    ["one pose two over its plan", 6, { G02: 2, G04: 4 }],
    ["a negative count", 4, { G02: -1, G04: 5 }],
    ["a fractional count", 5, { G02: 2.5, G04: 2.5 }],
  ])("refuses %s", (_, n, counts) => {
    expect(planShots(n, counts)).toBeNull();
  });

  it("refuses a nonsensical photo count", () => {
    expect(planShots(-1, null)).toBeNull();
    expect(planShots(5.5, null)).toBeNull();
  });
});

describe("labels.json", () => {
  it("writes an unlabelled, blind template that parses", () => {
    const t = emptyLabelsRecord("S001", ["P901/G02/1.jpg", "P901/G04/1.jpg"]);
    expect(labelsRecordSchema.parse(t)).toEqual(t);
    expect(t.blind).toBe(true);
    expect(t.labels.map((l) => l.label)).toEqual([null, null]);
  });

  it("accepts a good photo, a bad one with reasons, and 'other' with a note", () => {
    expect(() =>
      labelsRecordSchema.parse(
        withLabel({
          file: "P901/G02/1.jpg",
          label: "good",
          reasons: [],
          note: "",
        }),
      ),
    ).not.toThrow();
    expect(() =>
      labelsRecordSchema.parse(withLabel(bad(["blur", "lighting"]))),
    ).not.toThrow();
    expect(() =>
      labelsRecordSchema.parse(
        withLabel(bad(["other"], "sleeve over the wrist line")),
      ),
    ).not.toThrow();
  });

  it("keeps a non-blind file parseable, so it can be reported apart", () => {
    const t = {
      ...emptyLabelsRecord("S001", ["P901/G02/1.jpg"]),
      blind: false,
    };
    expect(labelsRecordSchema.parse(t).blind).toBe(false);
  });

  it.each([
    [
      "reasons on a good photo",
      { file: "P901/G02/1.jpg", label: "good", reasons: ["blur"], note: "" },
    ],
    [
      "reasons on an unlabelled photo",
      { file: "P901/G02/1.jpg", label: null, reasons: ["blur"], note: "" },
    ],
    ["a bad photo with no reason", bad([])],
    ["'other' with a blank note", bad(["other"], " ")],
    ["a reason about the person", bad(["injury"])],
    ["the same reason twice", bad(["blur", "blur"])],
    [
      "a phone number in a note",
      {
        file: "P901/G02/1.jpg",
        label: "good",
        reasons: [],
        note: "0912345678",
      },
    ],
    [
      "an unknown field",
      { file: "P901/G02/1.jpg", label: "good", reasons: [], note: "", x: 1 },
    ],
  ])("rejects %s", (_, label) => {
    expect(() => labelsRecordSchema.parse(withLabel(label))).toThrow();
  });

  it.each([
    ["an absolute path", "/P901/G02/1.jpg"],
    ["a parent segment", "../P901/G02/1.jpg"],
    ["a backslash path", "P901\\G02\\1.jpg"],
    ["a drive path", "C:/x/1.jpg"],
    ["an empty segment", "P901//1.jpg"],
  ])("rejects %s as a photo name", (_, file) => {
    expect(() =>
      labelsRecordSchema.parse(
        withLabel({ file, label: null, reasons: [], note: "" }),
      ),
    ).toThrow();
  });

  it("rejects a photo labelled twice", () => {
    const t = emptyLabelsRecord("S001", ["P901/G02/1.jpg", "P901/G02/1.jpg"]);
    expect(() => labelsRecordSchema.parse(t)).toThrow();
  });

  it("rejects an unknown top-level field", () => {
    const t = { ...emptyLabelsRecord("S001", ["P901/G02/1.jpg"]), extra: 1 };
    expect(() => labelsRecordSchema.parse(t)).toThrow();
  });
});

describe("S0 ids", () => {
  it("marks only P901-P912", () => {
    expect(isS0Participant("P900")).toBe(false);
    expect(isS0Participant("P901")).toBe(true);
    expect(isS0Participant("P912")).toBe(true);
    expect(isS0Participant("P913")).toBe(false);
    expect(isS0Participant("P001")).toBe(false);
    expect(isS0Participant("x901")).toBe(false);
    expect(isS0Participant("P0901")).toBe(false);
  });
});
