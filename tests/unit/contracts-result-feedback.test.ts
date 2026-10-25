import { describe, expect, it } from "vitest";
import {
  RESULT_FEEDBACK_MAX_STARS,
  RESULT_FEEDBACK_MIN_STARS,
  RESULT_FEEDBACK_NOTICE_VERSION,
  RESULT_FEEDBACK_TOP_MICE,
  resultFeedbackSnapshotSchema,
  resultFeedbackStatusResponseSchema,
  resultFeedbackSubmissionSchema,
  resultFeedbackSubmitResponseSchema,
} from "../../src/lib/contracts/result-feedback";
import { resultFeedbackPath } from "../../src/lib/contracts/routes";
import { MAX_FEEDBACK_CHARS } from "../../src/lib/contracts/survey";

const accepts =
  (schema: { safeParse: (v: unknown) => { success: boolean } }) =>
  (v: unknown) =>
    schema.safeParse(v).success;
const submit = accepts(resultFeedbackSubmissionSchema);
const snapshot = accepts(resultFeedbackSnapshotSchema);

const body = {
  notice: RESULT_FEEDBACK_NOTICE_VERSION,
  stars: 4,
  locale: "zh-TW",
};
const shot = {
  engineVersion: "fit-v3",
  handSize: "medium",
  handWidth: "slim",
  grip: "claw",
  calibrationMethod: "paper-edge",
  palmThicknessStated: null,
  topMice: [
    { slug: "a", band: "very_good" },
    { slug: "b", band: "good" },
    { slug: "c", band: "fair" },
  ],
};

describe("pinned numbers (candidate, 未拍板)", () => {
  it("keeps 1 to 5 stars and three first places", () => {
    // Literal on purpose: a test built from the constant passes for any value.
    expect(RESULT_FEEDBACK_MIN_STARS).toBe(1);
    expect(RESULT_FEEDBACK_MAX_STARS).toBe(5);
    expect(RESULT_FEEDBACK_TOP_MICE).toBe(3);
  });
});

describe("resultFeedbackSubmissionSchema", () => {
  it("takes stars alone, or stars with a comment", () => {
    expect(submit(body)).toBe(true);
    expect(submit({ ...body, comment: "第一名太小了" })).toBe(true);
    expect(submit({ ...body, locale: "en", stars: 1 })).toBe(true);
  });

  it("refuses stars outside 1 to 5 and fractions", () => {
    for (const stars of [0, 6, 3.5, "4", null]) {
      expect(submit({ ...body, stars })).toBe(false);
    }
    expect(submit({ notice: body.notice, locale: body.locale })).toBe(false);
  });

  it("refuses an unknown notice version and an unknown locale", () => {
    expect(submit({ ...body, notice: "result-feedback-notice-v0" })).toBe(
      false,
    );
    expect(submit({ ...body, locale: "ja" })).toBe(false);
  });

  it("applies the survey's comment rules", () => {
    expect(submit({ ...body, comment: "x".repeat(MAX_FEEDBACK_CHARS) })).toBe(
      true,
    );
    expect(
      submit({ ...body, comment: "x".repeat(MAX_FEEDBACK_CHARS + 1) }),
    ).toBe(false);
    expect(submit({ ...body, comment: "   " })).toBe(false);
    expect(submit({ ...body, comment: "寫信給 me@example.com" })).toBe(false);
    expect(submit({ ...body, comment: "bad\u0000byte" })).toBe(false);
  });

  it("takes nothing the server reads from the scan", () => {
    // The scan is in the path and the snapshot is read on the server.
    expect(submit({ ...body, scanId: crypto.randomUUID() })).toBe(false);
    expect(submit({ ...body, engineVersion: "fit-v3" })).toBe(false);
    expect(submit({ ...body, handLengthMm: 185 })).toBe(false);
  });
});

describe("resultFeedbackSnapshotSchema", () => {
  it("takes a full snapshot and one with the nullable fields null", () => {
    expect(snapshot(shot)).toBe(true);
    expect(
      snapshot({ ...shot, handSize: null, handWidth: null, topMice: [] }),
    ).toBe(true);
  });

  it("takes a null band (length out of the catalogue's range) but no other value", () => {
    const out = shot.topMice.map((m) => ({ ...m, band: null }));
    expect(snapshot({ ...shot, topMice: out })).toBe(true);
    const bad = [{ slug: "a", band: "unknown" }];
    expect(snapshot({ ...shot, topMice: bad })).toBe(false);
    expect(snapshot({ ...shot, topMice: [{ slug: "a" }] })).toBe(false);
  });

  it("keeps at most three places and refuses a millimetre field", () => {
    const four = [...shot.topMice, { slug: "d", band: "poor" }];
    expect(snapshot({ ...shot, topMice: four })).toBe(false);
    expect(snapshot({ ...shot, handLengthMm: 185 })).toBe(false);
  });
});

describe("responses", () => {
  it("carry no comment", () => {
    expect(
      resultFeedbackSubmitResponseSchema.safeParse({
        stored: true,
        withdrawable: false,
        comment: "x",
      }).success,
    ).toBe(false);
    expect(
      resultFeedbackStatusResponseSchema.safeParse({ answered: true }).success,
    ).toBe(true);
  });
});

describe("resultFeedbackPath", () => {
  it("is scan-scoped and encodes the id", () => {
    expect(resultFeedbackPath("abc")).toBe("/api/scans/abc/feedback");
    expect(resultFeedbackPath("a/b")).toBe("/api/scans/a%2Fb/feedback");
  });
});
