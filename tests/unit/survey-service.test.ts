/**
 * `POST` and `DELETE /api/survey` (src/server/survey/service.ts), end to end
 * through the handler with injected deps, against the in-memory fakes and
 * against the real repos on PGlite (the ownership rule and the write are the
 * real SQL there). Covers every status the contract lists, the order the
 * checks run in, and the privacy rules: the hand profile comes from the scan,
 * no response echoes an answer, no log line carries one.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

import { errorResponseSchema } from "../../src/lib/contracts/routes";
import {
  SURVEY_CONSENT_VERSION,
  surveySubmitResponseSchema,
} from "../../src/lib/contracts/survey";
import {
  MAX_SURVEY_BODY_BYTES,
  handleSurveySubmission,
  handleSurveyWithdrawal,
  type SurveyDeps,
} from "../../src/server/survey/service";
import {
  NOW,
  createFakeSurveyWorld,
  createPgliteSurveyWorld,
  type SurveyWorld,
  type WorldScan,
} from "./fixtures/survey-world";
import {
  USE_B,
  FEEL_SMALL,
  FEEL_RIGHT,
  FEEL_LARGE,
  DURATION_B,
  BRAND_A,
  BRAND_PRIVATE,
} from "./fixtures/survey-values";

const IP = "203.0.113.7";
const BRAND = BRAND_PRIVATE;
const COMMENT = "The side buttons rattle on my desk.";

const worlds: [string, () => Promise<SurveyWorld>][] = [
  ["in-memory fakes", async () => createFakeSurveyWorld()],
  ["real repos on PGlite", createPgliteSurveyWorld],
];

describe.each(worlds)("/api/survey on %s", (_name, make) => {
  let world: SurveyWorld;
  let signedInAs: string | null;
  let limiter: { allow: Mock<(key: string) => Promise<boolean>> };

  beforeAll(async () => {
    world = await make();
  });
  afterAll(() => world.close());
  beforeEach(async () => {
    await world.reset();
    await world.addUser("user-1");
    await world.addUser("user-2");
    await world.addMouse("mouse-a");
    await world.addMouse("mouse-b");
    signedInAs = null;
    limiter = {
      allow: vi.fn<(key: string) => Promise<boolean>>(async () => true),
    };
  });

  const deps = (over: Partial<SurveyDeps> = {}): SurveyDeps => ({
    scanRepo: world.scanRepo,
    surveyRepo: world.surveyRepo,
    limiter,
    getUserId: async () => signedInAs,
    now: () => NOW,
    ...over,
  });

  const validBody = (scan: WorldScan, over: Record<string, unknown> = {}) => ({
    scanId: scan.scanId,
    consent: { accepted: true, version: SURVEY_CONSENT_VERSION },
    ratings: [{ slug: "mouse-a", satisfaction: 4 }],
    ...over,
  });

  interface CallOptions {
    cookie?: string | null;
    ip?: string | null;
    headers?: Record<string, string>;
    deps?: Partial<SurveyDeps>;
  }

  const request = (
    method: "POST" | "DELETE",
    body: BodyInit | null,
    options: CallOptions = {},
  ) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...options.headers,
    };
    if (options.ip !== null) headers["x-forwarded-for"] = options.ip ?? IP;
    if (options.cookie) headers.cookie = `scan_session=${options.cookie}`;
    return new Request("http://localhost/api/survey", {
      method,
      headers,
      body,
    });
  };

  const post = (body: unknown, options: CallOptions = {}) =>
    handleSurveySubmission(
      request(
        "POST",
        typeof body === "string" ? body : JSON.stringify(body),
        options,
      ),
      deps(options.deps),
    );
  const del = (options: CallOptions = {}) =>
    handleSurveyWithdrawal(
      request("DELETE", null, options),
      deps(options.deps),
    );

  const expectNoStore = (res: Response) =>
    expect(res.headers.get("cache-control")).toBe("no-store");

  describe("201", () => {
    it("stores an anonymous contribution and says it cannot be withdrawn", async () => {
      const scan = await world.addScan();
      const res = await post(validBody(scan), { cookie: scan.cookieSessionId });
      expect(res.status).toBe(201);
      expectNoStore(res);
      expect(surveySubmitResponseSchema.parse(await res.json())).toEqual({
        stored: true,
        withdrawable: false,
      });
      const [stored] = await world.contributions();
      expect(stored).toMatchObject({
        userId: null,
        consentVersion: SURVEY_CONSENT_VERSION,
      });
      expect(stored!.ratings).toHaveLength(1);
      expect(await world.scanMark(scan.scanId)).toEqual(NOW);
    });

    it("ties a signed-in contribution to the account and says it can be withdrawn, from a browser that holds no cookie", async () => {
      const scan = await world.addScan({ userId: "user-1" });
      signedInAs = "user-1";
      const res = await post(validBody(scan));
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ stored: true, withdrawable: true });
      expect((await world.contributions())[0]).toMatchObject({
        userId: "user-1",
      });
    });

    it("ties the contribution to the account when a signed-in person contributes from a scan their anonymous cookie still owns", async () => {
      const scan = await world.addScan();
      signedInAs = "user-1";
      const res = await post(validBody(scan), { cookie: scan.cookieSessionId });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ stored: true, withdrawable: true });
      expect((await world.contributions())[0]).toMatchObject({
        userId: "user-1",
      });
    });

    it("replaces a signed-in person's earlier rating of a mouse and is still 201", async () => {
      const one = await world.addScan({ userId: "user-1", handLengthMm: 181 });
      const two = await world.addScan({ userId: "user-1", handLengthMm: 192 });
      signedInAs = "user-1";
      expect((await post(validBody(one))).status).toBe(201);
      const again = await post(
        validBody(two, { ratings: [{ slug: "mouse-a", satisfaction: 1 }] }),
      );
      expect(again.status).toBe(201);
      const ratings = (await world.contributions()).flatMap((c) => c.ratings);
      expect(ratings).toEqual([
        expect.objectContaining({ slug: "mouse-a", satisfaction: 1 }),
      ]);
    });

    it("accepts a catalogue-free submission that names only another mouse", async () => {
      const scan = await world.addScan();
      const res = await post(
        validBody(scan, {
          ratings: [],
          otherMouse: { brand: BRAND, sizeFeel: FEEL_SMALL, current: true },
        }),
        { cookie: scan.cookieSessionId },
      );
      expect(res.status).toBe(201);
      expect((await world.contributions())[0]!.otherMice).toEqual([
        expect.objectContaining({ brand: BRAND, isCurrent: true }),
      ]);
    });
  });

  describe("the hand profile is read from the scan, never the body", () => {
    it.each([
      [100.0, 50.0],
      [104.9, 52.4],
      [105.0, 55.0],
      [186.4, 82.7],
      [186.5, 82.5],
      [279.9, 149.9],
      [280.0, 150.0],
    ])(
      "hand %s mm and palm %s mm are stored rounded down to a multiple of 5, never above the real value",
      async (handLengthMm, palmWidthMm) => {
        const scan = await world.addScan({
          handLengthMm,
          palmWidthMm,
          palmLengthMm: Math.round(handLengthMm * 0.55 * 10) / 10,
        });
        const res = await post(validBody(scan), {
          cookie: scan.cookieSessionId,
        });
        expect(res.status).toBe(201);
        const [stored] = await world.contributions();
        for (const [bin, real] of [
          [stored!.handLengthBinMm, handLengthMm],
          [stored!.palmWidthBinMm, palmWidthMm],
        ] as const) {
          expect(bin % 5).toBe(0);
          expect(bin).toBeLessThanOrEqual(real);
          expect(real - bin).toBeLessThan(5);
        }
        expect(stored!.handLengthBinMm).toBe(Math.floor(handLengthMm / 5) * 5);
        expect(stored!.palmWidthBinMm).toBe(Math.floor(palmWidthMm / 5) * 5);
      },
    );

    it("refuses a body that tries to name a hand profile, a scan measurement or a grip field of its own", async () => {
      const scan = await world.addScan();
      for (const extra of [
        { handLengthBinMm: 150 },
        { handLengthMm: 150 },
        { measurements: { handLengthMm: 150 } },
        { palmWidthBinMm: 70 },
        { sessionId: scan.sessionId },
      ]) {
        const res = await post(validBody(scan, extra), {
          cookie: scan.cookieSessionId,
        });
        expect(res.status).toBe(400);
      }
      expect(await world.contributions()).toEqual([]);
    });

    it.each([
      ["the body's grip", "fingertip", "palm", "fingertip"],
      ["the scan's stated grip", undefined, "claw", "claw"],
    ] as const)(
      "stores %s when there is one",
      async (_label, bodyGrip, stated, expected) => {
        const scan = await world.addScan({ gripStated: stated });
        const res = await post(
          validBody(scan, bodyGrip ? { gripStyle: bodyGrip } : {}),
          { cookie: scan.cookieSessionId },
        );
        expect(res.status).toBe(201);
        expect((await world.contributions())[0]!.gripStyle).toBe(expected);
      },
    );

    it.each([
      [180, 110, "palm"],
      [180, 100, "claw"],
      [180, 90, "fingertip"],
    ] as const)(
      "falls back to the grip the engine used when neither the body nor the scan says (hand %s, palm length %s -> %s)",
      async (handLengthMm, palmLengthMm, expected) => {
        const scan = await world.addScan({ handLengthMm, palmLengthMm });
        await post(validBody(scan), { cookie: scan.cookieSessionId });
        expect((await world.contributions())[0]!.gripStyle).toBe(expected);
      },
    );
  });

  describe("400", () => {
    it.each([
      ["not JSON", "{nope"],
      ["empty", ""],
    ])("%s body", async (_label, body) => {
      const res = await post(body);
      expect(res.status).toBe(400);
      expectNoStore(res);
      errorResponseSchema.parse(await res.json());
    });

    it.each([
      [
        "no consent",
        (b: Record<string, unknown>) => ({ ...b, consent: undefined }),
        "consent",
      ],
      [
        "an old consent version",
        (b: Record<string, unknown>) => ({
          ...b,
          consent: { accepted: true, version: "survey-consent-v1" },
        }),
        "consent.version",
      ],
      [
        "consent not accepted",
        (b: Record<string, unknown>) => ({
          ...b,
          consent: { accepted: false, version: SURVEY_CONSENT_VERSION },
        }),
        "consent.accepted",
      ],
      [
        "no mouse named",
        (b: Record<string, unknown>) => ({ ...b, ratings: [] }),
        "ratings",
      ],
      [
        "two mice marked current",
        (b: Record<string, unknown>) => ({
          ...b,
          ratings: [
            { slug: "mouse-a", satisfaction: 3, current: true },
            { slug: "mouse-b", satisfaction: 3, current: true },
          ],
        }),
        "ratings",
      ],
      [
        "satisfaction out of range",
        (b: Record<string, unknown>) => ({
          ...b,
          ratings: [{ slug: "mouse-a", satisfaction: 6 }],
        }),
        "ratings.0.satisfaction",
      ],
      [
        "an email address in the comment",
        (b: Record<string, unknown>) => ({
          ...b,
          feedback: "mail me a@b.example",
        }),
        "feedback",
      ],
      [
        "a phone number in the comment",
        (b: Record<string, unknown>) => ({
          ...b,
          feedback: "call 0912 345 678",
        }),
        "feedback",
      ],
      [
        // v2 only: in contract v3 the brand is a pick from a fixed list, not
        // free text, and this refusal (and the brand's text screening) goes away.
        "a control character in the brand",
        (b: Record<string, unknown>) => ({
          ...b,
          ratings: [],
          otherMouse: { brand: "Zor\u0000batron", sizeFeel: FEEL_RIGHT },
        }),
        "otherMouse.brand",
      ],
      [
        "an unpaired surrogate in the comment",
        (b: Record<string, unknown>) => ({ ...b, feedback: "bad \ud800 text" }),
        "feedback",
      ],
      [
        "a malformed scan id",
        (b: Record<string, unknown>) => ({ ...b, scanId: "not-a-uuid" }),
        "scanId",
      ],
    ])("%s", async (_label, mutate, path) => {
      const scan = await world.addScan();
      const res = await post(mutate(validBody(scan)), {
        cookie: scan.cookieSessionId,
      });
      expect(res.status).toBe(400);
      expectNoStore(res);
      const body = errorResponseSchema.parse(await res.json());
      expect(body.issues?.map((i) => i.path)).toContain(path);
      expect(JSON.stringify(body)).not.toMatch(
        /a@b\.example|0912 345 678|bad|Zor/,
      );
      expect(await world.contributions()).toEqual([]);
      expect(await world.scanMark(scan.scanId)).toBeNull();
    });

    it("an unknown mouse slug, naming the field, with nothing stored and the scan unmarked", async () => {
      const scan = await world.addScan();
      const res = await post(
        validBody(scan, {
          ratings: [
            { slug: "mouse-a", satisfaction: 4 },
            { slug: "no-such-mouse", satisfaction: 4 },
          ],
        }),
        { cookie: scan.cookieSessionId },
      );
      expect(res.status).toBe(400);
      expectNoStore(res);
      expect(errorResponseSchema.parse(await res.json()).issues).toEqual([
        { path: "ratings.1.slug", message: "unknown mouse" },
      ]);
      expect(await world.contributions()).toEqual([]);
      expect(await world.scanMark(scan.scanId)).toBeNull();
    });
  });

  describe("404, one body for every cause", () => {
    const NOT_FOUND = { error: "Scan not found." };

    it("an unknown scan, someone else's scan, an expired anonymous scan, a claimed scan reached with a stale cookie, and no credential at all", async () => {
      const mine = await world.addScan({ userId: "user-1" });
      const anon = await world.addScan();
      const expired = await world.addScan({
        expiresAt: new Date(NOW.getTime() - 1000),
      });
      const attempts: [string, WorldScan, CallOptions, string | null][] = [
        [
          "unknown scan",
          { ...anon, scanId: "10000000-0000-4000-8000-0000000000ee" },
          { cookie: anon.cookieSessionId },
          null,
        ],
        ["someone else's claimed scan", mine, {}, "user-2"],
        [
          "someone else's anonymous scan",
          anon,
          { cookie: expired.cookieSessionId },
          null,
        ],
        [
          "an expired anonymous scan",
          expired,
          { cookie: expired.cookieSessionId },
          null,
        ],
        [
          "a claimed scan, signed out, stale cookie",
          mine,
          { cookie: mine.sessionId },
          null,
        ],
        ["no cookie and not signed in", anon, {}, null],
      ];
      for (const [label, scan, options, user] of attempts) {
        signedInAs = user;
        const res = await post(validBody(scan), options);
        expect(res.status, label).toBe(404);
        expectNoStore(res);
        expect(await res.json(), label).toEqual(NOT_FOUND);
      }
      expect(await world.contributions()).toEqual([]);
    });

    it("a scan that disappears between the ownership check and the write is a 404 too, with the same body", async () => {
      const scan = await world.addScan();
      const res = await post(validBody(scan), {
        cookie: scan.cookieSessionId,
        deps: {
          surveyRepo: {
            ...world.surveyRepo,
            recordContribution: async () => "scan_gone",
          },
        },
      });
      expect(res.status).toBe(404);
      expectNoStore(res);
      expect(await res.json()).toEqual(NOT_FOUND);
    });

    it("is checked before the mouse list: a foreign scan with an unknown slug is 404, not 400", async () => {
      const mine = await world.addScan({ userId: "user-1" });
      signedInAs = "user-2";
      const res = await post(
        validBody(mine, {
          ratings: [{ slug: "no-such-mouse", satisfaction: 3 }],
        }),
      );
      expect(res.status).toBe(404);
    });
  });

  describe("409", () => {
    it("a second submission for the same scan is refused, even with different answers, and the first stays", async () => {
      const scan = await world.addScan();
      expect(
        (await post(validBody(scan), { cookie: scan.cookieSessionId })).status,
      ).toBe(201);
      const before = await world.contributions();

      const res = await post(
        validBody(scan, {
          feedback: COMMENT,
          ratings: [{ slug: "mouse-b", satisfaction: 1 }],
        }),
        { cookie: scan.cookieSessionId },
      );
      expect(res.status).toBe(409);
      expectNoStore(res);
      errorResponseSchema.parse(await res.json());
      expect(await world.contributions()).toEqual(before);
    });

    it("comes after the mouse list: a contributed scan with an unknown slug is 400", async () => {
      const scan = await world.addScan();
      await post(validBody(scan), { cookie: scan.cookieSessionId });
      const res = await post(
        validBody(scan, {
          ratings: [{ slug: "no-such-mouse", satisfaction: 3 }],
        }),
        { cookie: scan.cookieSessionId },
      );
      expect(res.status).toBe(400);
    });

    it("lets a scan that was not marked contribute even when its owner contributed from another scan", async () => {
      signedInAs = "user-1";
      const one = await world.addScan({ userId: "user-1", handLengthMm: 181 });
      const two = await world.addScan({ userId: "user-1", handLengthMm: 192 });
      expect((await post(validBody(one))).status).toBe(201);
      expect((await post(validBody(two))).status).toBe(201);
      expect((await post(validBody(two))).status).toBe(409);
    });
  });

  describe("413", () => {
    it("refuses a body whose Content-Length is over the cap before reading it", async () => {
      const scan = await world.addScan();
      const findOwnedScan = vi.spyOn(world.scanRepo, "findOwnedScan");
      const res = await post(validBody(scan), {
        cookie: scan.cookieSessionId,
        headers: { "content-length": String(MAX_SURVEY_BODY_BYTES + 1) },
      });
      expect(res.status).toBe(413);
      expectNoStore(res);
      errorResponseSchema.parse(await res.json());
      expect(findOwnedScan).not.toHaveBeenCalled();
      findOwnedScan.mockRestore();
    });

    it("refuses a streamed body that grows past the cap with no Content-Length", async () => {
      const scan = await world.addScan();
      const res = await post(
        validBody(scan, { feedback: "x".repeat(MAX_SURVEY_BODY_BYTES) }),
        { cookie: scan.cookieSessionId },
      );
      expect(res.status).toBe(413);
      expect(await world.contributions()).toEqual([]);
    });

    it("accepts a full-size body: five ratings with every pain point, a brand and a comment at their limits", async () => {
      const scan = await world.addScan();
      const slugs = ["mouse-a", "mouse-b", "mouse-c", "mouse-d", "mouse-e"];
      for (const slug of slugs.slice(2)) await world.addMouse(slug);
      const body = JSON.stringify(
        validBody(scan, {
          feedback: "é".repeat(500),
          mainUse: USE_B,
          ratings: slugs.map((slug) => ({
            slug,
            satisfaction: 5,
            duration: DURATION_B,
            painPoints: [
              "length",
              "width",
              "height",
              "weight",
              "thumb",
              "buttons",
              "other",
            ],
          })),
          otherMouse: { brand: BRAND_A, sizeFeel: FEEL_RIGHT },
        }),
      );
      expect(Buffer.byteLength(body)).toBeLessThan(MAX_SURVEY_BODY_BYTES);
      const res = await post(body, { cookie: scan.cookieSessionId });
      expect(res.status).toBe(201);
    });
  });

  describe("429", () => {
    it("is refused before the body is read, and stores nothing", async () => {
      limiter.allow.mockResolvedValue(false);
      const scan = await world.addScan();
      const res = await post("{garbage", { cookie: scan.cookieSessionId });
      expect(res.status).toBe(429);
      expectNoStore(res);
      errorResponseSchema.parse(await res.json());
      expect(limiter.allow).toHaveBeenCalledWith(IP);

      const ok = await post(validBody(scan), { cookie: scan.cookieSessionId });
      expect(ok.status).toBe(429);
      expect(await world.contributions()).toEqual([]);
      expect(await world.scanMark(scan.scanId)).toBeNull();
    });

    it("is never applied to a request with no usable IP (local dev), as on the other routes", async () => {
      limiter.allow.mockResolvedValue(false);
      const scan = await world.addScan();
      const res = await post(validBody(scan), {
        cookie: scan.cookieSessionId,
        ip: null,
      });
      expect(res.status).toBe(201);
      expect(limiter.allow).not.toHaveBeenCalled();
    });
  });

  describe("500", () => {
    it("answers with a plain sentence, no-store, when the write fails", async () => {
      const scan = await world.addScan();
      const res = await post(validBody(scan, { feedback: COMMENT }), {
        cookie: scan.cookieSessionId,
        deps: {
          surveyRepo: {
            ...world.surveyRepo,
            recordContribution: async () => {
              throw new Error(`insert failed for ${COMMENT} / ${BRAND}`);
            },
          },
        },
      });
      expect(res.status).toBe(500);
      expectNoStore(res);
      const text = JSON.stringify(await res.json());
      expect(text).not.toContain(COMMENT);
      expect(text).not.toContain("insert failed");
    });

    it("also when the limiter itself throws", async () => {
      limiter.allow.mockRejectedValue(new Error("db down"));
      const res = await post("{}");
      expect(res.status).toBe(500);
      expectNoStore(res);
    });
  });

  describe("DELETE", () => {
    it("is 401 for a caller who is not signed in, whatever else they send", async () => {
      const res = await del();
      expect(res.status).toBe(401);
      expectNoStore(res);
      errorResponseSchema.parse(await res.json());
    });

    it("is 429 when the caller's IP is limited, before the sign-in check", async () => {
      limiter.allow.mockResolvedValue(false);
      signedInAs = "user-1";
      const res = await del();
      expect(res.status).toBe(429);
      expectNoStore(res);
      errorResponseSchema.parse(await res.json());
    });

    it("withdraws everything the caller contributed, answers 204 with no body, and leaves other people's and anonymous contributions", async () => {
      const mine = await world.addScan({ userId: "user-1", handLengthMm: 181 });
      const theirs = await world.addScan({
        userId: "user-2",
        handLengthMm: 192,
      });
      const anon = await world.addScan({ handLengthMm: 203 });
      signedInAs = "user-1";
      await post(validBody(mine, { feedback: COMMENT }));
      signedInAs = "user-2";
      await post(validBody(theirs));
      signedInAs = null;
      await post(validBody(anon), { cookie: anon.cookieSessionId });

      signedInAs = "user-1";
      const res = await del();
      expect(res.status).toBe(204);
      expectNoStore(res);
      expect(await res.text()).toBe("");
      const left = await world.contributions();
      expect(left.map((c) => c.userId)).toEqual(["user-2", null]);
      expect(await world.rawContributionText()).not.toContain(COMMENT);
      // The mark on their scan stays: that scan still cannot contribute twice.
      expect(await world.scanMark(mine.scanId)).toEqual(NOW);
    });

    it("is 204 also when there was nothing to withdraw", async () => {
      signedInAs = "user-1";
      const res = await del();
      expect(res.status).toBe(204);
      expectNoStore(res);
    });

    it("is 500, no-store, when the delete fails", async () => {
      signedInAs = "user-1";
      const res = await del({
        deps: {
          surveyRepo: {
            ...world.surveyRepo,
            withdrawContributions: async () => {
              throw new Error("boom");
            },
          },
        },
      });
      expect(res.status).toBe(500);
      expectNoStore(res);
    });
  });

  describe("privacy", () => {
    let lines: string[];
    beforeEach(() => {
      lines = [];
      for (const level of ["log", "warn", "error"] as const) {
        vi.spyOn(console, level).mockImplementation((line: unknown) => {
          lines.push(String(line));
        });
      }
    });
    afterEach(() => vi.restoreAllMocks());

    const answers = (scan: WorldScan) =>
      validBody(scan, {
        feedback: COMMENT,
        mainUse: USE_B,
        otherMouse: { brand: BRAND, sizeFeel: FEEL_LARGE },
      });

    it("no response of any status echoes the comment or the brand", async () => {
      const scan = await world.addScan({
        handLengthMm: 186.4,
        palmWidthMm: 82.7,
      });
      const other = await world.addScan({ userId: "user-1" });
      const responses = [
        await post(answers(scan), { cookie: scan.cookieSessionId }), // 201
        await post(answers(scan), { cookie: scan.cookieSessionId }), // 409
        await post(answers(other)), // 404
        await post(
          { ...answers(scan), ratings: [{ slug: "nope", satisfaction: 3 }] },
          { cookie: scan.cookieSessionId },
        ), // 400 unknown mouse
        await post(
          { ...answers(scan), feedback: `${COMMENT} a@b.example` },
          { cookie: scan.cookieSessionId },
        ), // 400 schema
        await post(
          JSON.stringify({ ...answers(scan), pad: "x".repeat(9000) }),
          {
            cookie: scan.cookieSessionId,
          },
        ), // 413
        await handleSurveySubmission(
          request("POST", JSON.stringify(answers(scan)), {
            cookie: scan.cookieSessionId,
          }),
          deps({ limiter: { allow: async () => false } }),
        ), // 429
      ];
      expect(responses.map((r) => r.status)).toEqual([
        201, 409, 404, 400, 400, 413, 429,
      ]);
      for (const res of responses) {
        const text = await res.text();
        expect(text).not.toContain(COMMENT);
        expect(text).not.toContain(BRAND);
        expect(text).not.toMatch(new RegExp(`${USE_B}|${FEEL_LARGE}`));
        expect(text).not.toMatch(/\b185\b|\b80\b/);
      }
    });

    it("no log line carries the comment, the brand, a bin or the scan id, on success or on failure", async () => {
      const mine = await world.addScan({
        userId: "user-1",
        handLengthMm: 191.2,
      });
      const third = await world.addScan({
        userId: "user-1",
        handLengthMm: 197.7,
      });
      signedInAs = "user-1";
      await post(answers(mine)); // stored
      await post(answers(mine)); // conflict
      signedInAs = "user-2";
      await post(answers(mine)); // not found: someone else's scan
      signedInAs = "user-1";
      await post(answers(third), {
        deps: {
          surveyRepo: {
            ...world.surveyRepo,
            recordContribution: async () => {
              // A driver error that quotes the statement and its parameters.
              throw Object.assign(
                new Error(
                  `insert into survey_contributions ... params: ${COMMENT}, ${BRAND}, 195, 80, ${third.scanId}`,
                ),
                { code: "23505" },
              );
            },
          },
        },
      }); // failed
      await del(); // withdrawn

      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).not.toContain(COMMENT);
        expect(line).not.toContain(BRAND);
        expect(line).not.toContain(mine.scanId);
        expect(line).not.toContain(third.scanId);
        expect(line).not.toMatch(/feedback|brand|BinMm|\b(?:190|195|80)\b/i);
        expect(() => JSON.parse(line)).not.toThrow();
      }
      // What it does say is the outcome.
      expect(lines.map((l) => JSON.parse(l).event)).toEqual(
        expect.arrayContaining([
          "survey.stored",
          "survey.conflict",
          "survey.failed",
          "survey.withdrawn",
        ]),
      );
    });
  });
});
