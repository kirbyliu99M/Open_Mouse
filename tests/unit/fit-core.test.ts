import { describe, expect, it, vi } from "vitest";
import {
  fitPreferencesSchema,
  fitResponseSchema,
} from "../../src/lib/contracts/fit";
import { loadOwnedFit } from "../../src/server/fit/core";
import { scoreFit } from "../../src/server/fit/score";
import {
  createFakeFitRepo,
  createFakeScanRepo,
  sampleCatalogue,
  sampleOwnedScan,
} from "./fixtures/fake-fit-deps";

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";
const NOW = () => new Date("2026-09-23T12:00:00Z");
// `FitPreferences` (the parsed/output type) requires `includeVertical` —
// zod's `.default()` only makes a field optional on input. Parsing `{}`
// gets the same defaulted value the real route would use for an empty body.
const NO_PREFS = fitPreferencesSchema.parse({});

describe("loadOwnedFit — ownership: 404-equivalent (not_found), never 403", () => {
  it("a malformed (non-UUID) scan id never reaches the repo", async () => {
    const findOwnedScan = vi.fn(async () => null);
    const scanRepo = createFakeScanRepo(findOwnedScan);
    const { repo: fitRepo } = createFakeFitRepo();

    const result = await loadOwnedFit(
      "not-a-uuid",
      { userId: null, cookieSessionId: null },
      NO_PREFS,
      { scanRepo, fitRepo, now: NOW },
    );

    expect(result).toEqual({ status: "not_found" });
    expect(findOwnedScan).not.toHaveBeenCalled();
  });

  it("an unknown scan id is not_found", async () => {
    const findOwnedScan = vi.fn(async () => null);
    const scanRepo = createFakeScanRepo(findOwnedScan);
    const { repo: fitRepo } = createFakeFitRepo();

    const result = await loadOwnedFit(
      SCAN_ID,
      { userId: null, cookieSessionId: null },
      NO_PREFS,
      { scanRepo, fitRepo, now: NOW },
    );

    expect(result).toEqual({ status: "not_found" });
    expect(findOwnedScan).toHaveBeenCalledWith(SCAN_ID, {
      userId: null,
      cookieSessionId: null,
      now: NOW(),
    });
  });

  it("a scan belonging to a different anonymous session is not_found", async () => {
    const findOwnedScan = vi.fn(async () => null);
    const scanRepo = createFakeScanRepo(findOwnedScan);
    const { repo: fitRepo } = createFakeFitRepo();

    const result = await loadOwnedFit(
      SCAN_ID,
      { userId: null, cookieSessionId: "someone-elses-session" },
      NO_PREFS,
      { scanRepo, fitRepo, now: NOW },
    );

    expect(result).toEqual({ status: "not_found" });
    expect(findOwnedScan).toHaveBeenCalledWith(SCAN_ID, {
      userId: null,
      cookieSessionId: "someone-elses-session",
      now: NOW(),
    });
  });

  it("an expired anonymous scan is not_found", async () => {
    // The repo is the source of truth for "expired" (findOwnedScan already
    // applies that check — see scan-ownership-drizzle.test.ts); here the
    // core just has to treat a null the same way regardless of why.
    const findOwnedScan = vi.fn(async () => null);
    const scanRepo = createFakeScanRepo(findOwnedScan);
    const { repo: fitRepo } = createFakeFitRepo();

    const result = await loadOwnedFit(
      SCAN_ID,
      { userId: null, cookieSessionId: "expired-session" },
      NO_PREFS,
      { scanRepo, fitRepo, now: NOW },
    );

    expect(result).toEqual({ status: "not_found" });
  });

  it("a signed-in user can fetch their own scan from any browser (no cookie needed)", async () => {
    const findOwnedScan = vi.fn(async () => sampleOwnedScan);
    const scanRepo = createFakeScanRepo(findOwnedScan);
    const { repo: fitRepo } = createFakeFitRepo();

    const result = await loadOwnedFit(
      SCAN_ID,
      { userId: "user-1", cookieSessionId: null },
      NO_PREFS,
      { scanRepo, fitRepo, now: NOW },
    );

    expect(result.status).toBe("ok");
    expect(findOwnedScan).toHaveBeenCalledWith(SCAN_ID, {
      userId: "user-1",
      cookieSessionId: null,
      now: NOW(),
    });
  });
});

describe("loadOwnedFit — a successful fit", () => {
  it("returns a response that passes fitResponseSchema.parse", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => sampleOwnedScan));
    const { repo: fitRepo } = createFakeFitRepo();

    const result = await loadOwnedFit(
      SCAN_ID,
      { userId: null, cookieSessionId: "session-1" },
      NO_PREFS,
      { scanRepo, fitRepo, now: NOW },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("unreachable");
    expect(() => fitResponseSchema.parse(result.fit)).not.toThrow();
    expect(result.fit.scanId).toBe(SCAN_ID);
    expect(result.measurements).toEqual(sampleOwnedScan.measurements);
  });

  it.each(["left", "right"] as const)(
    "reports the hand the scan measured: a %s-hand OwnedScan gives fit.hand === %s",
    async (hand) => {
      const scanRepo = createFakeScanRepo(
        vi.fn(async () => ({ ...sampleOwnedScan, hand })),
      );
      const { repo: fitRepo } = createFakeFitRepo();

      const result = await loadOwnedFit(
        SCAN_ID,
        { userId: null, cookieSessionId: "session-1" },
        NO_PREFS,
        { scanRepo, fitRepo, now: NOW },
      );

      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error("unreachable");
      expect(result.fit.hand).toBe(hand);
      // ...and it survives the contract the route re-validates with.
      expect(fitResponseSchema.parse(result.fit).hand).toBe(hand);
    },
  );

  it("scores the left hand as left: a right-handed ergonomic mouse is excluded as wrong_hand, and a right scan keeps it", async () => {
    const rightErgo = {
      ...sampleCatalogue[0],
      id: "mouse-3",
      slug: "right-ergo",
      handCompatibility: "right" as const,
      shape: "ergonomic" as const,
    };
    const catalogue = [...sampleCatalogue, rightErgo];
    const run = async (hand: "left" | "right") => {
      const scanRepo = createFakeScanRepo(
        vi.fn(async () => ({ ...sampleOwnedScan, hand })),
      );
      const { repo: fitRepo } = createFakeFitRepo(catalogue);
      const result = await loadOwnedFit(
        SCAN_ID,
        { userId: null, cookieSessionId: "session-1" },
        NO_PREFS,
        { scanRepo, fitRepo, now: NOW },
      );
      if (result.status !== "ok") throw new Error("unreachable");
      return result.fit;
    };

    const left = await run("left");
    expect(left.hand).toBe("left");
    expect(left.excluded).toContainEqual(
      expect.objectContaining({ slug: "right-ergo", reason: "wrong_hand" }),
    );
    const right = await run("right");
    expect(right.hand).toBe("right");
    expect(right.excluded.map((e) => e.slug)).not.toContain("right-ergo");
  });

  it("uses the scan's stated grip for empty preferences and honors an override", async () => {
    const scanRepo = createFakeScanRepo(
      vi.fn(async () => ({
        ...sampleOwnedScan,
        gripStyleStated: "claw" as const,
      })),
    );
    const { repo: fitRepo } = createFakeFitRepo();
    const owner = { userId: null, cookieSessionId: "session-1" };
    const deps = { scanRepo, fitRepo, now: NOW };
    const stored = await loadOwnedFit(SCAN_ID, owner, NO_PREFS, deps);
    expect(stored.status).toBe("ok");
    if (stored.status !== "ok") throw new Error("unreachable");
    expect(stored.fit.gripStyle).toMatchObject({
      stated: "claw",
      used: "claw",
    });

    const overridden = await loadOwnedFit(
      SCAN_ID,
      owner,
      fitPreferencesSchema.parse({ gripStyle: "palm" }),
      deps,
    );
    expect(overridden.status).toBe("ok");
    if (overridden.status !== "ok") throw new Error("unreachable");
    expect(overridden.fit.gripStyle).toMatchObject({
      stated: "palm",
      used: "palm",
    });
  });

  it("adds no computation of its own — every number matches scoreFit's own output", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => sampleOwnedScan));
    const { repo: fitRepo } = createFakeFitRepo();
    const prefs = fitPreferencesSchema.parse({ gripStyle: "palm" });

    const result = await loadOwnedFit(
      SCAN_ID,
      { userId: null, cookieSessionId: "session-1" },
      prefs,
      { scanRepo, fitRepo, now: NOW },
    );
    if (result.status !== "ok") throw new Error("unreachable");

    const expected = scoreFit(
      sampleOwnedScan.measurements,
      sampleCatalogue,
      prefs,
      sampleOwnedScan.hand,
    );
    expect(result.fit).toEqual({ scanId: SCAN_ID, ...expected });
  });

  it("persists one row per ranked result, and repeating the request never throws (idempotent upsert key)", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => sampleOwnedScan));
    const { repo: fitRepo, saveFitResultsCalls } = createFakeFitRepo();

    const first = await loadOwnedFit(
      SCAN_ID,
      { userId: null, cookieSessionId: "session-1" },
      NO_PREFS,
      { scanRepo, fitRepo, now: NOW },
    );
    const second = await loadOwnedFit(
      SCAN_ID,
      { userId: null, cookieSessionId: "session-1" },
      NO_PREFS,
      { scanRepo, fitRepo, now: NOW },
    );

    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status !== "ok") throw new Error("unreachable");

    expect(saveFitResultsCalls).toHaveLength(2);
    expect(saveFitResultsCalls[0]).toHaveLength(first.fit.results.length);
    expect(saveFitResultsCalls[0]!.map((r) => [r.mouseId, r.rank])).toEqual(
      first.fit.results.map((r) => [
        sampleCatalogue.find((m) => m.slug === r.mouse.slug)!.id,
        r.rank,
      ]),
    );
  });

  it("propagates a persistence failure instead of returning ok with unsaved data", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => sampleOwnedScan));
    const { repo: fitRepo } = createFakeFitRepo(sampleCatalogue, async () => {
      throw new Error("db write failed");
    });

    await expect(
      loadOwnedFit(
        SCAN_ID,
        { userId: null, cookieSessionId: "session-1" },
        NO_PREFS,
        { scanRepo, fitRepo, now: NOW },
      ),
    ).rejects.toThrow();
  });
});
