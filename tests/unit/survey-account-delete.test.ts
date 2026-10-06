/**
 * The account's "Delete everything" must withdraw the person's survey
 * contributions too (src/lib/contracts/survey.ts). `deleteAllScans` deletes
 * `scan_sessions` rows and never the `users` row, so the foreign key from a
 * contribution to the user never fires there: the contributions have to be
 * deleted by name. Run on a real Postgres (PGlite), with the real account repo
 * and the real handler, so a repo that forgets it fails here.
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

import { handleAccountDeleteAll } from "../../src/server/account/handlers";
import type { AccountRepo } from "../../src/server/account/repo";
import {
  SURVEY_CONSENT_VERSION,
  type OtherMouseBrand,
} from "../../src/lib/contracts/survey";
import {
  NOW,
  createPgliteSurveyWorld,
  withTransactionalBatch,
  type SurveyWorld,
} from "./fixtures/survey-world";
import { startOfUtcDay } from "../../src/server/survey/profile";
import { USE_A, FEEL_RIGHT, BRAND_A } from "./fixtures/survey-values";

describe("account Delete everything on a real Postgres", () => {
  let world: Awaited<ReturnType<typeof createPgliteSurveyWorld>>;
  let accountRepo: AccountRepo;

  beforeAll(async () => {
    world = await createPgliteSurveyWorld();
    const { createDrizzleAccountRepo } =
      await import("../../src/server/account/drizzle-repo");
    type AccountDb = Parameters<typeof createDrizzleAccountRepo>[0];
    accountRepo = createDrizzleAccountRepo(
      withTransactionalBatch<AccountDb>(world.pg, world.db),
    );
  });
  afterAll(() => world.close());
  beforeEach(async () => {
    await world.reset();
    await world.addUser("user-1");
    await world.addUser("user-2");
  });

  async function contribute(
    w: SurveyWorld,
    userId: string | null,
    handLengthMm: number,
    over: { feedback?: string; brand?: OtherMouseBrand } = {},
  ) {
    const mouse = await w.surveyRepo.findMouseIdsBySlug(["mouse-a"]);
    const mouseId = mouse.get("mouse-a") ?? (await w.addMouse("mouse-a"));
    const scan = await w.addScan({ userId, handLengthMm });
    const result = await w.surveyRepo.recordContribution({
      scanId: scan.scanId,
      userId,
      consentVersion: SURVEY_CONSENT_VERSION,
      consentedAt: startOfUtcDay(NOW),
      markedAt: NOW,
      handLengthBinMm: Math.floor(handLengthMm / 5) * 5,
      palmWidthBinMm: 80,
      gripStyle: "claw",
      mainUse: USE_A,
      feedback: over.feedback ?? null,
      ratings: [
        {
          mouseId,
          satisfaction: 4,
          duration: null,
          painPoints: [],
          isCurrent: false,
        },
      ],
      otherMouse: over.brand
        ? { brand: over.brand, sizeFeel: FEEL_RIGHT, isCurrent: false }
        : null,
    });
    expect(result).toBe("stored");
    return scan;
  }

  it("withdraws the person's contributions with their ratings, other mice and free text, along with their scans", async () => {
    await contribute(world, "user-1", 181, {
      feedback: "kept-only-until-delete-everything",
      brand: BRAND_A,
    });
    await contribute(world, "user-1", 192);

    const deleted = await accountRepo.deleteAllScans("user-1");

    expect(deleted).toBe(2);
    expect(await world.contributions()).toEqual([]);
    const text = await world.rawContributionText();
    expect(text).not.toContain("kept-only-until-delete-everything");
    expect(text).not.toContain(BRAND_A);
    const { rows } = await world.pg.query<{ n: number }>(
      `select count(*)::int as n from scans`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("leaves everyone else's contributions, anonymous ones included", async () => {
    await contribute(world, "user-1", 181);
    await contribute(world, "user-2", 192);
    await contribute(world, null, 203);

    await accountRepo.deleteAllScans("user-1");

    expect((await world.contributions()).map((c) => c.userId)).toEqual([
      "user-2",
      null,
    ]);
  });

  it("withdraws contributions even when the person has no scans left to delete", async () => {
    // A contribution outlives its scan (deleting a scan does not withdraw it).
    const scan = await contribute(world, "user-1", 181);
    await world.deleteScan(scan.scanId);

    expect(await accountRepo.deleteAllScans("user-1")).toBe(0);
    expect(await world.contributions()).toEqual([]);
  });

  it("is what POST-then-delete-everything does through the real handler: 200 with the scan count, and nothing of theirs left", async () => {
    await contribute(world, "user-1", 181, { feedback: "gone-after-delete" });

    const res = await handleAccountDeleteAll({
      repo: accountRepo,
      getUserId: async () => "user-1",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deletedScans: 1 });
    expect(await world.contributions()).toEqual([]);
  });

  it("does nothing for a caller who is not signed in", async () => {
    await contribute(world, "user-1", 181);
    const res = await handleAccountDeleteAll({
      repo: accountRepo,
      getUserId: async () => null,
    });
    expect(res.status).toBe(401);
    expect(await world.contributions()).toHaveLength(1);
  });
});
