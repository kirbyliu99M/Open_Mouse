import { vi } from "vitest";
import type { HandMeasurements } from "../../../src/lib/contracts/measurement";
import type { FitRepo } from "../../../src/server/fit/repo";
import type { CatalogueMouse } from "../../../src/server/fit/types";
import type { OwnedScan, ScanRepo } from "../../../src/server/scans/repo";

export const sampleMeasurements: HandMeasurements = {
  handLengthMm: 180,
  palmLengthMm: 100,
  palmWidthMm: 85,
};

/** Two unclassified mice — descriptors null, same as the real seed before
 * classification runs. Enough for scoreFit to rank something. */
export const sampleCatalogue: CatalogueMouse[] = [
  {
    id: "mouse-1",
    slug: "logitech-g502",
    brand: "Logitech",
    model: "G502",
    lengthMm: 132,
    widthMm: 75,
    heightMm: 40,
    weightG: 121,
    size: "medium",
    handCompatibility: null,
    shape: null,
    humpPlacement: null,
    frontFlare: null,
    sideCurvature: null,
    thumbRest: null,
  },
  {
    id: "mouse-2",
    slug: "razer-basilisk",
    brand: "Razer",
    model: "Basilisk",
    lengthMm: 128,
    widthMm: 70,
    heightMm: 42,
    weightG: 92,
    size: "medium",
    handCompatibility: null,
    shape: null,
    humpPlacement: null,
    frontFlare: null,
    sideCurvature: null,
    thumbRest: null,
  },
];

export const sampleOwnedScan: OwnedScan = {
  hand: "right",
  gripStyleStated: null,
  palmThicknessStated: null,
  measurements: sampleMeasurements,
};

/**
 * A fake `ScanRepo` for fit tests. Only `findOwnedScan`'s behavior varies
 * per test — every other method is stubbed and unused (fit requests never
 * submit, delete, or expire a scan).
 */
export function createFakeScanRepo(
  findOwnedScan: ScanRepo["findOwnedScan"] = vi.fn(async () => null),
): ScanRepo {
  return {
    findValidSession: vi.fn(async () => null),
    createAnonymousSession: vi.fn(async () => ({ id: "session" })),
    createClaimedSession: vi.fn(async () => ({ id: "session" })),
    insertScanWithMeasurements: vi.fn(async () => ({ scanId: "scan" })),
    deleteSession: vi.fn(async () => {}),
    deleteExpiredAnonymousSessions: vi.fn(async () => 0),
    deleteEndedRateLimitWindows: vi.fn(async () => 0),
    claimSession: vi.fn(async () => {}),
    findOwnedScan,
    deleteOwnedScan: vi.fn(async () => false),
  };
}

export interface FakeFitRepo {
  repo: FitRepo;
  saveFitResultsCalls: Parameters<FitRepo["saveFitResults"]>[0][];
}

/** A fake `FitRepo`. `catalogue` is returned verbatim by `loadCatalogue`;
 * every `saveFitResults` call is recorded in `saveFitResultsCalls`, and
 * `onSave` (if given) can throw to simulate a persistence failure. */
export function createFakeFitRepo(
  catalogue: CatalogueMouse[] = sampleCatalogue,
  onSave?: FitRepo["saveFitResults"],
): FakeFitRepo {
  const saveFitResultsCalls: Parameters<FitRepo["saveFitResults"]>[0][] = [];
  const repo: FitRepo = {
    loadCatalogue: vi.fn(async () => catalogue),
    saveFitResults: vi.fn(async (rows) => {
      saveFitResultsCalls.push(rows);
      if (onSave) await onSave(rows);
    }),
  };
  return { repo, saveFitResultsCalls };
}
