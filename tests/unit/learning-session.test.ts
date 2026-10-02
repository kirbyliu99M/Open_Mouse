import { describe, expect, it } from "vitest";
import {
  AGREED_V2_SEQUENCE,
  emptyLabelsRecord,
  emptyParticipantRecord,
  isS0Participant,
  labelsRecordSchema,
  planShots,
  participantRecordSchema,
  sessionRecordSchema,
} from "@/lib/learning/session";

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

describe("kit v2 session contract", () => {
  it("follows the frozen prereg's shooting order: G02 x3, then G04 x2", () => {
    expect(AGREED_V2_SEQUENCE).toEqual([
      { gesture: "G02", shots: 3 },
      { gesture: "G04", shots: 2 },
    ]);
  });

  it("accepts a complete session record and rejects another protocol", () => {
    expect(sessionRecordSchema.parse(session)).toEqual(session);
    expect(() =>
      sessionRecordSchema.parse({ ...session, protocol: "candidate-v1" }),
    ).toThrow();
    expect(() =>
      sessionRecordSchema.parse({ ...session, sheet: "C" }),
    ).toThrow();
    expect(() => sessionRecordSchema.parse({ ...session, extra: 1 })).toThrow();
  });

  it("writes a participant template that parses and holds no answers yet", () => {
    const t = emptyParticipantRecord("P007", "S001");
    expect(participantRecordSchema.parse(t)).toEqual(t);
    expect([t.mouseHand, t.gripSelf, t.ageBand]).toEqual([null, null, null]);
  });

  it("rejects a malformed participant or session id and unknown fields", () => {
    const t = emptyParticipantRecord("P007", "S001");
    expect(() =>
      participantRecordSchema.parse({ ...t, participant: "P7" }),
    ).toThrow();
    expect(() =>
      participantRecordSchema.parse({ ...t, session: "1" }),
    ).toThrow();
    expect(() =>
      participantRecordSchema.parse({ ...t, name: "someone" }),
    ).toThrow();
    expect(() =>
      participantRecordSchema.parse({ ...t, gripSelf: "mixed" }),
    ).toThrow();
  });

  it("writes an unlabelled, blind labels template that parses", () => {
    const t = emptyLabelsRecord("S001", ["P901/G02/1.jpg", "P901/G04/1.jpg"]);
    expect(labelsRecordSchema.parse(t)).toEqual(t);
    expect(t.blind).toBe(true);
    expect(t.labels.map((l) => l.label)).toEqual([null, null]);
  });

  it("allows reasons only on a bad photo, and 'other' only with a note", () => {
    const base = emptyLabelsRecord("S001", ["a.jpg"]);
    const withLabel = (label: object) => ({ ...base, labels: [label] });
    expect(() =>
      labelsRecordSchema.parse(
        withLabel({ file: "a.jpg", label: "bad", reasons: ["blur"], note: "" }),
      ),
    ).not.toThrow();
    expect(() =>
      labelsRecordSchema.parse(
        withLabel({
          file: "a.jpg",
          label: "good",
          reasons: ["blur"],
          note: "",
        }),
      ),
    ).toThrow();
    expect(() =>
      labelsRecordSchema.parse(
        withLabel({
          file: "a.jpg",
          label: "bad",
          reasons: ["other"],
          note: " ",
        }),
      ),
    ).toThrow();
    expect(() =>
      labelsRecordSchema.parse(
        withLabel({
          file: "a.jpg",
          label: "bad",
          reasons: ["injury"],
          note: "",
        }),
      ),
    ).toThrow();
  });

  it("plans the poses only from the order or Kirby's counts, never by guessing", () => {
    expect(planShots(5, null)).toEqual(["G02", "G02", "G02", "G04", "G04"]);
    expect(planShots(6, null)).toBeNull();
    expect(planShots(4, null)).toBeNull();
    expect(planShots(6, { G02: 4, G04: 2 })).toEqual([
      "G02",
      "G02",
      "G02",
      "G02",
      "G04",
      "G04",
    ]);
    expect(planShots(4, { G02: 2, G04: 2 })).toEqual([
      "G02",
      "G02",
      "G04",
      "G04",
    ]);
    expect(planShots(5, { G02: 2, G04: 3 })).toEqual([
      "G02",
      "G02",
      "G04",
      "G04",
      "G04",
    ]);
    expect(planShots(6, { G02: 4, G04: 1 })).toBeNull();
    expect(planShots(7, { G02: 4, G04: 3 })).toBeNull();
  });

  it("accepts shotCounts in participant.json and rejects a malformed one", () => {
    const t = emptyParticipantRecord("P007", "S001");
    expect(t.shotCounts).toBeNull();
    expect(() =>
      participantRecordSchema.parse({ ...t, shotCounts: { G02: 4, G04: 2 } }),
    ).not.toThrow();
    expect(() =>
      participantRecordSchema.parse({ ...t, shotCounts: { G02: 4 } }),
    ).toThrow();
    expect(() =>
      participantRecordSchema.parse({ ...t, shotCounts: { G02: -1, G04: 2 } }),
    ).toThrow();
  });

  it("marks only P901-P912 as S0", () => {
    expect(isS0Participant("P900")).toBe(false);
    expect(isS0Participant("P901")).toBe(true);
    expect(isS0Participant("P912")).toBe(true);
    expect(isS0Participant("P913")).toBe(false);
    expect(isS0Participant("P001")).toBe(false);
    expect(isS0Participant("x901")).toBe(false);
  });
});
