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
    ringFingerRest: null,
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
    ringFingerRest: null,
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
  /**
   * Every method other than `loadCatalogue` that anything called on `repo`.
   * The fit path only reads the catalogue (it no longer writes `fit_results`),
   * so a test expects this to stay empty; it catches any write method that is
   * added to `FitRepo` later and called from the request path.
   */
  otherCalls: string[];
}

/** A fake `FitRepo`. `catalogue` is returned verbatim by `loadCatalogue`; a
 * call to anything else on the repo is recorded in `otherCalls`. */
export function createFakeFitRepo(
  catalogue: CatalogueMouse[] = sampleCatalogue,
): FakeFitRepo {
  const otherCalls: string[] = [];
  const base: FitRepo = { loadCatalogue: vi.fn(async () => catalogue) };
  const repo = new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof FitRepo];
      return async () => {
        otherCalls.push(String(prop));
      };
    },
  });
  return { repo, otherCalls };
}

const row = (
  id: string,
  slug: string,
  brand: string,
  model: string,
  dims: [lengthMm: number, widthMm: number, heightMm: number],
  extra: Partial<CatalogueMouse> = {},
): CatalogueMouse => ({
  id,
  slug,
  brand,
  model,
  lengthMm: dims[0],
  widthMm: dims[1],
  heightMm: dims[2],
  weightG: 80,
  size: "medium",
  handCompatibility: null,
  shape: null,
  humpPlacement: null,
  frontFlare: null,
  sideCurvature: null,
  thumbRest: null,
  ringFingerRest: null,
  ...extra,
});

/**
 * V3.2 F1 parity fixture (candidate): eight rows, so the first five places are
 * a real cut, with what the two-mouse `sampleCatalogue` lacks:
 *   - one same-shell pair ("Acme M75" / "Acme M75 Wireless": same brand,
 *     dimensions and descriptors, one model family), grouped into one card;
 *   - one `listed: false` row with dimensions in the middle of the pack, so
 *     it would sit in the first five if it were ranked.
 * The other rows step away in size so the ranking has a clear order.
 */
export const shellCatalogue: CatalogueMouse[] = [
  row("s-1", "acme-m75", "Acme", "M75", [124, 64, 40]),
  row("s-2", "acme-m75-wireless", "Acme", "M75 Wireless", [124, 64, 40], {
    weightG: 70,
  }),
  row("s-3", "acme-hidden", "Acme", "Hidden", [125, 65, 40], {
    listed: false,
  }),
  row("s-4", "brio-one", "Brio", "One", [122, 63, 39]),
  row("s-5", "brio-two", "Brio", "Two", [127, 66, 41]),
  row("s-6", "cleo-alpha", "Cleo", "Alpha", [119, 61, 38]),
  row("s-7", "cleo-beta", "Cleo", "Beta", [130, 68, 42]),
  row("s-8", "dune-max", "Dune", "Max", [135, 72, 44]),
];
