/**
 * The survey repo's behaviour, as one matrix run against the in-memory fake and
 * against the real drizzle repo on PGlite (a real Postgres with the repo's own
 * migrations): one contribution per scan, a signed-in person's repeat rules
 * (replace a rating, move the current marker, replace main use, replace an
 * other mouse by its brand slug), anonymous contributions that replace nothing,
 * withdrawal, and, on PGlite only, that a failed write leaves nothing behind.
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
import { startOfUtcDay } from "../../src/server/survey/profile";
import type {
  ContributionRating,
  ContributionWrite,
} from "../../src/server/survey/repo";
import {
  NOW,
  createFakeSurveyWorld,
  createPgliteSurveyWorld,
  type SurveyWorld,
  type WorldScan,
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
  BRAND_OTHER,
} from "./fixtures/survey-values";

const aWrite = (
  scan: WorldScan,
  over: Partial<ContributionWrite> = {},
): ContributionWrite => ({
  scanId: scan.scanId,
  userId: null,
  consentVersion: SURVEY_CONSENT_VERSION,
  consentedAt: startOfUtcDay(NOW),
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

const rate = (
  mouseId: string,
  satisfaction = 4,
  over: Partial<ContributionRating> = {},
): ContributionRating => ({
  mouseId,
  satisfaction,
  duration: null,
  painPoints: [],
  isCurrent: false,
  ...over,
});

const worlds: [string, () => Promise<SurveyWorld>][] = [
  ["in-memory fakes", async () => createFakeSurveyWorld()],
  ["real repos on PGlite", createPgliteSurveyWorld],
];

describe.each(worlds)("survey repo on %s", (_name, make) => {
  let world: SurveyWorld;
  let mouseA: string;
  let mouseB: string;
  let mouseC: string;

  beforeAll(async () => {
    world = await make();
  });
  afterAll(() => world.close());
  beforeEach(async () => {
    await world.reset();
    await world.addUser("user-1");
    await world.addUser("user-2");
    mouseA = await world.addMouse("mouse-a");
    mouseB = await world.addMouse("mouse-b");
    mouseC = await world.addMouse("mouse-c");
  });

  const ratingsOf = async (userId: string) =>
    (await world.contributions())
      .filter((c) => c.userId === userId)
      .flatMap((c) => c.ratings);

  describe("recordContribution", () => {
    it("stores the contribution, its ratings and its other mouse, and marks the scan with the exact instant", async () => {
      const scan = await world.addScan();
      const result = await world.surveyRepo.recordContribution(
        aWrite(scan, {
          mainUse: USE_B,
          feedback: "Too light for me.",
          ratings: [
            rate(mouseA, 5, {
              duration: DURATION_A,
              painPoints: [PAIN_A, PAIN_B],
              isCurrent: true,
            }),
            rate(mouseB, 2),
          ],
          otherMouse: {
            brand: BRAND_A,
            sizeFeel: FEEL_SMALL,
            isCurrent: false,
          },
        }),
      );
      expect(result).toBe("stored");
      expect(await world.scanMark(scan.scanId)).toEqual(NOW);

      const [stored, ...rest] = await world.contributions();
      expect(rest).toEqual([]);
      expect(stored).toEqual({
        userId: null,
        consentVersion: SURVEY_CONSENT_VERSION,
        // The day, not the instant: the instant is on the scan's mark only.
        consentedAt: new Date("2026-10-06T00:00:00.000Z"),
        handLengthBinMm: 180,
        palmWidthBinMm: 80,
        gripStyle: "claw",
        mainUse: USE_B,
        feedback: "Too light for me.",
        ratings: [
          {
            slug: "mouse-a",
            satisfaction: 5,
            duration: DURATION_A,
            painPoints: [PAIN_A, PAIN_B],
            isCurrent: true,
            userId: null,
          },
          {
            slug: "mouse-b",
            satisfaction: 2,
            duration: null,
            painPoints: [],
            isCurrent: false,
            userId: null,
          },
        ],
        otherMice: [
          {
            brand: BRAND_A,
            sizeFeel: FEEL_SMALL,
            isCurrent: false,
            userId: null,
          },
        ],
      });
    });

    it("holds no scan id and no session id anywhere in what it stores", async () => {
      const scan = await world.addScan();
      await world.surveyRepo.recordContribution(
        aWrite(scan, { ratings: [rate(mouseA)] }),
      );
      const text = await world.rawContributionText();
      expect(text).not.toContain(scan.scanId);
      expect(text).not.toContain(scan.sessionId);
      expect(text).not.toContain(NOW.toISOString());
    });

    it("refuses a second contribution for the same scan and changes nothing, replaces nothing", async () => {
      const first = await world.addScan({
        userId: "user-1",
        handLengthMm: 181,
      });
      const second = await world.addScan({
        userId: "user-1",
        handLengthMm: 192,
      });
      // The first contribution carries a current marker on a catalogue mouse
      // AND on an other mouse: the body schema allows only one marker per body,
      // but the repo does not enforce it, so one write seeds both kinds, and the
      // retry below has a marker of each kind to (wrongly) take away.
      await world.surveyRepo.recordContribution(
        aWrite(first, {
          userId: "user-1",
          mainUse: USE_A,
          ratings: [rate(mouseA, 5, { isCurrent: true })],
          otherMouse: {
            brand: BRAND_A,
            sizeFeel: FEEL_SMALL,
            isCurrent: true,
          },
        }),
      );
      await world.surveyRepo.recordContribution(
        aWrite(second, {
          userId: "user-1",
          handLengthBinMm: 190,
          ratings: [rate(mouseB, 3)],
        }),
      );
      const before = await world.contributions();
      expect(before[0]).toMatchObject({
        ratings: [
          expect.objectContaining({ slug: "mouse-a", isCurrent: true }),
        ],
        otherMice: [
          expect.objectContaining({ brand: BRAND_A, isCurrent: true }),
        ],
      });

      // Retrying the first scan, with answers that WOULD replace the earlier
      // ones (same mouse, a new main use, a new current mouse, a new brand) and
      // that, if they got as far as the clearing statements, would move both
      // current markers.
      const retry = await world.surveyRepo.recordContribution(
        aWrite(first, {
          userId: "user-1",
          mainUse: USE_B,
          feedback: "again",
          ratings: [rate(mouseA, 1), rate(mouseC, 2, { isCurrent: true })],
          otherMouse: {
            brand: BRAND_OTHER,
            sizeFeel: FEEL_RIGHT,
            isCurrent: false,
          },
        }),
      );
      expect(retry).toBe("already_contributed");
      expect(await world.contributions()).toEqual(before);
    });

    it("stores two anonymous contributions from two different scans, both rating the same mouse", async () => {
      const one = await world.addScan({ handLengthMm: 181 });
      const two = await world.addScan({ handLengthMm: 192 });
      expect(
        await world.surveyRepo.recordContribution(
          aWrite(one, { handLengthBinMm: 180, ratings: [rate(mouseA, 5)] }),
        ),
      ).toBe("stored");
      expect(
        await world.surveyRepo.recordContribution(
          aWrite(two, { handLengthBinMm: 190, ratings: [rate(mouseA, 1)] }),
        ),
      ).toBe("stored");
      const stored = await world.contributions();
      expect(stored.map((c) => c.ratings.map((r) => r.satisfaction))).toEqual([
        [5],
        [1],
      ]);
      expect(await world.scanMark(one.scanId)).toEqual(NOW);
      expect(await world.scanMark(two.scanId)).toEqual(NOW);
    });

    it("never replaces anything for an anonymous contribution, even next to a signed-in one", async () => {
      const mine = await world.addScan({ userId: "user-1", handLengthMm: 181 });
      const anon = await world.addScan({ handLengthMm: 192 });
      await world.surveyRepo.recordContribution(
        aWrite(mine, {
          userId: "user-1",
          mainUse: USE_A,
          ratings: [rate(mouseA, 5, { isCurrent: true })],
          otherMouse: {
            brand: BRAND_A,
            sizeFeel: FEEL_RIGHT,
            isCurrent: false,
          },
        }),
      );
      await world.surveyRepo.recordContribution(
        aWrite(anon, {
          handLengthBinMm: 190,
          mainUse: USE_B,
          ratings: [rate(mouseA, 1, { isCurrent: true })],
          // The very same slug as the signed-in person's: an anonymous
          // contribution replaces nothing, so both stay.
          otherMouse: {
            brand: BRAND_A,
            sizeFeel: FEEL_LARGE,
            isCurrent: true,
          },
        }),
      );
      const [first, second] = await world.contributions();
      expect(first!.mainUse).toBe(USE_A);
      expect(first!.ratings[0]).toMatchObject({
        satisfaction: 5,
        isCurrent: true,
      });
      expect(first!.otherMice).toEqual([
        expect.objectContaining({ brand: BRAND_A, sizeFeel: FEEL_RIGHT }),
      ]);
      expect(second!.ratings[0]).toMatchObject({
        satisfaction: 1,
        userId: null,
      });
      expect(second!.otherMice).toEqual([
        expect.objectContaining({ brand: BRAND_A, sizeFeel: FEEL_LARGE }),
      ]);
    });

    it("says the scan is gone when it no longer exists, and stores nothing", async () => {
      const scan = await world.addScan();
      await world.deleteScan(scan.scanId);
      const result = await world.surveyRepo.recordContribution(
        aWrite(scan, { ratings: [rate(mouseA)] }),
      );
      expect(result).toBe("scan_gone");
      expect(await world.contributions()).toEqual([]);
    });
  });

  describe("a signed-in person's repeat rules", () => {
    it("replaces their earlier rating of the same mouse, keeps their other ratings, and leaves other people's alone", async () => {
      const s1 = await world.addScan({ userId: "user-1", handLengthMm: 181 });
      const s2 = await world.addScan({ userId: "user-1", handLengthMm: 192 });
      const theirs = await world.addScan({
        userId: "user-2",
        handLengthMm: 203,
      });
      await world.surveyRepo.recordContribution(
        aWrite(s1, {
          userId: "user-1",
          ratings: [rate(mouseA, 5), rate(mouseB, 4)],
        }),
      );
      await world.surveyRepo.recordContribution(
        aWrite(theirs, {
          userId: "user-2",
          handLengthBinMm: 200,
          ratings: [rate(mouseA, 2)],
        }),
      );

      const result = await world.surveyRepo.recordContribution(
        aWrite(s2, {
          userId: "user-1",
          handLengthBinMm: 190,
          ratings: [rate(mouseA, 1), rate(mouseC, 3)],
        }),
      );
      expect(result).toBe("stored");

      const mine = await ratingsOf("user-1");
      expect(mine.map((r) => [r.slug, r.satisfaction]).sort()).toEqual([
        ["mouse-a", 1],
        ["mouse-b", 4],
        ["mouse-c", 3],
      ]);
      expect(await ratingsOf("user-2")).toEqual([
        expect.objectContaining({ slug: "mouse-a", satisfaction: 2 }),
      ]);
    });

    it("replaces the whole earlier rating of a mouse: a duration or pain points the new one leaves out are gone, not kept", async () => {
      const s = await Promise.all(
        [181, 192, 203].map((h) =>
          world.addScan({ userId: "user-1", handLengthMm: h }),
        ),
      );
      const ofMouseA = async () =>
        (await ratingsOf("user-1")).filter((r) => r.slug === "mouse-a");

      await world.surveyRepo.recordContribution(
        aWrite(s[0]!, {
          userId: "user-1",
          ratings: [
            rate(mouseA, 5, {
              duration: DURATION_A,
              painPoints: [PAIN_A, PAIN_B],
            }),
          ],
        }),
      );
      expect(await ofMouseA()).toEqual([
        expect.objectContaining({
          satisfaction: 5,
          duration: DURATION_A,
          painPoints: [PAIN_A, PAIN_B],
        }),
      ]);

      // A different satisfaction and pain points, and NO duration: the stored
      // duration becomes null (the earlier one is not merged in).
      await world.surveyRepo.recordContribution(
        aWrite(s[1]!, {
          userId: "user-1",
          handLengthBinMm: 190,
          ratings: [rate(mouseA, 2, { painPoints: [PAIN_B] })],
        }),
      );
      expect(await ofMouseA()).toEqual([
        expect.objectContaining({
          satisfaction: 2,
          duration: null,
          painPoints: [PAIN_B],
        }),
      ]);

      // And the other way round: a duration given, no pain points.
      await world.surveyRepo.recordContribution(
        aWrite(s[2]!, {
          userId: "user-1",
          handLengthBinMm: 200,
          ratings: [rate(mouseA, 3, { duration: DURATION_B })],
        }),
      );
      expect(await ofMouseA()).toEqual([
        expect.objectContaining({
          satisfaction: 3,
          duration: DURATION_B,
          painPoints: [],
        }),
      ]);
    });

    it("moves the current marker: a later current replaces it, a later none leaves it", async () => {
      const s = await Promise.all(
        [181, 192, 203].map((h) =>
          world.addScan({ userId: "user-1", handLengthMm: h }),
        ),
      );
      const current = async () =>
        (await ratingsOf("user-1"))
          .filter((r) => r.isCurrent)
          .map((r) => r.slug);

      await world.surveyRepo.recordContribution(
        aWrite(s[0]!, {
          userId: "user-1",
          ratings: [rate(mouseA, 4, { isCurrent: true })],
        }),
      );
      expect(await current()).toEqual(["mouse-a"]);

      await world.surveyRepo.recordContribution(
        aWrite(s[1]!, {
          userId: "user-1",
          handLengthBinMm: 190,
          ratings: [rate(mouseB, 3, { isCurrent: true })],
        }),
      );
      expect(await current()).toEqual(["mouse-b"]);

      await world.surveyRepo.recordContribution(
        aWrite(s[2]!, {
          userId: "user-1",
          handLengthBinMm: 200,
          ratings: [rate(mouseC, 2)],
        }),
      );
      expect(await current()).toEqual(["mouse-b"]);
    });

    it("keeps one current mouse across ratings and other mice, in either direction", async () => {
      const s = await Promise.all(
        [181, 192, 203].map((h) =>
          world.addScan({ userId: "user-1", handLengthMm: h }),
        ),
      );
      const currentOthers = async () =>
        (await world.contributions())
          .filter((c) => c.userId === "user-1")
          .flatMap((c) => c.otherMice)
          .filter((o) => o.isCurrent)
          .map((o) => o.brand);
      const currentRatings = async () =>
        (await ratingsOf("user-1"))
          .filter((r) => r.isCurrent)
          .map((r) => r.slug);

      await world.surveyRepo.recordContribution(
        aWrite(s[0]!, {
          userId: "user-1",
          ratings: [rate(mouseA, 4, { isCurrent: true })],
        }),
      );
      // An other mouse that is current moves the marker off the catalogue mouse.
      await world.surveyRepo.recordContribution(
        aWrite(s[1]!, {
          userId: "user-1",
          handLengthBinMm: 190,
          otherMouse: {
            brand: BRAND_A,
            sizeFeel: FEEL_RIGHT,
            isCurrent: true,
          },
        }),
      );
      expect(await currentRatings()).toEqual([]);
      expect(await currentOthers()).toEqual([BRAND_A]);
      // And a catalogue mouse that is current moves it back.
      await world.surveyRepo.recordContribution(
        aWrite(s[2]!, {
          userId: "user-1",
          handLengthBinMm: 200,
          ratings: [rate(mouseB, 5, { isCurrent: true })],
        }),
      );
      expect(await currentRatings()).toEqual(["mouse-b"]);
      expect(await currentOthers()).toEqual([]);
    });

    it("replaces main use with the latest answer, and keeps it when a later body gives none", async () => {
      const s = await Promise.all(
        [181, 192, 203].map((h) =>
          world.addScan({ userId: "user-1", handLengthMm: h }),
        ),
      );
      const mainUses = async () =>
        (await world.contributions())
          .filter((c) => c.userId === "user-1")
          .map((c) => c.mainUse)
          .filter((u) => u !== null);

      await world.surveyRepo.recordContribution(
        aWrite(s[0]!, {
          userId: "user-1",
          mainUse: USE_A,
          ratings: [rate(mouseA)],
        }),
      );
      await world.surveyRepo.recordContribution(
        aWrite(s[1]!, {
          userId: "user-1",
          handLengthBinMm: 190,
          mainUse: USE_B,
          ratings: [rate(mouseB)],
        }),
      );
      expect(await mainUses()).toEqual([USE_B]);

      await world.surveyRepo.recordContribution(
        aWrite(s[2]!, {
          userId: "user-1",
          handLengthBinMm: 200,
          ratings: [rate(mouseC)],
        }),
      );
      expect(await mainUses()).toEqual([USE_B]);
    });

    it("replaces an other mouse with the same brand slug, and adds a new slug", async () => {
      const s = await Promise.all(
        [181, 192, 203].map((h) =>
          world.addScan({ userId: "user-1", handLengthMm: h }),
        ),
      );
      const others = async () =>
        (await world.contributions())
          .filter((c) => c.userId === "user-1")
          .flatMap((c) => c.otherMice)
          .map((o) => [o.brand, o.sizeFeel])
          .sort();

      await world.surveyRepo.recordContribution(
        aWrite(s[0]!, {
          userId: "user-1",
          otherMouse: {
            brand: BRAND_A,
            sizeFeel: FEEL_SMALL,
            isCurrent: false,
          },
        }),
      );
      await world.surveyRepo.recordContribution(
        aWrite(s[1]!, {
          userId: "user-1",
          handLengthBinMm: 190,
          otherMouse: {
            brand: BRAND_A,
            sizeFeel: FEEL_RIGHT,
            isCurrent: false,
          },
        }),
      );
      expect(await others()).toEqual([[BRAND_A, FEEL_RIGHT]]);

      await world.surveyRepo.recordContribution(
        aWrite(s[2]!, {
          userId: "user-1",
          handLengthBinMm: 200,
          otherMouse: {
            brand: BRAND_B,
            sizeFeel: FEEL_LARGE,
            isCurrent: false,
          },
        }),
      );
      expect(await others()).toEqual(
        [
          [BRAND_B, FEEL_LARGE],
          [BRAND_A, FEEL_RIGHT],
        ].sort(),
      );
    });

    it("keeps at most one answer for 'other': every brand that is not listed is the same slug", async () => {
      const s = await Promise.all(
        [181, 192, 203].map((h) =>
          world.addScan({ userId: "user-1", handLengthMm: h }),
        ),
      );
      const others = async () =>
        (await world.contributions())
          .filter((c) => c.userId === "user-1")
          .flatMap((c) => c.otherMice)
          .map((o) => [o.brand, o.sizeFeel])
          .sort();

      await world.surveyRepo.recordContribution(
        aWrite(s[0]!, {
          userId: "user-1",
          otherMouse: {
            brand: BRAND_OTHER,
            sizeFeel: FEEL_SMALL,
            isCurrent: false,
          },
        }),
      );
      await world.surveyRepo.recordContribution(
        aWrite(s[1]!, {
          userId: "user-1",
          handLengthBinMm: 190,
          otherMouse: {
            brand: BRAND_OTHER,
            sizeFeel: FEEL_LARGE,
            isCurrent: false,
          },
        }),
      );
      expect(await others()).toEqual([[BRAND_OTHER, FEEL_LARGE]]);

      // A listed brand is a different slug: it is added, not a replacement.
      await world.surveyRepo.recordContribution(
        aWrite(s[2]!, {
          userId: "user-1",
          handLengthBinMm: 200,
          otherMouse: {
            brand: BRAND_A,
            sizeFeel: FEEL_RIGHT,
            isCurrent: false,
          },
        }),
      );
      expect(await others()).toEqual(
        [
          [BRAND_A, FEEL_RIGHT],
          [BRAND_OTHER, FEEL_LARGE],
        ].sort(),
      );
    });

    it("compares brand slugs exactly: no case-folding or trimming survives from the free-text days", async () => {
      // The body schema only lets a listed slug through, so this is the
      // repo-level pin that a value is stored and compared as given.
      const s = await Promise.all(
        [181, 192].map((h) =>
          world.addScan({ userId: "user-1", handLengthMm: h }),
        ),
      );
      const brands = async () =>
        (await world.contributions())
          .filter((c) => c.userId === "user-1")
          .flatMap((c) => c.otherMice)
          .map((o) => o.brand)
          .sort();
      await world.surveyRepo.recordContribution(
        aWrite(s[0]!, {
          userId: "user-1",
          otherMouse: {
            brand: BRAND_A,
            sizeFeel: FEEL_SMALL,
            isCurrent: false,
          },
        }),
      );
      await world.surveyRepo.recordContribution(
        aWrite(s[1]!, {
          userId: "user-1",
          handLengthBinMm: 190,
          otherMouse: {
            brand: BRAND_A.toUpperCase() as typeof BRAND_A,
            sizeFeel: FEEL_RIGHT,
            isCurrent: false,
          },
        }),
      );
      expect(await brands()).toEqual([BRAND_A.toUpperCase(), BRAND_A].sort());
    });

    describe("a later body that marks no mouse as current leaves the marker where it was", () => {
      const scans = async () =>
        Promise.all(
          [181, 192].map((h) =>
            world.addScan({ userId: "user-1", handLengthMm: h }),
          ),
        );
      const currentRatings = async () =>
        (await ratingsOf("user-1"))
          .filter((r) => r.isCurrent)
          .map((r) => r.slug);
      const currentOthers = async () =>
        (await world.contributions())
          .filter((c) => c.userId === "user-1")
          .flatMap((c) => c.otherMice)
          .filter((o) => o.isCurrent)
          .map((o) => o.brand);

      it("also when it re-rates the very mouse that carries the marker", async () => {
        const s = await scans();
        await world.surveyRepo.recordContribution(
          aWrite(s[0]!, {
            userId: "user-1",
            ratings: [rate(mouseA, 5, { isCurrent: true })],
          }),
        );
        await world.surveyRepo.recordContribution(
          aWrite(s[1]!, {
            userId: "user-1",
            handLengthBinMm: 190,
            // A is replaced (its satisfaction changes) and not re-ticked; B is new.
            ratings: [rate(mouseA, 2), rate(mouseB, 3)],
          }),
        );
        expect(await currentRatings()).toEqual(["mouse-a"]);
        expect(
          (await ratingsOf("user-1"))
            .map((r) => [r.slug, r.satisfaction])
            .sort(),
        ).toEqual([
          ["mouse-a", 2],
          ["mouse-b", 3],
        ]);
      });

      it("also when it gives the same brand slug as the other mouse that carries the marker", async () => {
        const s = await scans();
        await world.surveyRepo.recordContribution(
          aWrite(s[0]!, {
            userId: "user-1",
            otherMouse: {
              brand: BRAND_A,
              sizeFeel: FEEL_SMALL,
              isCurrent: true,
            },
          }),
        );
        await world.surveyRepo.recordContribution(
          aWrite(s[1]!, {
            userId: "user-1",
            handLengthBinMm: 190,
            otherMouse: {
              brand: BRAND_A,
              sizeFeel: FEEL_LARGE,
              isCurrent: false,
            },
          }),
        );
        expect(await currentOthers()).toEqual([BRAND_A]);
        expect(
          (await world.contributions())
            .flatMap((c) => c.otherMice)
            .map((o) => o.sizeFeel),
        ).toEqual([FEEL_LARGE]);
      });

      it("but a later body that marks another mouse takes it, even when it re-rates the marked one", async () => {
        const s = await scans();
        await world.surveyRepo.recordContribution(
          aWrite(s[0]!, {
            userId: "user-1",
            ratings: [rate(mouseA, 5, { isCurrent: true })],
          }),
        );
        await world.surveyRepo.recordContribution(
          aWrite(s[1]!, {
            userId: "user-1",
            handLengthBinMm: 190,
            ratings: [rate(mouseA, 2), rate(mouseB, 3, { isCurrent: true })],
          }),
        );
        expect(await currentRatings()).toEqual(["mouse-b"]);
      });

      it("and a body that re-ticks the same mouse leaves exactly one marker", async () => {
        const s = await scans();
        await world.surveyRepo.recordContribution(
          aWrite(s[0]!, {
            userId: "user-1",
            ratings: [rate(mouseA, 5, { isCurrent: true })],
          }),
        );
        await world.surveyRepo.recordContribution(
          aWrite(s[1]!, {
            userId: "user-1",
            handLengthBinMm: 190,
            ratings: [rate(mouseA, 3, { isCurrent: true })],
          }),
        );
        expect(await currentRatings()).toEqual(["mouse-a"]);
      });

      it("and a marker on a catalogue mouse survives a body that gives only an unmarked other mouse", async () => {
        const s = await scans();
        await world.surveyRepo.recordContribution(
          aWrite(s[0]!, {
            userId: "user-1",
            ratings: [rate(mouseA, 5, { isCurrent: true })],
          }),
        );
        await world.surveyRepo.recordContribution(
          aWrite(s[1]!, {
            userId: "user-1",
            handLengthBinMm: 190,
            otherMouse: {
              brand: BRAND_B,
              sizeFeel: FEEL_RIGHT,
              isCurrent: false,
            },
          }),
        );
        expect(await currentRatings()).toEqual(["mouse-a"]);
        expect(await currentOthers()).toEqual([]);
      });
    });

    it("moves only its own markers and main use: another signed-in person's are untouched by a write that moves the same kinds", async () => {
      const mine1 = await world.addScan({
        userId: "user-1",
        handLengthMm: 181,
      });
      const theirs = await world.addScan({
        userId: "user-2",
        handLengthMm: 192,
      });
      const mine2 = await world.addScan({
        userId: "user-1",
        handLengthMm: 203,
      });

      // user-2 holds all three things the repeat rules move: a current rating,
      // a current other mouse (the repo does not enforce the body schema's
      // one-marker rule, so one write seeds both kinds) and a main use.
      await world.surveyRepo.recordContribution(
        aWrite(theirs, {
          userId: "user-2",
          handLengthBinMm: 190,
          mainUse: USE_A,
          ratings: [rate(mouseA, 5, { isCurrent: true })],
          otherMouse: {
            brand: BRAND_A,
            sizeFeel: FEEL_RIGHT,
            isCurrent: true,
          },
        }),
      );
      const theirsBefore = async () =>
        (await world.contributions()).filter((c) => c.userId === "user-2");
      const held = await theirsBefore();
      expect(held).toEqual([
        expect.objectContaining({
          mainUse: USE_A,
          ratings: [
            expect.objectContaining({ slug: "mouse-a", isCurrent: true }),
          ],
          otherMice: [
            expect.objectContaining({ brand: BRAND_A, isCurrent: true }),
          ],
        }),
      ]);

      // user-1 gives their own, then a second submission that moves a current
      // rating, a current other mouse and the main use. Each of the three
      // clearing statements has user-1's own rows to move here, so a statement
      // that is not limited to user-1 would reach user-2's rows as well.
      await world.surveyRepo.recordContribution(
        aWrite(mine1, {
          userId: "user-1",
          mainUse: USE_A,
          ratings: [rate(mouseC, 4, { isCurrent: true })],
          otherMouse: {
            brand: BRAND_B,
            sizeFeel: FEEL_SMALL,
            isCurrent: true,
          },
        }),
      );
      await world.surveyRepo.recordContribution(
        aWrite(mine2, {
          userId: "user-1",
          handLengthBinMm: 200,
          mainUse: USE_B,
          ratings: [rate(mouseB, 3, { isCurrent: true })],
          otherMouse: {
            brand: BRAND_OTHER,
            sizeFeel: FEEL_LARGE,
            isCurrent: true,
          },
        }),
      );

      // user-1's own moved...
      const user1 = (await world.contributions()).filter(
        (c) => c.userId === "user-1",
      );
      expect(user1.map((c) => c.mainUse).filter((u) => u !== null)).toEqual([
        USE_B,
      ]);
      expect(
        user1.flatMap((c) => c.ratings).filter((r) => r.isCurrent),
      ).toEqual([expect.objectContaining({ slug: "mouse-b" })]);
      expect(
        user1.flatMap((c) => c.otherMice).filter((o) => o.isCurrent),
      ).toEqual([expect.objectContaining({ brand: BRAND_OTHER })]);
      // ...and user-2's did not move at all.
      expect(await theirsBefore()).toEqual(held);
    });

    it("keeps every comment as written", async () => {
      const s = await Promise.all(
        [181, 192].map((h) =>
          world.addScan({ userId: "user-1", handLengthMm: h }),
        ),
      );
      await world.surveyRepo.recordContribution(
        aWrite(s[0]!, {
          userId: "user-1",
          feedback: "first",
          ratings: [rate(mouseA)],
        }),
      );
      await world.surveyRepo.recordContribution(
        aWrite(s[1]!, {
          userId: "user-1",
          handLengthBinMm: 190,
          feedback: "second",
          ratings: [rate(mouseA)],
        }),
      );
      expect(
        (await world.contributions()).map((c) => c.feedback).sort(),
      ).toEqual(["first", "second"]);
    });
  });

  describe("withdrawContributions", () => {
    it("deletes only that person's contributions with their ratings and other mice, and leaves the marks on their scans", async () => {
      const mine = await world.addScan({ userId: "user-1", handLengthMm: 181 });
      const theirs = await world.addScan({
        userId: "user-2",
        handLengthMm: 192,
      });
      const anon = await world.addScan({ handLengthMm: 203 });
      await world.surveyRepo.recordContribution(
        aWrite(mine, {
          userId: "user-1",
          feedback: "written-by-user-one",
          ratings: [rate(mouseA)],
          otherMouse: {
            brand: BRAND_A,
            sizeFeel: FEEL_RIGHT,
            isCurrent: false,
          },
        }),
      );
      await world.surveyRepo.recordContribution(
        aWrite(theirs, {
          userId: "user-2",
          handLengthBinMm: 190,
          ratings: [rate(mouseA)],
        }),
      );
      await world.surveyRepo.recordContribution(
        aWrite(anon, { handLengthBinMm: 200, ratings: [rate(mouseB)] }),
      );

      expect(await world.surveyRepo.withdrawContributions("user-1")).toBe(1);

      const left = await world.contributions();
      expect(left.map((c) => c.userId)).toEqual(["user-2", null]);
      expect(left.flatMap((c) => c.otherMice)).toEqual([]);
      expect(await world.rawContributionText()).not.toContain(
        "written-by-user-one",
      );
      // A mark says the scan contributed once; it is not a contribution.
      expect(await world.scanMark(mine.scanId)).toEqual(NOW);
    });

    it("is a no-op that reports zero when there is nothing to withdraw", async () => {
      expect(await world.surveyRepo.withdrawContributions("user-1")).toBe(0);
    });

    it("withdraws everything from several submissions at once", async () => {
      const s = await Promise.all(
        [181, 192].map((h) =>
          world.addScan({ userId: "user-1", handLengthMm: h }),
        ),
      );
      await world.surveyRepo.recordContribution(
        aWrite(s[0]!, { userId: "user-1", ratings: [rate(mouseA)] }),
      );
      await world.surveyRepo.recordContribution(
        aWrite(s[1]!, {
          userId: "user-1",
          handLengthBinMm: 190,
          ratings: [rate(mouseB)],
        }),
      );
      expect(await world.surveyRepo.withdrawContributions("user-1")).toBe(2);
      expect(await world.contributions()).toEqual([]);
    });
  });

  describe("findMouseIdsBySlug", () => {
    it("returns the catalogue slugs that exist and leaves out the ones that do not", async () => {
      const found = await world.surveyRepo.findMouseIdsBySlug([
        "mouse-a",
        "nope",
        "mouse-c",
      ]);
      expect(Object.fromEntries(found)).toEqual({
        "mouse-a": mouseA,
        "mouse-c": mouseC,
      });
      expect((await world.surveyRepo.findMouseIdsBySlug([])).size).toBe(0);
    });
  });
});

describe("the real repo on PGlite: all or nothing", () => {
  let world: Awaited<ReturnType<typeof createPgliteSurveyWorld>>;
  beforeAll(async () => {
    world = await createPgliteSurveyWorld();
  });
  afterAll(() => world.close());
  beforeEach(async () => {
    await world.reset();
    await world.addUser("user-1");
  });

  it("leaves nothing and no mark when a write fails half-way, and keeps what the person had before", async () => {
    const mouseA = await world.addMouse("mouse-a");
    const first = await world.addScan({ userId: "user-1", handLengthMm: 181 });
    const second = await world.addScan({ userId: "user-1", handLengthMm: 192 });
    await world.surveyRepo.recordContribution(
      aWrite(first, {
        userId: "user-1",
        mainUse: USE_A,
        ratings: [rate(mouseA, 5, { isCurrent: true })],
      }),
    );
    const before = await world.contributions();

    // Valid rating of mouse A (which would replace the earlier one and move
    // "current"), then a rating of a mouse that does not exist: the contribution
    // row and the replacing statements have already run when this one fails.
    const ghost = "20000000-0000-4000-8000-0000000000ff";
    await expect(
      world.surveyRepo.recordContribution(
        aWrite(second, {
          userId: "user-1",
          handLengthBinMm: 190,
          mainUse: USE_B,
          ratings: [rate(mouseA, 1, { isCurrent: true }), rate(ghost, 3)],
        }),
      ),
    ).rejects.toThrow();

    expect(await world.scanMark(second.scanId)).toBeNull();
    expect(await world.contributions()).toEqual(before);
    expect(await ratingsOfWorld(world, "user-1")).toEqual([
      expect.objectContaining({
        slug: "mouse-a",
        satisfaction: 5,
        isCurrent: true,
      }),
    ]);

    // The scan is free to try again.
    await expect(
      world.surveyRepo.recordContribution(
        aWrite(second, {
          userId: "user-1",
          handLengthBinMm: 190,
          ratings: [rate(mouseA, 2)],
        }),
      ),
    ).resolves.toBe("stored");
  });

  it("leaves the contributions in place when the anonymous session expires, and takes the marked scan with it", async () => {
    const mouseA = await world.addMouse("mouse-a");
    const scan = await world.addScan({
      expiresAt: new Date(NOW.getTime() - 1),
    });
    await world.surveyRepo.recordContribution(
      aWrite(scan, { ratings: [rate(mouseA)] }),
    );
    await world.scanRepo.deleteExpiredAnonymousSessions(NOW);
    expect(await world.scanMark(scan.scanId)).toBeNull();
    expect(await world.contributions()).toHaveLength(1);
  });
});

async function ratingsOfWorld(
  world: SurveyWorld,
  userId: string,
): Promise<{ slug: string; satisfaction: number; isCurrent: boolean }[]> {
  return (await world.contributions())
    .filter((c) => c.userId === userId)
    .flatMap((c) => c.ratings);
}
