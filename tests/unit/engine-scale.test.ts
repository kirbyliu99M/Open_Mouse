/**
 * landmark-raw-v3 (V3.2 F12, candidate 未拍板; Kirby 2026-10-22, design R7
 * §3.1, §5.1 item 6, D1 = B, D3): a parallax-corrected scan reaches every
 * reader of a scan's size on the engine's scale, `FIT_SCALE_FROM_CORRECTED`
 * times its hand length, palm length and palm width. The rule reads
 * `parallaxCorrected`, never the measurement version, so an older corrected
 * record (EXIF, homography) is scaled too. A typed size and an uncorrected
 * scan are what they were. Fake repos only, the checked-in seed as the real
 * catalogue.
 */
import { describe, expect, it, vi } from "vitest";
import catalogueJson from "../../src/db/seed/catalogue.json";
import descriptorsJson from "../../src/db/seed/logitech-descriptors.json";
import factsJson from "../../src/db/seed/logitech-facts.json";
import seedJson from "../../src/db/seed/logitech.json";
import { fitPreferencesSchema } from "../../src/lib/contracts/fit";
import { SURVEY_CONSENT_VERSION } from "../../src/lib/contracts/survey";
import { surveySubmissionSchema } from "../../src/lib/contracts/survey";
import {
  FIT_SCALE_FROM_CORRECTED,
  MANUAL_ENTRY,
  type HandMeasurements,
} from "../../src/lib/contracts/measurement";
import {
  engineScaleMeasurements,
  fitScaleMeasurements,
  parallaxCorrectedOf,
  shownScanMeasurements,
} from "../../src/lib/fit/fit-scale";
import type { CatalogueEntry } from "../../src/server/catalogue/candidate-map";
import {
  buildSeedRows,
  type FactsFile,
  toCatalogueMouse,
} from "../../src/server/catalogue/catalogue-rows";
import type {
  DescriptorRecord,
  SpecRecord,
} from "../../src/server/catalogue/seed-rows";
import { loadOwnedFit } from "../../src/server/fit/core";
import { predictGrip } from "../../src/server/fit/grip";
import { listedOnly } from "../../src/server/fit/listed";
import { buildSnapshot } from "../../src/server/result-feedback/snapshot";
import type { OwnedScan } from "../../src/server/scans/repo";
import { buildContributionWrite } from "../../src/server/survey/profile";
import { measuredSheetNumbers } from "../../src/client/photo/unverified-note";
import {
  handRows,
  shownAccountMeasurements,
} from "../../src/app/account/profile-model";
import { accountCopy } from "../../src/lib/copy/account";
import type { AccountScan } from "../../src/server/account/repo";
import {
  createFakeFitRepo,
  createFakeScanRepo,
} from "./fixtures/fake-fit-deps";

const K = FIT_SCALE_FROM_CORRECTED;

const STORED: HandMeasurements = {
  handLengthMm: 185,
  palmLengthMm: 103,
  palmWidthMm: 63.5,
  middleLengthMm: 80,
};

describe("the contract's ratios (simulated, to be replaced by S25 measured ones)", () => {
  it("are the design's R7 §3.1 numbers", () => {
    expect(K.handLength).toBe(1.024);
    expect(K.palmLength).toBe(1.041);
    expect(K.palmWidth).toBe(1.035);
  });
});

describe("engineScaleMeasurements / fitScaleMeasurements (pure)", () => {
  it("a parallax-corrected scan: hand length, palm length and palm width times the ratios; fingers as stored", () => {
    const out = engineScaleMeasurements(STORED, true);
    expect(out.handLengthMm).toBe(185 * 1.024);
    expect(out.palmLengthMm).toBe(103 * 1.041);
    expect(out.palmWidthMm).toBe(63.5 * 1.035);
    expect(out.middleLengthMm).toBe(80);
    expect(STORED.handLengthMm).toBe(185);
  });

  it.each([false, null, undefined])(
    "parallaxCorrected %s: the very same object, byte for byte",
    (flag) => {
      expect(engineScaleMeasurements(STORED, flag)).toBe(STORED);
      expect(
        fitScaleMeasurements(STORED, {
          calibrationMethod: "paper-edge",
          parallaxCorrected: flag,
        }),
      ).toBe(STORED);
    },
  );

  it("manual-entry: the typed width x 0.77 for the engine, nothing else, as before v3", () => {
    const out = fitScaleMeasurements(
      { handLengthMm: 190, palmLengthMm: 106.4, palmWidthMm: 85 },
      { calibrationMethod: "manual-entry", parallaxCorrected: false },
    );
    expect(out).toEqual({
      handLengthMm: 190,
      palmLengthMm: 106.4,
      palmWidthMm: 85 * MANUAL_ENTRY.widthToLandmarkScale,
    });
  });

  it("the rule reads the flag, not the method or version: a corrected printed-sheet or paper-edge record is scaled alike (D3)", () => {
    for (const method of ["paper-edge", "printed-sheet", null] as const) {
      expect(
        fitScaleMeasurements(STORED, {
          calibrationMethod: method,
          parallaxCorrected: true,
        }),
      ).toEqual(engineScaleMeasurements(STORED, true));
    }
  });

  it("a length that is not a number is left as it is", () => {
    const out = engineScaleMeasurements(
      { handLengthMm: Number.NaN, palmLengthMm: 100, palmWidthMm: 60 },
      true,
    );
    expect(out.handLengthMm).toBeNaN();
    expect(out.palmLengthMm).toBe(104.1);
  });

  it("parallaxCorrectedOf reads the evidence's flag and nothing else", () => {
    expect(parallaxCorrectedOf({ parallaxCorrected: true })).toBe(true);
    expect(parallaxCorrectedOf({ parallaxCorrected: false })).toBe(false);
    expect(parallaxCorrectedOf({ parallaxCorrected: "true" })).toBeNull();
    expect(parallaxCorrectedOf(null)).toBeNull();
    expect(parallaxCorrectedOf([true])).toBeNull();
    expect(parallaxCorrectedOf({})).toBeNull();
  });
});

// ── The readers: each one goes through the same function ───────────────────

const SCAN_ID = "5f0c6f7e-1c2d-4b8a-9d3e-2a1b0c9d8e7f";
const NOW = () => new Date("2026-10-22T00:00:00Z");
const built = buildSeedRows(
  seedJson as unknown as SpecRecord[],
  descriptorsJson as unknown as DescriptorRecord[],
  {
    facts: factsJson as unknown as FactsFile,
    entries: catalogueJson as unknown as CatalogueEntry[],
  },
);
const catalogue = listedOnly(
  [...built.withDescriptors, ...built.withoutDescriptors].map((r) => ({
    ...toCatalogueMouse(r),
    id: r.slug,
  })),
);

const owned = (
  measurements: HandMeasurements,
  over: Partial<OwnedScan> = {},
): OwnedScan => ({
  hand: "right",
  gripStyleStated: null,
  palmThicknessStated: null,
  measurements,
  calibrationMethod: "paper-edge",
  ...over,
});

async function fitFor(scan: OwnedScan) {
  const { repo: fitRepo } = createFakeFitRepo(catalogue);
  const result = await loadOwnedFit(
    SCAN_ID,
    { userId: null, cookieSessionId: "c" },
    fitPreferencesSchema.parse({}),
    {
      scanRepo: createFakeScanRepo(vi.fn(async () => scan)),
      fitRepo,
      now: NOW,
    },
  );
  if (result.status !== "ok") throw new Error("unreachable");
  return result;
}

describe("fit engine (loadOwnedFit) and the feedback snapshot", () => {
  const corrected = owned(STORED, { parallaxCorrected: true });
  const engineEquivalent = owned(engineScaleMeasurements(STORED, true), {
    parallaxCorrected: false,
  });

  it("a corrected scan ranks exactly as the same numbers on the engine's scale, uncorrected", async () => {
    const a = await fitFor(corrected);
    const b = await fitFor(engineEquivalent);
    expect(a.fit.results).toEqual(b.fit.results);
    expect(a.fit.handType).toEqual(b.fit.handType);
    expect(a.fit.gripStyle).toEqual(b.fit.gripStyle);
    expect(a.fit.targets).toEqual(b.fit.targets);
  });

  it("and hands back the engine-scale numbers for the page and the analysis (D1 = B)", async () => {
    const a = await fitFor(corrected);
    expect(a.measurements).toEqual(engineScaleMeasurements(STORED, true));
  });

  it("an uncorrected scan and an old row without the flag are byte for byte what they were", async () => {
    const plain = owned(STORED, { parallaxCorrected: false });
    const old = owned(STORED);
    const a = await fitFor(plain);
    const b = await fitFor(old);
    expect(a.measurements).toBe(STORED);
    expect(JSON.stringify(a.fit)).toBe(JSON.stringify(b.fit));
  });

  it("a typed scan still hands back the typed numbers", async () => {
    const typed = { handLengthMm: 190, palmLengthMm: 106.4, palmWidthMm: 85 };
    const r = await fitFor(owned(typed, { calibrationMethod: "manual-entry" }));
    expect(r.measurements).toEqual(typed);
  });

  it("the snapshot scores a corrected scan on the engine's scale too", async () => {
    const a = await buildSnapshot(corrected, catalogue);
    const b = await buildSnapshot(engineEquivalent, catalogue);
    expect(a).toEqual(b);
    const raw = await buildSnapshot(
      owned(STORED, { parallaxCorrected: false }),
      catalogue,
    );
    // The scaled hand is a different hand to the engine.
    expect(raw.topMice).not.toEqual(a.topMice);
  });
});

describe("survey contribution: bins and grip on the engine's scale", () => {
  const body = surveySubmissionSchema.parse({
    scanId: "10000000-0000-4000-8000-000000000001",
    consent: { accepted: true, version: SURVEY_CONSENT_VERSION },
    ratings: [{ slug: "mouse-a", satisfaction: 4 }],
  });
  const ids = new Map([["mouse-a", "20000000-0000-4000-8000-00000000000a"]]);
  // 184 x 1.024 = 188.4 (bin 185, stored bin 180); 77.8 x 1.035 = 80.5 (bin 80, stored 75).
  // Grip crosses a threshold (simulated input): palm/hand 98.5 / 184 = 0.535
  // is fingertip (claw from 0.54); 102.5 / 188.4 = 0.544 is claw. A reader
  // that predicts from the stored numbers is caught.
  const measurements: HandMeasurements = {
    handLengthMm: 184,
    palmLengthMm: 98.5,
    palmWidthMm: 77.8,
  };

  it("the input really flips the grip between the two scales", () => {
    expect(predictGrip(184, 98.5)).toBe("fingertip");
    expect(predictGrip(184 * 1.024, 98.5 * 1.041)).toBe("claw");
  });

  it("a corrected scan lands in the cell the same hand did before correction", () => {
    const write = buildContributionWrite({
      body,
      userId: null,
      scan: {
        gripStyleStated: null,
        measurements,
        calibrationMethod: "paper-edge",
        parallaxCorrected: true,
      },
      mouseIdBySlug: ids,
      now: NOW(),
    });
    expect(write.handLengthBinMm).toBe(185);
    expect(write.palmWidthBinMm).toBe(80);
    expect(write.gripStyle).toBe("claw");
    expect(write.gripStyle).toBe(predictGrip(184 * 1.024, 98.5 * 1.041));
    expect(write.gripStyle).not.toBe(predictGrip(184, 98.5));
  });

  it("an uncorrected scan is binned as stored, as before", () => {
    const write = buildContributionWrite({
      body,
      userId: null,
      scan: { gripStyleStated: null, measurements, parallaxCorrected: false },
      mouseIdBySlug: ids,
      now: NOW(),
    });
    expect(write.handLengthBinMm).toBe(180);
    expect(write.palmWidthBinMm).toBe(75);
    expect(write.gripStyle).toBe("fingertip");
    expect(write.gripStyle).toBe(predictGrip(184, 98.5));
  });
});

describe("what the person sees is the engine-scale number (D1 = B)", () => {
  it("the scan sheet's numbers", () => {
    const corrected = measuredSheetNumbers(
      { handLengthMm: 185, palmWidthMm: 63.5 },
      { method: "paper-edge", parallaxCorrected: true },
      "en",
    );
    const asEngine = measuredSheetNumbers(
      { handLengthMm: 185 * 1.024, palmWidthMm: 63.5 * 1.035 },
      { method: "paper-edge", parallaxCorrected: false },
      "en",
    );
    expect(corrected).toBe(asEngine);
    expect(corrected).toContain("189");
    expect(corrected).toContain("66");
    // A typed length is never corrected: shown as typed.
    const typed = measuredSheetNumbers(
      { handLengthMm: 185, palmWidthMm: 63.5 },
      {
        method: "user-length",
        referenceMeasurement: "handLengthMm",
        referenceMm: 185,
        parallaxCorrected: false,
      },
      "en",
    );
    expect(typed).toContain("185");
  });

  it("shownScanMeasurements reads the submission's own calibration", () => {
    expect(shownScanMeasurements(STORED, { parallaxCorrected: true })).toEqual(
      engineScaleMeasurements(STORED, true),
    );
    expect(shownScanMeasurements(STORED, { parallaxCorrected: false })).toBe(
      STORED,
    );
  });

  it("the account page's rows", () => {
    const scan: AccountScan = {
      scanId: SCAN_ID,
      createdAt: "2026-10-22T00:00:00.000Z",
      hand: "right",
      gripStyleStated: null,
      palmThicknessStated: null,
      calibrationMethod: "paper-edge",
      parallaxCorrected: true,
      measurements: {
        handLengthMm: 185,
        palmLengthMm: 103,
        palmWidthMm: 63.5,
        thumbLengthMm: null,
        indexLengthMm: null,
        middleLengthMm: null,
        ringLengthMm: null,
        pinkyLengthMm: null,
        palmThicknessMm: null,
        knuckleHeightMm: null,
        gripApertureMm: null,
        thumbAngleDeg: null,
      },
    };
    expect(shownAccountMeasurements(scan)).toEqual({
      handLengthMm: 185 * 1.024,
      palmWidthMm: 63.5 * 1.035,
    });
    const copy = accountCopy("en");
    const asEngine = handRows(
      {
        ...scan,
        parallaxCorrected: false,
        measurements: {
          ...scan.measurements,
          handLengthMm: 185 * 1.024,
          palmWidthMm: 63.5 * 1.035,
        },
      },
      copy,
    );
    expect(handRows(scan, copy)).toEqual(asEngine);
    // An old row without the flag is shown as stored.
    const { parallaxCorrected: _drop, ...old } = scan;
    void _drop;
    expect(shownAccountMeasurements(old)).toEqual({
      handLengthMm: 185,
      palmWidthMm: 63.5,
    });
  });
});
