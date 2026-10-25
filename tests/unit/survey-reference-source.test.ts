/**
 * The real `SurveyReferenceSource` on PGlite (a real Postgres with the repo's
 * own migrations): it returns only the caller's own ratings of catalogue mice,
 * each with the grip of its contribution, newest contribution first, and a
 * mouse rated again appears once with the latest answer. Reading changes
 * nothing.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

import { SURVEY_CONSENT_VERSION } from "../../src/lib/contracts/survey";
import { createDrizzleSurveyReferenceSource } from "../../src/server/fit/survey-reference-source";
import { startOfUtcDay } from "../../src/server/survey/profile";
import type { ContributionWrite } from "../../src/server/survey/repo";
import {
  NOW,
  createPgliteSurveyWorld,
  type WorldScan,
} from "./fixtures/survey-world";

type World = Awaited<ReturnType<typeof createPgliteSurveyWorld>>;

const DAY = 86_400_000;

const write = (
  scan: WorldScan,
  userId: string | null,
  daysAgo: number,
  over: Partial<ContributionWrite>,
): ContributionWrite => ({
  scanId: scan.scanId,
  userId,
  consentVersion: SURVEY_CONSENT_VERSION,
  consentedAt: startOfUtcDay(new Date(NOW.getTime() - daysAgo * DAY)),
  markedAt: NOW,
  handLengthBinMm: 180,
  palmWidthBinMm: 80,
  gripStyle: "claw",
  mainUse: null,
  feedback: null,
  ratings: [],
  otherMouse: null,
  ...over,
});

describe("createDrizzleSurveyReferenceSource on PGlite", () => {
  let world: World;
  let source: ReturnType<typeof createDrizzleSurveyReferenceSource>;
  let a: string;
  let b: string;
  let c: string;

  beforeAll(async () => {
    world = await createPgliteSurveyWorld();
    source = createDrizzleSurveyReferenceSource(
      world.db as Parameters<typeof createDrizzleSurveyReferenceSource>[0],
    );
  });
  afterAll(() => world.close());
  beforeEach(async () => {
    await world.reset();
    await world.addUser("user-1");
    await world.addUser("user-2");
    a = await world.addMouse("mouse-a");
    b = await world.addMouse("mouse-b");
    c = await world.addMouse("mouse-c");
  });

  const rating = (
    mouseId: string,
    satisfaction: number,
    painPoints: ("length" | "weight")[] = [],
  ) => ({
    mouseId,
    satisfaction,
    duration: null,
    painPoints,
    isCurrent: false,
  });

  it("returns the caller's catalogue ratings with their contribution's grip and pain points", async () => {
    const scan = await world.addScan({ userId: "user-1", handLengthMm: 181 });
    await world.surveyRepo.recordContribution(
      write(scan, "user-1", 0, {
        gripStyle: "fingertip",
        ratings: [rating(a, 5, ["length"]), rating(b, 2)],
        otherMouse: { brand: "razer", sizeFeel: "small", isCurrent: false },
      }),
    );

    expect(await source.loadRatings("user-1")).toEqual([
      {
        slug: "mouse-a",
        satisfaction: 5,
        painPoints: ["length"],
        gripStyle: "fingertip",
      },
      {
        slug: "mouse-b",
        satisfaction: 2,
        painPoints: [],
        gripStyle: "fingertip",
      },
    ]);
  });

  it("never returns another person's or an anonymous rating", async () => {
    const own = await world.addScan({ userId: "user-1", handLengthMm: 181 });
    const other = await world.addScan({ userId: "user-2", handLengthMm: 182 });
    const anon = await world.addScan({ handLengthMm: 183 });
    await world.surveyRepo.recordContribution(
      write(own, "user-1", 0, { ratings: [rating(a, 4)] }),
    );
    await world.surveyRepo.recordContribution(
      write(other, "user-2", 0, { ratings: [rating(b, 5)] }),
    );
    await world.surveyRepo.recordContribution(
      write(anon, null, 0, { ratings: [rating(c, 5)] }),
    );

    expect((await source.loadRatings("user-1")).map((r) => r.slug)).toEqual([
      "mouse-a",
    ]);
    expect(await source.loadRatings("nobody")).toEqual([]);
  });

  it("newest contribution first; a mouse rated again appears once, with the latest answer and its grip", async () => {
    const first = await world.addScan({ userId: "user-1", handLengthMm: 181 });
    const second = await world.addScan({ userId: "user-1", handLengthMm: 182 });
    await world.surveyRepo.recordContribution(
      write(first, "user-1", 10, {
        gripStyle: "palm",
        ratings: [rating(a, 2), rating(b, 4)],
      }),
    );
    await world.surveyRepo.recordContribution(
      write(second, "user-1", 1, {
        gripStyle: "claw",
        ratings: [rating(a, 5), rating(c, 4)],
      }),
    );

    const rows = await source.loadRatings("user-1");
    expect(rows.map((r) => [r.slug, r.satisfaction, r.gripStyle])).toEqual([
      ["mouse-a", 5, "claw"],
      ["mouse-c", 4, "claw"],
      ["mouse-b", 4, "palm"],
    ]);
  });

  it("reads only: the tables are unchanged afterwards", async () => {
    const scan = await world.addScan({ userId: "user-1", handLengthMm: 181 });
    await world.surveyRepo.recordContribution(
      write(scan, "user-1", 0, { ratings: [rating(a, 5)] }),
    );
    const before = await world.rawContributionText();
    await source.loadRatings("user-1");
    expect(await world.rawContributionText()).toBe(before);
  });
});
