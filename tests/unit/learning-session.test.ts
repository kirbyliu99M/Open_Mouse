import { describe, expect, it } from "vitest";
import {
  AGREED_V2_SEQUENCE,
  emptyParticipantRecord,
  isS0Participant,
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

  it("marks only P901-P912 as S0", () => {
    expect(isS0Participant("P900")).toBe(false);
    expect(isS0Participant("P901")).toBe(true);
    expect(isS0Participant("P912")).toBe(true);
    expect(isS0Participant("P913")).toBe(false);
    expect(isS0Participant("P001")).toBe(false);
    expect(isS0Participant("x901")).toBe(false);
  });
});
