/**
 * `GET` and `PUT /api/survey` (src/server/survey/service.ts), end to end
 * through the handlers with injected deps, against the in-memory fakes and
 * against the real repos on PGlite (the replacement is the real SQL there). The
 * contract is src/lib/contracts/survey.ts (`surveyEditSchema`,
 * `surveyMineResponseSchema`) and routes.ts (`SURVEY_PATH`): status codes, what
 * a PUT replaces as a whole, what it never touches, and `no-store` everywhere.
 *
 * Contributions are seeded straight through `surveyRepo.recordContribution`
 * with a consent day of their own, so "the latest contribution" is decided by
 * a day the test chose, not by a clock.
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
  MAX_ACCOUNT_MICE,
  OTHER_MOUSE_BRANDS,
  SURVEY_CONSENT_VERSION,
  surveyEditResponseSchema,
  surveyMineResponseSchema,
  type MainUse,
  type OtherMouseBrand,
  type SizeFeel,
} from "../../src/lib/contracts/survey";
import {
  MAX_SURVEY_BODY_BYTES,
  handleSurveyEdit,
  handleSurveyRead,
  handleSurveyWithdrawal,
  type SurveyDeps,
} from "../../src/server/survey/service";
import { startOfUtcDay } from "../../src/server/survey/profile";
import {
  NOW,
  createFakeSurveyWorld,
  createPgliteSurveyWorld,
  type SurveyWorld,
} from "./fixtures/survey-world";
import {
  USE_A,
  USE_B,
  FEEL_SMALL,
  FEEL_RIGHT,
  FEEL_LARGE,
  DURATION_A,
  DURATION_B,
  PAIN_A,
  PAIN_B,
  BRAND_A,
  BRAND_B,
  BRAND_PRIVATE,
} from "./fixtures/survey-values";

const IP = "203.0.113.7";
const COMMENT = "The side buttons rattle on my desk.";
const NEW_COMMENT = "Lighter than I remembered, and quieter.";
const LONGEST_BRAND = [...OTHER_MOUSE_BRANDS].sort(
  (a, b) => b.length - a.length,
)[0]!;

const worlds: [string, () => Promise<SurveyWorld>][] = [
  ["in-memory fakes", async () => createFakeSurveyWorld()],
  ["real repos on PGlite", createPgliteSurveyWorld],
];

interface SeedRating {
  slug: string;
  satisfaction: number;
  duration?: (typeof DURATION_A | typeof DURATION_B) | null;
  painPoints?: (typeof PAIN_A | typeof PAIN_B)[];
  current?: boolean;
}

interface Seed {
  /** The consent day, `YYYY-MM-DD`; the later day is the latest contribution. */
  day: string;
  /** A hand length of its own, so the test can tell contributions apart. */
  handLengthMm: number;
  mainUse?: MainUse;
  feedback?: string;
  ratings?: SeedRating[];
  other?: { brand: OtherMouseBrand; sizeFeel: SizeFeel; current?: boolean };
  grip?: "palm" | "claw" | "fingertip";
}

describe.each(worlds)("GET and PUT /api/survey on %s", (_name, make) => {
  let world: SurveyWorld;
  let signedInAs: string | null;
  let limiter: { allow: Mock<(key: string) => Promise<boolean>> };
  let mouseIds: Map<string, string>;

  beforeAll(async () => {
    world = await make();
  });
  afterAll(() => world.close());
  beforeEach(async () => {
    await world.reset();
    await world.addUser("user-1");
    await world.addUser("user-2");
    mouseIds = new Map();
    for (const slug of ["mouse-a", "mouse-b", "mouse-c", "mouse-d"]) {
      mouseIds.set(slug, await world.addMouse(slug));
    }
    signedInAs = "user-1";
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

  interface CallOptions {
    ip?: string | null;
    headers?: Record<string, string>;
    deps?: Partial<SurveyDeps>;
  }

  const request = (
    method: "GET" | "PUT",
    body: BodyInit | null,
    options: CallOptions = {},
  ) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...options.headers,
    };
    if (options.ip !== null) headers["x-forwarded-for"] = options.ip ?? IP;
    return new Request("http://localhost/api/survey", {
      method,
      headers,
      body,
    });
  };

  const get = (options: CallOptions = {}) =>
    handleSurveyRead(request("GET", null, options), deps(options.deps));
  const put = (body: unknown, options: CallOptions = {}) =>
    handleSurveyEdit(
      request(
        "PUT",
        typeof body === "string" ? body : JSON.stringify(body),
        options,
      ),
      deps(options.deps),
    );

  const expectNoStore = (res: Response) =>
    expect(res.headers.get("cache-control")).toBe("no-store");

  /** Reads the caller's answers through the handler and checks the schema. */
  async function mine() {
    const res = await get();
    expect(res.status).toBe(200);
    expectNoStore(res);
    return surveyMineResponseSchema.parse(await res.json());
  }

  /** One signed-in (or other) contribution, written as a submission writes it. */
  async function contribute(userId: string | null, seed: Seed) {
    const scan = await world.addScan({
      userId,
      handLengthMm: seed.handLengthMm,
    });
    const result = await world.surveyRepo.recordContribution({
      scanId: scan.scanId,
      userId,
      consentVersion: SURVEY_CONSENT_VERSION,
      consentedAt: startOfUtcDay(new Date(`${seed.day}T09:00:00Z`)),
      markedAt: NOW,
      handLengthBinMm: Math.floor(seed.handLengthMm / 5) * 5,
      palmWidthBinMm: 80,
      gripStyle: seed.grip ?? "claw",
      mainUse: seed.mainUse ?? null,
      feedback: seed.feedback ?? null,
      ratings: (seed.ratings ?? []).map((r) => ({
        mouseId: mouseIds.get(r.slug)!,
        satisfaction: r.satisfaction,
        duration: r.duration ?? null,
        painPoints: r.painPoints ?? [],
        isCurrent: r.current ?? false,
      })),
      otherMouse: seed.other
        ? {
            brand: seed.other.brand,
            sizeFeel: seed.other.sizeFeel,
            isCurrent: seed.other.current ?? false,
          }
        : null,
    });
    expect(result).toBe("stored");
    return scan;
  }

  /** Two contributions of user-1: an earlier one, then the latest. */
  async function seedTwo() {
    await contribute("user-1", {
      day: "2026-09-01",
      handLengthMm: 181,
      mainUse: USE_A,
      feedback: COMMENT,
      grip: "palm",
      ratings: [
        {
          slug: "mouse-a",
          satisfaction: 4,
          duration: DURATION_A,
          painPoints: [PAIN_A],
          current: true,
        },
        { slug: "mouse-b", satisfaction: 2 },
      ],
      other: { brand: BRAND_A, sizeFeel: FEEL_SMALL },
    });
    await contribute("user-1", {
      day: "2026-10-01",
      handLengthMm: 192,
      mainUse: USE_B,
      feedback: NEW_COMMENT,
      grip: "fingertip",
      ratings: [{ slug: "mouse-c", satisfaction: 5 }],
      other: { brand: BRAND_B, sizeFeel: FEEL_LARGE, current: false },
    });
  }

  /** Everything a PUT must never touch, per contribution, in a stable order. */
  async function untouched() {
    const all = await world.contributions();
    return all.map((c) => ({
      userId: c.userId,
      consentVersion: c.consentVersion,
      consentedAt: c.consentedAt,
      handLengthBinMm: c.handLengthBinMm,
      palmWidthBinMm: c.palmWidthBinMm,
      gripStyle: c.gripStyle,
    }));
  }

  const edit = (over: Record<string, unknown> = {}) => ({
    ratings: [{ slug: "mouse-a", satisfaction: 3 }],
    ...over,
  });

  describe("GET", () => {
    it("is 401 for a caller who is not signed in, with no-store", async () => {
      signedInAs = null;
      const res = await get();
      expect(res.status).toBe(401);
      expectNoStore(res);
      errorResponseSchema.parse(await res.json());
    });

    it("is 429 when the caller's IP is limited, before the sign-in check", async () => {
      limiter.allow.mockResolvedValue(false);
      signedInAs = null;
      const res = await get();
      expect(res.status).toBe(429);
      expectNoStore(res);
      errorResponseSchema.parse(await res.json());
      expect(limiter.allow).toHaveBeenCalledWith(IP);
    });

    it("is 200 with empty lists and nulls when nothing is kept", async () => {
      expect(await mine()).toEqual({
        mainUse: null,
        ratings: [],
        otherMice: [],
        feedback: null,
      });
    });

    it("gives every rating and other mouse of the account, the current marker, the account's main use and the latest contribution's comment", async () => {
      await seedTwo();
      expect(await mine()).toEqual({
        // The later answer: the repeat rules emptied the earlier one.
        mainUse: USE_B,
        feedback: NEW_COMMENT,
        ratings: [
          {
            slug: "mouse-a",
            satisfaction: 4,
            duration: DURATION_A,
            painPoints: [PAIN_A],
            current: true,
          },
          { slug: "mouse-b", satisfaction: 2, painPoints: [], current: false },
          { slug: "mouse-c", satisfaction: 5, painPoints: [], current: false },
        ],
        // Ordered by brand slug.
        otherMice: [
          { brand: BRAND_B, sizeFeel: FEEL_LARGE, current: false },
          { brand: BRAND_A, sizeFeel: FEEL_SMALL, current: false },
        ],
      });
    });

    it("leaves duration out of a rating that has none, and keeps a main use a later contribution did not repeat", async () => {
      await contribute("user-1", {
        day: "2026-09-01",
        handLengthMm: 181,
        mainUse: USE_A,
        ratings: [{ slug: "mouse-a", satisfaction: 4 }],
      });
      await contribute("user-1", {
        day: "2026-10-01",
        handLengthMm: 192,
        ratings: [{ slug: "mouse-b", satisfaction: 3 }],
      });
      const res = await get();
      const body = await res.json();
      expect(body.ratings[0]).not.toHaveProperty("duration");
      expect(body.mainUse).toBe(USE_A);
      // The comment is the LATEST contribution's: that one has none.
      expect(body.feedback).toBeNull();
    });

    it("reads the comment of the latest contribution, not of the first stored", async () => {
      await contribute("user-1", {
        day: "2026-10-01",
        handLengthMm: 192,
        feedback: NEW_COMMENT,
        ratings: [{ slug: "mouse-a", satisfaction: 3 }],
      });
      await contribute("user-1", {
        day: "2026-09-01",
        handLengthMm: 181,
        feedback: COMMENT,
        ratings: [{ slug: "mouse-b", satisfaction: 3 }],
      });
      expect((await mine()).feedback).toBe(NEW_COMMENT);
    });

    it("never shows another person's or an anonymous contribution", async () => {
      await contribute("user-2", {
        day: "2026-10-01",
        handLengthMm: 192,
        feedback: COMMENT,
        mainUse: USE_B,
        ratings: [{ slug: "mouse-a", satisfaction: 1, current: true }],
        other: { brand: BRAND_PRIVATE, sizeFeel: FEEL_RIGHT },
      });
      await contribute(null, {
        day: "2026-10-02",
        handLengthMm: 203,
        feedback: NEW_COMMENT,
        ratings: [{ slug: "mouse-b", satisfaction: 1 }],
      });
      expect(await mine()).toEqual({
        mainUse: null,
        ratings: [],
        otherMice: [],
        feedback: null,
      });
    });

    it("is empty again after the account withdraws everything", async () => {
      await seedTwo();
      const res = await handleSurveyWithdrawal(
        new Request("http://localhost/api/survey", { method: "DELETE" }),
        deps(),
      );
      expect(res.status).toBe(204);
      expect(await mine()).toEqual({
        mainUse: null,
        ratings: [],
        otherMice: [],
        feedback: null,
      });
    });

    it("is 500, no-store and without the error's text, when the read fails", async () => {
      const res = await get({
        deps: {
          surveyRepo: {
            ...world.surveyRepo,
            readAnswers: async () => {
              throw new Error(`select failed for ${COMMENT}`);
            },
          },
        },
      });
      expect(res.status).toBe(500);
      expectNoStore(res);
      expect(await res.text()).not.toContain(COMMENT);
    });
  });

  describe("PUT: refusals", () => {
    it("is 401 for a caller who is not signed in, before the body is read, with nothing changed", async () => {
      await seedTwo();
      const before = await mine();
      signedInAs = null;
      const res = await put("{garbage");
      expect(res.status).toBe(401);
      expectNoStore(res);
      errorResponseSchema.parse(await res.json());
      signedInAs = "user-1";
      expect(await mine()).toEqual(before);
    });

    it("is 429 when the caller's IP is limited, before the sign-in check and the body", async () => {
      limiter.allow.mockResolvedValue(false);
      signedInAs = null;
      const res = await put("{garbage");
      expect(res.status).toBe(429);
      expectNoStore(res);
      errorResponseSchema.parse(await res.json());
    });

    it("is never limited for a request with no usable IP (local dev)", async () => {
      limiter.allow.mockResolvedValue(false);
      await seedTwo();
      const res = await put(edit(), { ip: null });
      expect(res.status).toBe(200);
      expect(limiter.allow).not.toHaveBeenCalled();
    });

    it("is 404 when the account has no contribution, with one body and nothing created", async () => {
      const res = await put(edit({ feedback: COMMENT, mainUse: USE_A }));
      expect(res.status).toBe(404);
      expectNoStore(res);
      errorResponseSchema.parse(await res.json());
      expect(await world.contributions()).toEqual([]);
      expect(await mine()).toEqual({
        mainUse: null,
        ratings: [],
        otherMice: [],
        feedback: null,
      });
    });

    it("is 404 for a person who has none even though others do, and changes nothing of theirs", async () => {
      await contribute("user-2", {
        day: "2026-10-01",
        handLengthMm: 192,
        mainUse: USE_B,
        feedback: COMMENT,
        ratings: [{ slug: "mouse-a", satisfaction: 4, current: true }],
        other: { brand: BRAND_A, sizeFeel: FEEL_SMALL },
      });
      const before = await world.contributions();
      const res = await put(edit({ feedback: NEW_COMMENT }));
      expect(res.status).toBe(404);
      expect(await world.contributions()).toEqual(before);
    });

    it("is 404 when the only contribution is anonymous: it is tied to no account", async () => {
      await contribute(null, {
        day: "2026-10-01",
        handLengthMm: 192,
        ratings: [{ slug: "mouse-a", satisfaction: 4 }],
      });
      const before = await world.contributions();
      const res = await put(edit());
      expect(res.status).toBe(404);
      expect(await world.contributions()).toEqual(before);
    });

    it.each([
      ["not JSON", "{nope"],
      ["empty", ""],
    ])("is 400 for a %s body", async (_label, body) => {
      await seedTwo();
      const res = await put(body);
      expect(res.status).toBe(400);
      expectNoStore(res);
      errorResponseSchema.parse(await res.json());
    });

    const twoCurrents = {
      ratings: [
        { slug: "mouse-a", satisfaction: 3, current: true },
        { slug: "mouse-b", satisfaction: 3 },
      ],
      otherMice: [{ brand: BRAND_A, sizeFeel: FEEL_SMALL, current: true }],
    };
    const manyRatings = Array.from(
      { length: MAX_ACCOUNT_MICE + 1 },
      (_, i) => ({
        slug: `mouse-${i}`,
        satisfaction: 3,
      }),
    );
    it.each([
      ["no mouse named at all", { ratings: [], otherMice: [] }, "ratings"],
      ["an empty body", {}, "ratings"],
      ["two mice marked current", twoCurrents, "ratings"],
      [
        "the same mouse twice",
        {
          ratings: [
            { slug: "mouse-a", satisfaction: 3 },
            { slug: "mouse-a", satisfaction: 4 },
          ],
        },
        "ratings",
      ],
      [
        "the same brand twice",
        {
          otherMice: [
            { brand: BRAND_A, sizeFeel: FEEL_SMALL },
            { brand: BRAND_A, sizeFeel: FEEL_LARGE },
          ],
        },
        "otherMice",
      ],
      [
        "more mice than an account can hold",
        { ratings: manyRatings },
        "ratings",
      ],
      [
        "ratings and other mice together over the cap",
        {
          ratings: manyRatings.slice(0, MAX_ACCOUNT_MICE),
          otherMice: [{ brand: BRAND_A, sizeFeel: FEEL_SMALL }],
        },
        "ratings",
      ],
      [
        "a scan id, which an edit has no field for",
        edit({ scanId: "10000000-0000-4000-8000-000000000001" }),
        "",
      ],
      [
        "a consent record, which an edit has no field for",
        edit({ consent: { accepted: true, version: SURVEY_CONSENT_VERSION } }),
        "",
      ],
      ["a grip, which an edit never changes", edit({ gripStyle: "palm" }), ""],
      ["a hand profile field", edit({ handLengthBinMm: 150 }), ""],
      [
        "an email address in the comment",
        edit({ feedback: "mail me a@b.example" }),
        "feedback",
      ],
      ["an empty comment", edit({ feedback: "   " }), "feedback"],
      [
        "satisfaction out of range",
        { ratings: [{ slug: "mouse-a", satisfaction: 6 }] },
        "ratings.0.satisfaction",
      ],
      [
        "a brand typed as free text",
        { otherMice: [{ brand: "Zorbatron", sizeFeel: FEEL_RIGHT }] },
        "otherMice.0.brand",
      ],
    ])(
      "is 400 for %s, naming the field, with everything left as it was",
      async (_label, body, path) => {
        await seedTwo();
        const before = await world.contributions();
        const res = await put(body);
        expect(res.status).toBe(400);
        expectNoStore(res);
        const parsed = (await res.json()) as {
          error: string;
          issues: { path: string }[];
        };
        errorResponseSchema.parse(parsed);
        expect(parsed.issues.map((i) => i.path)).toContain(path);
        expect(await world.contributions()).toEqual(before);
      },
    );

    it("is 400 for an unknown mouse slug, naming the field, with everything left as it was", async () => {
      await seedTwo();
      const before = await world.contributions();
      const res = await put({
        ratings: [
          { slug: "mouse-a", satisfaction: 3 },
          { slug: "no-such-mouse", satisfaction: 3 },
        ],
        feedback: NEW_COMMENT,
      });
      expect(res.status).toBe(400);
      expectNoStore(res);
      expect(await res.json()).toEqual({
        error: "Unknown mouse.",
        issues: [{ path: "ratings.1.slug", message: "unknown mouse" }],
      });
      expect(await world.contributions()).toEqual(before);
    });

    it("checks the body before the contribution: a body that is wrong is a 400 even for an account with none", async () => {
      const res = await put({ ratings: [] });
      expect(res.status).toBe(400);
    });

    it("refuses a body whose Content-Length is over the POST cap before reading it (413)", async () => {
      await seedTwo();
      const res = await put(edit(), {
        headers: { "content-length": String(MAX_SURVEY_BODY_BYTES + 1) },
      });
      expect(res.status).toBe(413);
      expectNoStore(res);
      errorResponseSchema.parse(await res.json());
    });

    it("refuses a streamed body that grows past the cap with no Content-Length (413), changing nothing", async () => {
      await seedTwo();
      const before = await world.contributions();
      const res = await put(
        edit({ feedback: "x".repeat(MAX_SURVEY_BODY_BYTES) }),
      );
      expect(res.status).toBe(413);
      expect(await world.contributions()).toEqual(before);
    });

    it("answers 500, no-store and without the error's text, when the write fails", async () => {
      await seedTwo();
      const res = await put(edit({ feedback: COMMENT }), {
        deps: {
          surveyRepo: {
            ...world.surveyRepo,
            replaceAnswers: async () => {
              throw new Error(
                `update failed for ${COMMENT} / ${BRAND_PRIVATE}`,
              );
            },
          },
        },
      });
      expect(res.status).toBe(500);
      expectNoStore(res);
      const text = await res.text();
      expect(text).not.toContain(COMMENT);
      expect(text).not.toContain("update failed");
    });
  });

  describe("PUT: replaces the answers as a whole", () => {
    it("answers 200 with the response schema and no-store", async () => {
      await seedTwo();
      const res = await put(edit());
      expect(res.status).toBe(200);
      expectNoStore(res);
      expect(surveyEditResponseSchema.parse(await res.json())).toEqual({
        stored: true,
      });
    });

    it("removes what the body leaves out: a rating, a brand, the main use and the comment", async () => {
      await seedTwo();
      const res = await put({
        ratings: [{ slug: "mouse-b", satisfaction: 5, duration: DURATION_B }],
      });
      expect(res.status).toBe(200);
      expect(await mine()).toEqual({
        mainUse: null,
        feedback: null,
        ratings: [
          {
            slug: "mouse-b",
            satisfaction: 5,
            duration: DURATION_B,
            painPoints: [],
            current: false,
          },
        ],
        otherMice: [],
      });
    });

    it("sets every field of every rating and other mouse to the body's, a merge of old and new never", async () => {
      await seedTwo();
      const body = {
        mainUse: USE_A,
        feedback: COMMENT,
        ratings: [
          {
            slug: "mouse-a",
            satisfaction: 1,
            painPoints: [PAIN_B],
            current: false,
          },
          { slug: "mouse-d", satisfaction: 5, duration: DURATION_B },
        ],
        otherMice: [
          { brand: BRAND_B, sizeFeel: FEEL_RIGHT, current: true },
          { brand: BRAND_PRIVATE, sizeFeel: FEEL_SMALL },
        ],
      };
      expect((await put(body)).status).toBe(200);
      expect(await mine()).toEqual({
        mainUse: USE_A,
        feedback: COMMENT,
        ratings: [
          // `duration` and the earlier pain point are gone: the body had none.
          {
            slug: "mouse-a",
            satisfaction: 1,
            painPoints: [PAIN_B],
            current: false,
          },
          {
            slug: "mouse-d",
            satisfaction: 5,
            duration: DURATION_B,
            painPoints: [],
            current: false,
          },
        ],
        otherMice: [
          { brand: BRAND_PRIVATE, sizeFeel: FEEL_SMALL, current: false },
          { brand: BRAND_B, sizeFeel: FEEL_RIGHT, current: true },
        ].sort((a, b) => a.brand.localeCompare(b.brand)),
      });
    });

    it("can leave the account with NO current mouse, which a submission cannot say", async () => {
      await seedTwo();
      expect((await mine()).ratings.some((r) => r.current)).toBe(true);
      const res = await put({
        ratings: [
          { slug: "mouse-a", satisfaction: 4 },
          { slug: "mouse-c", satisfaction: 5 },
        ],
        otherMice: [{ brand: BRAND_A, sizeFeel: FEEL_SMALL }],
      });
      expect(res.status).toBe(200);
      const after = await mine();
      expect(after.ratings.every((r) => !r.current)).toBe(true);
      expect(after.otherMice.every((o) => !o.current)).toBe(true);
    });

    it("moves the current marker to exactly the one the body names, from a rating to an other mouse and back", async () => {
      await seedTwo();
      await put({
        ratings: [{ slug: "mouse-a", satisfaction: 4 }],
        otherMice: [{ brand: BRAND_A, sizeFeel: FEEL_SMALL, current: true }],
      });
      let now = await mine();
      expect(now.ratings.map((r) => r.current)).toEqual([false]);
      expect(now.otherMice.map((o) => o.current)).toEqual([true]);

      await put({
        ratings: [
          { slug: "mouse-a", satisfaction: 4 },
          { slug: "mouse-b", satisfaction: 4, current: true },
        ],
        otherMice: [{ brand: BRAND_A, sizeFeel: FEEL_SMALL }],
      });
      now = await mine();
      expect(now.ratings.map((r) => [r.slug, r.current])).toEqual([
        ["mouse-a", false],
        ["mouse-b", true],
      ]);
      expect(now.otherMice.map((o) => o.current)).toEqual([false]);
    });

    it("clears a marker that sits on a rating the body names with current false (a submission would keep it)", async () => {
      await seedTwo();
      await put({
        ratings: [{ slug: "mouse-a", satisfaction: 4, current: false }],
      });
      expect((await mine()).ratings[0]!.current).toBe(false);
    });

    it("accepts a body that names only other mice", async () => {
      await seedTwo();
      const res = await put({
        otherMice: [
          { brand: LONGEST_BRAND, sizeFeel: FEEL_RIGHT, current: true },
        ],
      });
      expect(res.status).toBe(200);
      expect(await mine()).toEqual({
        mainUse: null,
        feedback: null,
        ratings: [],
        otherMice: [
          { brand: LONGEST_BRAND, sizeFeel: FEEL_RIGHT, current: true },
        ],
      });
    });

    it("accepts the most mice an account can hold, all at once", async () => {
      await seedTwo();
      for (let i = 4; i < MAX_ACCOUNT_MICE; i++) {
        mouseIds.set(`mouse-${i}`, await world.addMouse(`mouse-${i}`));
      }
      const ratings = [...mouseIds.keys()].map((slug) => ({
        slug,
        satisfaction: 3,
      }));
      expect(ratings).toHaveLength(MAX_ACCOUNT_MICE);
      expect((await put({ ratings })).status).toBe(200);
      expect((await mine()).ratings).toHaveLength(MAX_ACCOUNT_MICE);
    });

    it("sets the main use and the comment, replaces them, and clears them when the body leaves them out", async () => {
      await seedTwo();
      await put(edit({ mainUse: USE_A, feedback: COMMENT }));
      expect(await mine()).toMatchObject({ mainUse: USE_A, feedback: COMMENT });
      await put(edit({ mainUse: USE_B, feedback: NEW_COMMENT }));
      expect(await mine()).toMatchObject({
        mainUse: USE_B,
        feedback: NEW_COMMENT,
      });
      await put(edit());
      expect(await mine()).toMatchObject({ mainUse: null, feedback: null });
    });

    it("keeps one main use for the account: on the latest contribution, emptied on the others", async () => {
      await seedTwo();
      await put(edit({ mainUse: USE_A }));
      const stored = await world.contributions();
      expect(stored.map((c) => [c.handLengthBinMm, c.mainUse])).toEqual([
        [180, null],
        [190, USE_A],
      ]);
    });

    it("writes the comment to the LATEST contribution only; an earlier contribution's comment stays as written", async () => {
      await seedTwo();
      await put(edit({ feedback: "A new comment." }));
      expect(
        (await world.contributions()).map((c) => [
          c.handLengthBinMm,
          c.feedback,
        ]),
      ).toEqual([
        [180, COMMENT],
        [190, "A new comment."],
      ]);
      await put(edit());
      expect(
        (await world.contributions()).map((c) => [
          c.handLengthBinMm,
          c.feedback,
        ]),
      ).toEqual([
        [180, COMMENT],
        [190, null],
      ]);
    });

    it("keeps a rating the person already had with the contribution (the hand profile) it was given with, and puts a new one on the latest", async () => {
      await seedTwo();
      await put({
        ratings: [
          { slug: "mouse-a", satisfaction: 1 },
          { slug: "mouse-c", satisfaction: 2 },
          { slug: "mouse-d", satisfaction: 3 },
        ],
        otherMice: [
          { brand: BRAND_A, sizeFeel: FEEL_LARGE },
          { brand: BRAND_PRIVATE, sizeFeel: FEEL_RIGHT },
        ],
      });
      expect(
        (await world.contributions()).map((c) => ({
          bin: c.handLengthBinMm,
          ratings: c.ratings.map((r) => r.slug),
          brands: c.otherMice.map((o) => o.brand).sort(),
        })),
      ).toEqual([
        { bin: 180, ratings: ["mouse-a"], brands: [BRAND_A] },
        {
          bin: 190,
          ratings: ["mouse-c", "mouse-d"],
          brands: [BRAND_PRIVATE],
        },
      ]);
    });

    it("never touches a hand profile, a grip, a consent record or a scan's mark", async () => {
      await seedTwo();
      const before = await untouched();
      expect(before.map((c) => c.gripStyle)).toEqual(["palm", "fingertip"]);
      await put({
        mainUse: USE_A,
        feedback: COMMENT,
        ratings: [{ slug: "mouse-d", satisfaction: 2, current: true }],
        otherMice: [{ brand: BRAND_PRIVATE, sizeFeel: FEEL_RIGHT }],
      });
      expect(await untouched()).toEqual(before);
    });

    it("leaves the scans' marks where they were", async () => {
      const first = await contribute("user-1", {
        day: "2026-09-01",
        handLengthMm: 181,
        ratings: [{ slug: "mouse-a", satisfaction: 4 }],
      });
      const unmarked = await world.addScan({ userId: "user-1" });
      expect(await world.scanMark(first.scanId)).toEqual(NOW);
      expect(await world.scanMark(unmarked.scanId)).toBeNull();
      await put(edit({ feedback: COMMENT }));
      expect(await world.scanMark(first.scanId)).toEqual(NOW);
      expect(await world.scanMark(unmarked.scanId)).toBeNull();
    });

    it("leaves another person's answers untouched, and an anonymous contribution too", async () => {
      await seedTwo();
      await contribute("user-2", {
        day: "2026-10-01",
        handLengthMm: 203,
        mainUse: USE_B,
        feedback: NEW_COMMENT,
        ratings: [
          { slug: "mouse-a", satisfaction: 1, current: true },
          { slug: "mouse-b", satisfaction: 2 },
        ],
        other: { brand: BRAND_A, sizeFeel: FEEL_LARGE, current: false },
      });
      await contribute(null, {
        day: "2026-10-02",
        handLengthMm: 214,
        feedback: COMMENT,
        ratings: [{ slug: "mouse-a", satisfaction: 5 }],
        other: { brand: BRAND_A, sizeFeel: FEEL_SMALL },
      });
      const others = async () =>
        (await world.contributions()).filter((c) => c.userId !== "user-1");
      const before = await others();
      expect(before).toHaveLength(2);

      expect(
        (
          await put({
            mainUse: USE_A,
            feedback: "Mine.",
            ratings: [{ slug: "mouse-d", satisfaction: 4 }],
          })
        ).status,
      ).toBe(200);
      expect(await others()).toEqual(before);

      // And the other person's edit leaves user-1's alone.
      const mineBefore = await mine();
      signedInAs = "user-2";
      expect((await put(edit({ feedback: "Theirs." }))).status).toBe(200);
      signedInAs = "user-1";
      expect(await mine()).toEqual(mineBefore);
    });

    it("round-trips: what GET returns is accepted by PUT unchanged, and GET then gives it back", async () => {
      await seedTwo();
      const first = await mine();
      const res = await put(first);
      expect(res.status).toBe(200);
      expect(await mine()).toEqual(first);
    });

    it("GET after PUT gives exactly the body, in the contract's shape", async () => {
      await seedTwo();
      const body = {
        mainUse: USE_B,
        feedback: NEW_COMMENT,
        ratings: [
          {
            slug: "mouse-b",
            satisfaction: 2,
            duration: DURATION_A,
            painPoints: [PAIN_A, PAIN_B],
            current: true,
          },
        ],
        otherMice: [{ brand: BRAND_B, sizeFeel: FEEL_SMALL, current: false }],
      };
      await put(body);
      expect(await mine()).toEqual(body);
    });

    it("is idempotent: the same body twice is the same answers", async () => {
      await seedTwo();
      const body = edit({ mainUse: USE_A, feedback: COMMENT });
      await put(body);
      const once = await world.contributions();
      expect((await put(body)).status).toBe(200);
      expect(await world.contributions()).toEqual(once);
    });

    it("two edits that overlap end as exactly the later body, in either order, with nothing of the earlier one carried over", async () => {
      // Not run concurrently: PGlite is one connection, so two batches would
      // interleave their BEGIN and COMMIT, which no two Postgres sessions can
      // do. What makes two edits at once safe is the row lock the first
      // statement takes (survey-drizzle-neon.test.ts pins it); what this proves
      // is the other half, that each edit is a whole replacement, so whichever
      // commits last leaves exactly its own body.
      const a = {
        mainUse: USE_A,
        feedback: COMMENT,
        ratings: [
          { slug: "mouse-a", satisfaction: 1, current: true },
          { slug: "mouse-b", satisfaction: 2, painPoints: [PAIN_A] },
        ],
        otherMice: [{ brand: BRAND_A, sizeFeel: FEEL_SMALL, current: false }],
      };
      const b = {
        mainUse: USE_B,
        ratings: [
          { slug: "mouse-a", satisfaction: 5, duration: DURATION_B },
          { slug: "mouse-d", satisfaction: 4 },
        ],
        otherMice: [
          { brand: BRAND_A, sizeFeel: FEEL_LARGE, current: true },
          { brand: BRAND_B, sizeFeel: FEEL_RIGHT, current: false },
        ],
      };
      const full = (body: typeof a | typeof b) =>
        surveyMineResponseSchema.parse({
          feedback: null,
          ...body,
          ratings: body.ratings.map((r) => ({
            painPoints: [],
            current: false,
            ...r,
          })),
          otherMice: [...body.otherMice].sort((x, y) =>
            x.brand.localeCompare(y.brand),
          ),
        });
      await seedTwo();
      for (const order of [
        [a, b],
        [b, a],
      ] as const) {
        for (const body of order) expect((await put(body)).status).toBe(200);
        expect(await mine()).toEqual(full(order[1]));
      }
    });

    it("is gone after the account's answers are withdrawn: a PUT is 404 and a GET is empty", async () => {
      await seedTwo();
      expect((await put(edit({ feedback: COMMENT }))).status).toBe(200);
      const res = await handleSurveyWithdrawal(
        new Request("http://localhost/api/survey", { method: "DELETE" }),
        deps(),
      );
      expect(res.status).toBe(204);
      expect((await put(edit({ feedback: COMMENT }))).status).toBe(404);
      expect(await world.contributions()).toEqual([]);
      expect(await world.rawContributionText()).not.toContain(COMMENT);
      expect(await mine()).toEqual({
        mainUse: null,
        ratings: [],
        otherMice: [],
        feedback: null,
      });
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

    it("a PUT's responses never echo the comment, the brand or the main use, at any status", async () => {
      await seedTwo();
      const answers = {
        mainUse: USE_B,
        feedback: COMMENT,
        ratings: [{ slug: "mouse-a", satisfaction: 3 }],
        otherMice: [{ brand: BRAND_PRIVATE, sizeFeel: FEEL_LARGE }],
      };
      const responses = [
        await put(answers), // 200
        await put({ ...answers, ratings: [{ slug: "nope", satisfaction: 3 }] }), // 400 unknown
        await put({ ...answers, feedback: `${COMMENT} a@b.example` }), // 400 schema
        await put({ ...answers, pad: "x".repeat(9000) }), // 413
        await handleSurveyEdit(
          request("PUT", JSON.stringify(answers)),
          deps({ limiter: { allow: async () => false } }),
        ), // 429
        await handleSurveyEdit(
          request("PUT", JSON.stringify(answers)),
          deps({ getUserId: async () => null }),
        ), // 401
      ];
      signedInAs = "user-2";
      responses.push(await put(answers)); // 404
      expect(responses.map((r) => r.status)).toEqual([
        200, 400, 400, 413, 429, 401, 404,
      ]);
      for (const res of responses) {
        expectNoStore(res);
        const text = await res.text();
        expect(text).not.toContain(COMMENT);
        expect(text).not.toContain(BRAND_PRIVATE);
        expect(text).not.toMatch(new RegExp(`"(?:${USE_B}|${FEEL_LARGE})"`));
      }
    });

    it("no log line of a GET or a PUT carries the comment, a brand, a slug or an answer, on success or on failure", async () => {
      await seedTwo();
      signedInAs = "user-1";
      await get();
      await put({
        mainUse: USE_B,
        feedback: COMMENT,
        ratings: [{ slug: "mouse-a", satisfaction: 3 }],
        otherMice: [{ brand: BRAND_PRIVATE, sizeFeel: FEEL_LARGE }],
      }); // edited
      signedInAs = "user-2";
      await put(edit({ feedback: COMMENT })); // refused: no contribution
      signedInAs = "user-1";
      await put(edit({ feedback: COMMENT }), {
        deps: {
          surveyRepo: {
            ...world.surveyRepo,
            replaceAnswers: async () => {
              // A driver error that quotes the statement and its parameters.
              throw Object.assign(
                new Error(
                  `update survey_contributions ... params: ${COMMENT}, ${BRAND_PRIVATE}, mouse-a`,
                ),
                { code: "23505" },
              );
            },
          },
        },
      }); // failed
      await get({
        deps: {
          surveyRepo: {
            ...world.surveyRepo,
            readAnswers: async () => {
              throw new Error(`select ... ${COMMENT} ${BRAND_PRIVATE}`);
            },
          },
        },
      }); // failed

      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).not.toContain(COMMENT);
        expect(line).not.toContain(BRAND_PRIVATE);
        expect(line).not.toContain("mouse-a");
        expect(line).not.toMatch(/feedback|brand|BinMm/i);
        expect(() => JSON.parse(line)).not.toThrow();
      }
      expect(lines.map((l) => JSON.parse(l).event)).toEqual(
        expect.arrayContaining([
          "survey.edited",
          "survey.edit_refused",
          "survey.failed",
        ]),
      );
    });
  });
});

describe("a PUT body at the largest size the contract allows", () => {
  it("fits within the POST body cap for the longest catalogue slug (42 characters), and the schema's own largest does not (reported in the PR)", () => {
    const painPoints = [
      "length",
      "width",
      "height",
      "weight",
      "thumb",
      "buttons",
      "other",
    ];
    const rating = (slug: string) => ({
      slug,
      satisfaction: 5,
      duration: DURATION_B,
      painPoints,
      current: false,
    });
    const body = (slugLength: number) =>
      JSON.stringify({
        mainUse: USE_B,
        feedback: "é".repeat(500),
        ratings: Array.from({ length: MAX_ACCOUNT_MICE }, (_, i) =>
          rating(`${String(i).padStart(2, "0")}${"x".repeat(slugLength - 2)}`),
        ),
        otherMice: [],
      });
    expect(Buffer.byteLength(body(42))).toBeLessThan(MAX_SURVEY_BODY_BYTES);
    // Thirty mice, each with a 100-character slug and every pain point, do not:
    // that is a body the schema accepts and the cap refuses (413).
    expect(Buffer.byteLength(body(100))).toBeGreaterThan(MAX_SURVEY_BODY_BYTES);
  });
});

describe("GET and PUT /api/survey, what only a real Postgres shows", () => {
  let world: Awaited<ReturnType<typeof createPgliteSurveyWorld>>;
  beforeAll(async () => {
    world = await createPgliteSurveyWorld();
  });
  afterAll(() => world.close());
  beforeEach(async () => {
    await world.reset();
    await world.addUser("user-1");
  });

  const deps = (): SurveyDeps => ({
    scanRepo: world.scanRepo,
    surveyRepo: world.surveyRepo,
    limiter: { allow: async () => true },
    getUserId: async () => "user-1",
    now: () => NOW,
  });
  const call = (method: "GET" | "PUT", body?: unknown) =>
    (method === "GET" ? handleSurveyRead : handleSurveyEdit)(
      new Request("http://localhost/api/survey", {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? null : JSON.stringify(body),
      }),
      deps(),
    );

  async function contribute(
    handLengthMm: number,
    day: string,
    over: { feedback?: string; mouseId: string },
  ) {
    const scan = await world.addScan({ userId: "user-1", handLengthMm });
    await world.surveyRepo.recordContribution({
      scanId: scan.scanId,
      userId: "user-1",
      consentVersion: SURVEY_CONSENT_VERSION,
      consentedAt: startOfUtcDay(new Date(`${day}T09:00:00Z`)),
      markedAt: NOW,
      handLengthBinMm: Math.floor(handLengthMm / 5) * 5,
      palmWidthBinMm: 80,
      gripStyle: "claw",
      mainUse: null,
      feedback: over.feedback ?? null,
      ratings: [
        {
          mouseId: over.mouseId,
          satisfaction: 4,
          duration: null,
          painPoints: [],
          isCurrent: false,
        },
      ],
      otherMouse: null,
    });
  }

  it("reads a rating's slug from the CURRENT mice row, and a PUT by the new slug finds the same row", async () => {
    const id = await world.addMouse("mouse-old");
    await contribute(181, "2026-10-01", { mouseId: id });
    await world.pg.query(`update mice set slug = 'mouse-new' where id = $1`, [
      id,
    ]);
    const read = await (await call("GET")).json();
    expect(read.ratings.map((r: { slug: string }) => r.slug)).toEqual([
      "mouse-new",
    ]);
    expect(
      (await call("PUT", { ratings: [{ slug: "mouse-new", satisfaction: 2 }] }))
        .status,
    ).toBe(200);
    const stored = await world.contributions();
    expect(stored[0]!.ratings).toEqual([
      expect.objectContaining({ slug: "mouse-new", satisfaction: 2 }),
    ]);
    // The old slug is not a mouse any more, so naming it is a 400.
    expect(
      (await call("PUT", { ratings: [{ slug: "mouse-old", satisfaction: 2 }] }))
        .status,
    ).toBe(400);
  });

  it("a PUT and the GET after it agree on which contribution is the latest, also when two share a consent day", async () => {
    const id = await world.addMouse("mouse-a");
    await contribute(181, "2026-10-01", { mouseId: id, feedback: "first" });
    await contribute(192, "2026-10-01", { mouseId: id, feedback: "second" });
    expect(
      (
        await call("PUT", {
          feedback: "edited",
          mainUse: USE_A,
          ratings: [{ slug: "mouse-a", satisfaction: 3 }],
        })
      ).status,
    ).toBe(200);
    const read = await (await call("GET")).json();
    expect(read.feedback).toBe("edited");
    expect(read.mainUse).toBe(USE_A);
    // Exactly one contribution took the comment, the other kept its own.
    const comments = (await world.contributions())
      .map((c) => c.feedback)
      .sort();
    expect(comments).toEqual(["edited", expect.stringMatching(/first|second/)]);
  });

  it("an edit that fails on a statement leaves the answers exactly as they were", async () => {
    const id = await world.addMouse("mouse-a");
    await contribute(181, "2026-10-01", { mouseId: id, feedback: "kept" });
    const before = await world.contributions();
    // A trigger that refuses the last statement of the batch (the update of the
    // contribution), after the deletes and upserts before it have already run.
    await world.pg.exec(`
      create function refuse_contribution_update() returns trigger language plpgsql
        as $$ begin raise exception 'refused on purpose'; end $$;
      create trigger refuse_contribution_update before update on survey_contributions
        for each row execute function refuse_contribution_update();
    `);
    try {
      const res = await call("PUT", {
        feedback: "never stored",
        ratings: [{ slug: "mouse-a", satisfaction: 1 }],
        otherMice: [{ brand: BRAND_B, sizeFeel: FEEL_LARGE }],
      });
      expect(res.status).toBe(500);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      await world.pg.exec(`
        drop trigger refuse_contribution_update on survey_contributions;
        drop function refuse_contribution_update();
      `);
    }
    expect(await world.contributions()).toEqual(before);
  });
});
