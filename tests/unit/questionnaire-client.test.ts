import { describe, expect, it, vi } from "vitest";
import {
  editBodyFrom,
  emptyForm,
  buildSubmission,
  emptyRatingDraft,
} from "../../src/app/account/questionnaire-model";
import {
  failureFromStatus,
  postSurvey,
  putSurvey,
} from "../../src/app/account/survey-client";
import { SURVEY_PATH } from "../../src/lib/contracts/routes";
import {
  surveyEditSchema,
  surveyMineResponseSchema,
  surveySubmissionSchema,
} from "../../src/lib/contracts/survey";

const SCAN = "6f1c1b6e-8d0e-4a0f-9d63-0b1a2c3d4e5f";

function submission(feedback = "") {
  const body = buildSubmission(
    {
      ...emptyForm(),
      consent: true,
      feedback,
      current: {
        kind: "rating",
        draft: { ...emptyRatingDraft("a"), satisfaction: 4 },
      },
    },
    SCAN,
  );
  if (body === null) throw new Error("fixture");
  return body;
}

const edit = () =>
  editBodyFrom(
    surveyMineResponseSchema.parse({
      mainUse: null,
      feedback: null,
      ratings: [{ slug: "a", satisfaction: 3, painPoints: [], current: false }],
      otherMice: [],
    }),
  );

describe("failureFromStatus: the statuses the route documents", () => {
  it("maps each to what the page should say", () => {
    expect(failureFromStatus(409)).toBe("conflict");
    expect(failureFromStatus(404)).toBe("not_found");
    expect(failureFromStatus(429)).toBe("rate_limited");
    expect(failureFromStatus(401)).toBe("unauthorized");
    expect(failureFromStatus(400)).toBe("invalid");
    expect(failureFromStatus(413)).toBe("invalid");
    expect(failureFromStatus(500)).toBe("network");
    expect(failureFromStatus(502)).toBe("network");
  });
});

describe("postSurvey", () => {
  it("posts the body as JSON to the survey path, same origin, not cached", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 201 }));
    const body = submission("手感很好");
    const result = await postSurvey(body, fetchImpl);
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      {
        method: string;
        headers: Record<string, string>;
        body: string;
        credentials: string;
        cache: string;
      },
    ];
    expect(url).toBe(SURVEY_PATH);
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    expect(surveySubmissionSchema.parse(JSON.parse(init.body))).toEqual(body);
  });

  it("turns each failing status into a reason, and never throws", async () => {
    for (const [status, reason] of [
      [409, "conflict"],
      [404, "not_found"],
      [429, "rate_limited"],
      [400, "invalid"],
      [413, "invalid"],
      [500, "network"],
    ] as const) {
      const result = await postSurvey(submission(), async () => ({
        ok: false,
        status,
      }));
      expect(result).toEqual({ ok: false, reason });
    }
    const down = await postSurvey(submission(), async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(down).toEqual({ ok: false, reason: "network" });
  });

  it("refuses a comment with an email or a phone number before it leaves the browser", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 201 }));
    for (const text of ["寫信給我 me@example.com", "打給我 0912 345 678"]) {
      const result = await postSurvey(submission(text), fetchImpl);
      expect(result).toEqual({ ok: false, reason: "invalid_feedback" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("putSurvey", () => {
  it("puts the whole set as JSON", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const body = edit();
    expect(await putSurvey(body, fetchImpl)).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { method: string; body: string },
    ];
    expect(url).toBe(SURVEY_PATH);
    expect(init.method).toBe("PUT");
    expect(surveyEditSchema.parse(JSON.parse(init.body)).ratings).toHaveLength(
      1,
    );
  });

  it("maps 401, 404, 429 and 400, and does not send a set the contract refuses", async () => {
    for (const [status, reason] of [
      [401, "unauthorized"],
      [404, "not_found"],
      [429, "rate_limited"],
      [400, "invalid"],
    ] as const) {
      expect(
        await putSurvey(edit(), async () => ({ ok: false, status })),
      ).toEqual({ ok: false, reason });
    }
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    // No mouse left: that is DELETE, not an edit.
    const empty = { ...edit(), ratings: [] };
    expect(await putSurvey(empty, fetchImpl)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
