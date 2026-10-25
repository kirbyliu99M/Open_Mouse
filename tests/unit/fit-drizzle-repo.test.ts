import { describe, expect, it, vi } from "vitest";

// `server-only` (imported by src/server/fit/drizzle-repo.ts) throws when
// loaded outside a React Server Component; stub it so the real repo module
// can be imported and exercised here instead of never being unit-tested.
vi.mock("server-only", () => ({}));

import { createDrizzleFitRepo } from "../../src/server/fit/drizzle-repo";
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
  ringFingerRest: null,
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

describe("createDrizzleFitRepo", () => {
  it("only reads: the repo has no write method (fit_results is no longer written)", () => {
    const repo = createDrizzleFitRepo(
      fakeDrizzleChain([]) as unknown as FakeDb,
    );
    expect(Object.keys(repo)).toEqual(["loadCatalogue"]);
  });
});
