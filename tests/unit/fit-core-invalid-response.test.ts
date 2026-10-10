import { describe, expect, it, vi } from "vitest";

// Isolated in its own file: this replaces scoreFitV1 (the default engine) real export, which
// would otherwise poison every other fit-core test in the same module
// graph. scoreFit itself always produces a schema-valid response in normal
// operation (see fit-golden.test.ts) — the only way to exercise the "500,
// never a silently malformed 200" guard (issue #27, criterion 1) is to
// force a bad shape out of it.
vi.mock("../../src/server/fit/score-v1", () => ({
  scoreFitV1: vi.fn(() => ({
    engineVersion: "fit-v1-candidate.2",
    gripStyle: { stated: null, predicted: "palm", used: "palm" },
    targets: { lengthMm: 118, gripWidthMm: 75, heightMm: 38 },
    excluded: [],
    // total is out of fitEntrySchema's 0-100 bound — an invented, impossible
    // engine output.
    results: [
      {
        rank: 1,
        mouse: {
          slug: "logitech-g502",
          brand: "Logitech",
          model: "G502",
          lengthMm: 132,
          widthMm: 75,
          heightMm: 40,
          weightG: 121,
          size: "medium",
        },
        total: 999,
        confidence: 1,
        subscores: {},
      },
    ],
  })),
}));

const { loadOwnedFit } = await import("../../src/server/fit/core");
const { createFakeFitRepo, createFakeScanRepo, sampleOwnedScan } =
  await import("./fixtures/fake-fit-deps");
const { fitPreferencesSchema } = await import("../../src/lib/contracts/fit");

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";

describe("loadOwnedFit — a computed response that fails its own contract", () => {
  it("throws instead of returning a silently malformed ok result", async () => {
    const scanRepo = createFakeScanRepo(vi.fn(async () => sampleOwnedScan));
    const { repo: fitRepo, saveFitResultsCalls } = createFakeFitRepo();

    await expect(
      loadOwnedFit(
        SCAN_ID,
        { userId: null, cookieSessionId: "session-1" },
        fitPreferencesSchema.parse({}),
        { scanRepo, fitRepo },
      ),
    ).rejects.toThrow();

    // Never persisted: an invalid response is never written to fit_results.
    expect(saveFitResultsCalls).toHaveLength(0);
  });
});
