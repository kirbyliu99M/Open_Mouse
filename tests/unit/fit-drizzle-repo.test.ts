import { describe, expect, it, vi } from "vitest";

// `server-only` (imported by src/server/fit/drizzle-repo.ts) throws when
// loaded outside a React Server Component; stub it so the real repo module
// can be imported and exercised here instead of never being unit-tested.
vi.mock("server-only", () => ({}));

import { createDrizzleFitRepo } from "../../src/server/fit/drizzle-repo";
import type { FitResultRow } from "../../src/server/fit/rows";
import { fakeDrizzleChain } from "./fixtures/fake-drizzle";

type FakeDb = Parameters<typeof createDrizzleFitRepo>[0];

const catalogueRow = {
  id: "mouse-uuid-1",
  slug: "logitech-g502",
  brand: "Logitech",
  model: "G502",
  lengthMm: 132,
  widthMm: 75,
  heightMm: 40,
  weightG: 121,
  size: "medium" as const,
  handCompatibility: null,
  shape: null,
  humpPlacement: null,
  frontFlare: null,
  sideCurvature: null,
  thumbRest: null,
};

describe("createDrizzleFitRepo().loadCatalogue", () => {
  it("returns every mice row, unfiltered", async () => {
    const chain = fakeDrizzleChain([catalogueRow]);
    const repo = createDrizzleFitRepo(chain as unknown as FakeDb);

    const catalogue = await repo.loadCatalogue();

    expect(catalogue).toEqual([catalogueRow]);
    expect(chain.select).toHaveBeenCalledTimes(1);
    expect(chain.from).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array for an empty catalogue", async () => {
    const chain = fakeDrizzleChain([]);
    const repo = createDrizzleFitRepo(chain as unknown as FakeDb);

    expect(await repo.loadCatalogue()).toEqual([]);
  });
});

describe("createDrizzleFitRepo().saveFitResults", () => {
  const row: FitResultRow = {
    scanId: "scan-1",
    mouseId: "mouse-uuid-1",
    engineVersion: "fit-v0-provisional",
    rank: 1,
    totalScore: 82,
    lengthScore: 80,
    gripWidthScore: 75,
    heightHumpScore: 90,
    frontFlareScore: 80,
    thumbScore: 100,
    weightScore: 70,
    reasons: {} as FitResultRow["reasons"],
  };

  it("upserts on the (scan_id, mouse_id, engine_version) key — repeating the call never throws", async () => {
    const chain = fakeDrizzleChain([]);
    const repo = createDrizzleFitRepo(chain as unknown as FakeDb);

    await repo.saveFitResults([row]);
    await repo.saveFitResults([row]);

    expect(chain.insert).toHaveBeenCalledTimes(2);
    expect(chain.onConflictDoUpdate).toHaveBeenCalledTimes(2);
    const [call] = vi.mocked(chain.onConflictDoUpdate).mock.calls;
    const arg = call![0] as { target: unknown[]; set: Record<string, unknown> };
    expect(arg.target).toHaveLength(3);
    expect(Object.keys(arg.set).sort()).toEqual(
      [
        "rank",
        "totalScore",
        "lengthScore",
        "gripWidthScore",
        "heightHumpScore",
        "frontFlareScore",
        "thumbScore",
        "weightScore",
        "reasons",
      ].sort(),
    );
  });

  it("is a no-op for an empty row list — never calls insert", async () => {
    const chain = fakeDrizzleChain([]);
    const repo = createDrizzleFitRepo(chain as unknown as FakeDb);

    await repo.saveFitResults([]);

    expect(chain.insert).not.toHaveBeenCalled();
  });
});
