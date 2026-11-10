/**
 * The tester page's pure parts (candidate; contract src/lib/contracts/tester.ts):
 * the contract's refinements, the tape form, the record builder, the phone
 * model filter, and the Taipei day arithmetic the purge counts with.
 */
import { describe, expect, it, vi } from "vitest";
import {
  TESTER_CODE_ALPHABET,
  TESTER_PAGE_PATH,
  participantOf,
  testerAnonIdSchema,
  testerCodeSchema,
  testerParticipantSchema,
  testerRecordSchema,
} from "../../src/lib/contracts/tester";
import { newAnonId } from "../../src/client/tester/send";
import {
  buildTesterRecord,
  giveUpCaptureMode,
  handMatches,
  referenceMatches,
} from "../../src/client/tester/record";
import { testerCopy } from "../../src/lib/tester/copy";
import { buildTourSteps } from "../../src/client/camera/tour/tourModel";
import {
  ANALYTICS_MUTED_PATHS,
  analyticsMutedPath,
} from "../../src/client/analytics/mutedPaths";
import {
  EMPTY_TAPE,
  buildTape,
  formatDiffMm,
  needsRecheck,
  parseTapeMm,
  tapeAverage,
  type TapeDraft,
} from "../../src/client/tester/tape";
import { phoneModelAllowed } from "../../src/lib/tester/phoneModel";
import { addDays, taipeiDay } from "../../src/server/tester/day";
import { testerPhotoCutoffDay } from "../../src/server/tester/purge";
import { RECORD } from "./fixtures/tester-record";

describe("tester contract", () => {
  it("accepts the reference record", () => {
    expect(testerRecordSchema.safeParse(RECORD).success).toBe(true);
  });

  it("measured is present exactly when the tester did not give up", () => {
    expect(
      testerRecordSchema.safeParse({ ...RECORD, gaveUp: true }).success,
    ).toBe(false);
    const { measured: _m, photo: _p, ...noMeasure } = RECORD;
    void _m;
    void _p;
    expect(testerRecordSchema.safeParse(noMeasure).success).toBe(false);
    expect(
      testerRecordSchema.safeParse({ ...noMeasure, gaveUp: true }).success,
    ).toBe(true);
  });

  it("cardType is required for a card and only for a card", () => {
    expect(
      testerRecordSchema.safeParse({ ...RECORD, reference: "card" }).success,
    ).toBe(false);
    expect(
      testerRecordSchema.safeParse({
        ...RECORD,
        reference: "card",
        cardType: "transit",
      }).success,
    ).toBe(true);
    expect(
      testerRecordSchema.safeParse({ ...RECORD, cardType: "transit" }).success,
    ).toBe(false);
  });

  it("firstTryOk means one attempt that measured", () => {
    expect(
      testerRecordSchema.safeParse({ ...RECORD, attempts: 1, firstTryOk: true })
        .success,
    ).toBe(true);
    expect(
      testerRecordSchema.safeParse({
        ...RECORD,
        attempts: 1,
        firstTryOk: false,
      }).success,
    ).toBe(false);
    expect(
      testerRecordSchema.safeParse({ ...RECORD, attempts: 2, firstTryOk: true })
        .success,
    ).toBe(false);
  });

  it("tape values keep at most one decimal and stay within 50 to 300 mm", () => {
    const withLength = (first: number) => ({
      ...RECORD,
      tape: { ...RECORD.tape, handLength: { a: { first, second: 189 } } },
    });
    expect(testerRecordSchema.safeParse(withLength(188.55)).success).toBe(
      false,
    );
    expect(testerRecordSchema.safeParse(withLength(49.9)).success).toBe(false);
    expect(testerRecordSchema.safeParse(withLength(300)).success).toBe(true);
  });

  it("codes: P + 2–3 digits + 6 characters of the alphabet; the participant is the prefix", () => {
    expect(testerCodeSchema.safeParse(" p07-k7q2m9 ").data).toBe("P07-K7Q2M9");
    for (const bad of ["P7-K7Q2M9", "P07-K7Q2M0", "P07-K7Q2MI", "P1234-ABCDEF"])
      expect(testerCodeSchema.safeParse(bad).success).toBe(false);
    expect(participantOf("P123-ABCDEF")).toBe("P123");
    expect(TESTER_CODE_ALPHABET).not.toMatch(/[01IO]/);
  });
});

describe("zero attempts", () => {
  it("is only a give-up", () => {
    const { measured: _m, photo: _p, ...rest } = RECORD;
    void _m;
    void _p;
    const zero = { ...rest, attempts: 0, failureCodes: [], firstTryOk: false };
    expect(
      testerRecordSchema.safeParse({ ...zero, gaveUp: true }).success,
    ).toBe(true);
    expect(
      testerRecordSchema.safeParse({ ...RECORD, attempts: 0 }).success,
    ).toBe(false);
  });
});

describe("referenceMatches", () => {
  const paper = (paperSize: "a4" | "letter") => ({
    method: "paper-edge" as const,
    paperSize,
    edgeFitResidualMm: 0.6,
    minSideCoverage: 0.92,
    parallaxCorrected: false as const,
  });
  const card = { method: "card-edge" } as unknown as Parameters<
    typeof referenceMatches
  >[1];

  it("accepts the declared paper size on paper, and the card on the card", () => {
    expect(referenceMatches("a4", paper("a4"), "paper")).toBe(true);
    expect(referenceMatches("letter", paper("letter"), null)).toBe(true);
    expect(referenceMatches("card", card, "card")).toBe(true);
  });

  it("refuses another paper size, paper for a card, or a card photo for paper", () => {
    expect(referenceMatches("a4", paper("letter"), "paper")).toBe(false);
    expect(referenceMatches("card", paper("a4"), "paper")).toBe(false);
    expect(referenceMatches("a4", card, "card")).toBe(false);
    expect(referenceMatches("a4", paper("a4"), "card")).toBe(false);
  });
});

describe("tape form", () => {
  it("parses a typed value: blank, one decimal, comma decimal, out of range", () => {
    expect(parseTapeMm("")).toBeNull();
    expect(parseTapeMm(" 188.5 ")).toBe(188.5);
    expect(parseTapeMm("84,5")).toBe(84.5);
    expect(parseTapeMm("188.55")).toBe("invalid");
    expect(parseTapeMm("49")).toBe("invalid");
    expect(parseTapeMm("301")).toBe("invalid");
    expect(parseTapeMm("abc")).toBe("invalid");
  });

  const filled: TapeDraft = {
    hand: "left",
    handLength: {
      a: { first: "188", second: "189" },
      b: { first: "", second: "" },
    },
    palmWidth: {
      a: { first: "84", second: "85" },
      b: { first: "85", second: "86" },
    },
    palmWidthEdge: "",
  };

  it("builds the contract's tape, B only where typed", () => {
    const built = buildTape(filled);
    expect(built).toEqual({
      ok: true,
      tape: {
        hand: "left",
        handLength: { a: { first: 188, second: 189 } },
        palmWidth: {
          a: { first: 84, second: 85 },
          b: { first: 85, second: 86 },
        },
      },
    });
  });

  it("reports what is missing or wrong", () => {
    const built = buildTape(EMPTY_TAPE);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.errors.hand).toBe("handRequired");
    expect(built.errors["handLength.a.first"]).toBe("required");
    const half = buildTape({
      ...filled,
      palmWidth: { ...filled.palmWidth, b: { first: "85", second: "" } },
    });
    expect(half.ok ? null : half.errors["palmWidth.b.second"]).toBe(
      "pairIncomplete",
    );
  });

  it("asks for a re-measure past 3 mm apart, never at exactly 3", () => {
    expect(needsRecheck({ first: "188", second: "191" })).toBe(false);
    expect(needsRecheck({ first: "188", second: "191.1" })).toBe(true);
    expect(needsRecheck({ first: "188", second: "" })).toBe(false);
  });

  it("averages every reading and prints a signed difference", () => {
    expect(
      tapeAverage({
        a: { first: 84, second: 85 },
        b: { first: 85, second: 86 },
      }),
    ).toBe(85);
    expect(formatDiffMm(190.24, 188.5)).toBe("+1.7");
    expect(formatDiffMm(188.5, 190)).toBe("−1.5");
    expect(formatDiffMm(188.52, 188.5)).toBe("0.0");
  });
});

describe("buildTesterRecord", () => {
  const tape = RECORD.tape;
  const conditions = {
    phoneModel: "  Pixel 8 ",
    surface: "wood",
    lighting: "dim",
    reference: "a4",
    deliberatelyPoor: true,
  } as const;
  const measured = {
    handLengthMm: 190.2,
    palmWidthMm: 83.7,
    measurementModelVersion: "landmark-raw-v3",
    calibrationMethod: "paper-edge",
  };

  it("one measured attempt is a first-try success", () => {
    const r = buildTesterRecord({
      shotId: RECORD.shotId,
      tape,
      conditions,
      attempts: [{ measured: true, captureMode: "camera", failureCodes: [] }],
      captureMode: "camera",
      measured,
      photo: { widthPx: 640, heightPx: 480 },
    });
    expect(r.firstTryOk).toBe(true);
    expect(r.attempts).toBe(1);
    expect(r.phoneModel).toBe("Pixel 8");
    expect(r.photo).toEqual({ widthPx: 640, heightPx: 480 });
  });

  it("collects every failure code in order and counts the attempts", () => {
    const r = buildTesterRecord({
      shotId: RECORD.shotId,
      tape,
      conditions: { ...conditions, reference: "card", cardType: "transit" },
      attempts: [
        { measured: false, captureMode: "upload", failureCodes: ["NO_HAND"] },
        {
          measured: false,
          captureMode: "upload",
          failureCodes: ["PAPER_NOT_FOUND", "LOW_LIGHT"],
        },
        { measured: true, captureMode: "camera", failureCodes: [] },
      ],
      captureMode: "upload",
      measured,
    });
    expect(r.attempts).toBe(3);
    expect(r.firstTryOk).toBe(false);
    expect(r.failureCodes).toEqual(["NO_HAND", "PAPER_NOT_FOUND", "LOW_LIGHT"]);
    expect(r.cardType).toBe("transit");
  });

  it("giving up sends no measurement and no photo; with no analysis at all, zero attempts", () => {
    const r = buildTesterRecord({
      shotId: RECORD.shotId,
      tape,
      conditions: { ...conditions, cardType: "transit" },
      attempts: [],
      captureMode: "camera",
      photo: { widthPx: 640, heightPx: 480 },
    });
    expect(r.gaveUp).toBe(true);
    expect(r.measured).toBeUndefined();
    expect(r.photo).toBeUndefined();
    expect(r.cardType).toBeUndefined();
    expect(r.attempts).toBe(0);
    expect(r.firstTryOk).toBe(false);
    expect(r.failureCodes).toEqual([]);
  });
});

describe("phone model filter", () => {
  it("keeps model names and refuses contact details and links", () => {
    for (const ok of [
      "Pixel 8",
      "iPhone 15 Pro Max",
      "SM-S9280",
      "Redmi Note 13 5G",
    ])
      expect(phoneModelAllowed(ok), ok).toBe(true);
    for (const bad of [
      "",
      "   ",
      "0912-345-678",
      "a@b.co",
      "www.example.com",
      "x".repeat(41),
    ])
      expect(phoneModelAllowed(bad), bad).toBe(false);
  });
});

describe("Taipei day", () => {
  it("is the calendar date in UTC+8", () => {
    expect(taipeiDay(new Date("2026-11-09T15:59:59Z"))).toBe("2026-11-09");
    expect(taipeiDay(new Date("2026-11-09T16:00:00Z"))).toBe("2026-11-10");
  });

  it("adds and subtracts calendar days across months and years", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(() => addDays("2026-1-1", 1)).toThrow(RangeError);
  });

  it("a photo from day D is kept through D + 180 and purged from D + 181", () => {
    const cutoff = testerPhotoCutoffDay(new Date("2027-05-08T04:00:00Z"), 180);
    expect(cutoff).toBe("2026-11-09");
    // Rows with day < cutoff go: 2026-11-08 yes, 2026-11-09 not yet.
    expect("2026-11-08" < cutoff).toBe(true);
    expect("2026-11-09" < cutoff).toBe(false);
    expect(() => testerPhotoCutoffDay(new Date(), 0)).toThrow(RangeError);
  });
});

describe("muted analytics on the tester page", () => {
  it("muteTracking stops every event until it is undone, and nests", async () => {
    const { createTrack, muteTracking, trackingMuted } =
      await import("../../src/client/analytics/track");
    const send = vi.fn();
    const track = createTrack({ enabled: () => true, send });
    const props = { flow: "easy", device: "phone" } as const;
    track("scan_entry_shown", props);
    expect(send).toHaveBeenCalledTimes(1);
    const undoA = muteTracking();
    const undoB = muteTracking();
    track("scan_entry_shown", props);
    undoA();
    undoA(); // a second call does nothing
    expect(trackingMuted()).toBe(true);
    track("scan_entry_shown", props);
    undoB();
    expect(trackingMuted()).toBe(false);
    track("scan_entry_shown", props);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("hand and capture mode", () => {
  it("a scan of the other hand does not match the tape", () => {
    expect(handMatches("right", "right")).toBe(true);
    expect(handMatches("right", "left")).toBe(false);
  });

  it("a give-up records the last analysed photo's capture mode, the camera when none", () => {
    expect(giveUpCaptureMode([])).toBe("camera");
    expect(
      giveUpCaptureMode([
        { measured: false, captureMode: "camera", failureCodes: [] },
        { measured: false, captureMode: "upload", failureCodes: [] },
      ]),
    ).toBe("upload");
  });
});

describe("the scan tour on the tester page", () => {
  it("leaves the reference step out when the reference is locked, and only then", () => {
    const ids = (locked?: boolean) =>
      buildTourSteps({
        reference: "a4",
        cardModeAvailable: true,
        ...(locked ? { referenceLocked: true } : {}),
      }).map((s) => s.id);
    expect(ids()).toEqual(["reference", "placement", "cue", "shutter"]);
    expect(ids(true)).toEqual(["placement", "cue", "shutter"]);
  });
});

describe("no page view on the tester page", () => {
  it("names exactly the contract's tester path", () => {
    expect(ANALYTICS_MUTED_PATHS).toEqual([TESTER_PAGE_PATH]);
  });

  it("mutes it in both locales and below it, nothing else", () => {
    for (const p of ["/scan/tester", "/en/scan/tester", "/scan/tester/demo"])
      expect(analyticsMutedPath(p), p).toBe(true);
    for (const p of [
      null,
      "/",
      "/scan/easy",
      "/scan/testers",
      "/en",
      "/en/scan",
    ])
      expect(analyticsMutedPath(p), String(p)).toBe(false);
  });
});

describe("the consent copy (candidate)", () => {
  it("one agreement: the photo point says taking part includes the photo and each can be unticked", () => {
    const photoPoint = testerCopy.consent.points.filter((p) =>
      p.includes("照片"),
    );
    expect(
      photoPoint.some(
        (p) =>
          p.includes("每一張都附上處理過的照片") &&
          p.includes("開始掃描前都可以取消勾選"),
      ),
    ).toBe(true);
    // No separate consent-step photo box any more.
    expect(Object.keys(testerCopy.consent)).not.toContain("photo");
    expect(Object.keys(testerCopy.consent)).not.toContain("photoHint");
    expect(testerCopy.consent.agree).toBe(
      "我已年滿 18 歲，看過並同意以上說明，包括每一張附上處理過的照片",
    );
  });

  it("open mode: the anonymous id is shown with how to keep it, and the age rule is a point", () => {
    const line = testerCopy.code.anonParticipant("WK7Q2M9XA");
    expect(line).toContain("WK7Q2M9XA");
    expect(line).toContain("要求刪除資料時需要用到");
    expect(testerCopy.consent.points.join("")).toContain("年滿 18 歲");
    expect(testerCopy.consent.points.join("")).not.toContain("P07");
  });
});

describe("open mode's anonymous id", () => {
  it("is W + 8 chars of the code alphabet, and different each time", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = newAnonId();
      expect(testerAnonIdSchema.safeParse(id).success).toBe(true);
      expect(testerParticipantSchema.safeParse(id).success).toBe(true);
      expect(participantOf(id)).toBe(id);
      ids.add(id);
    }
    expect(ids.size).toBe(200);
  });
});
