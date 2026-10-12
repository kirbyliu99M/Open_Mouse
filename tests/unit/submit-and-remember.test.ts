import { describe, expect, it } from "vitest";
import {
  rememberScanDisclosures,
  submitAndRemember,
} from "../../src/client/scan/submitAndRemember";
import { buildManualAnswersSubmission } from "../../src/client/scan/answers";
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
  type ScanSubmission,
} from "../../src/lib/contracts/measurement";
import {
  resultLengthKey,
  resultManualEntryKey,
} from "../../src/components/results/userLengthDisclosure";

/**
 * What a send leaves behind on the device, per calibration method (the
 * results page reads it to say how the numbers came about). The rule: each
 * method writes its own key only, only after a 201, and nothing else.
 */
const SCAN_ID = "623e4567-e89b-12d3-a456-426614174010";

const MEASUREMENTS = {
  handLengthMm: 186,
  palmLengthMm: 106,
  palmWidthMm: 82,
};

const MANUAL = buildManualAnswersSubmission(
  { hand: "right", handLengthMm: 185, handWidthMm: 82 },
  { grip: "claw", thickness: null },
);
const TYPED_LENGTH: ScanSubmission = scanSubmissionSchema.parse({
  hand: "right",
  measurements: MEASUREMENTS,
  calibration: {
    method: "user-length",
    referenceMeasurement: "handLengthMm",
    referenceMm: 186,
    parallaxCorrected: false,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
});
const PAPER: ScanSubmission = scanSubmissionSchema.parse({
  hand: "right",
  measurements: MEASUREMENTS,
  calibration: {
    method: "paper-edge",
    paperSize: "a4",
    edgeFitResidualMm: 0.6,
    minSideCoverage: 0.92,
    parallaxCorrected: true,
  },
  measurementModelVersion: MEASUREMENT_MODEL_VERSION,
});

function fakeStorage() {
  const items = new Map<string, string>();
  return {
    items,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}
const respond = (status: number): typeof fetch =>
  (async () =>
    new Response(
      JSON.stringify(status === 201 ? { scanId: SCAN_ID } : { error: "no" }),
      { status, headers: { "content-type": "application/json" } },
    )) as typeof fetch;

describe("rememberScanDisclosures / submitAndRemember", () => {
  it("manual-entry, 201: the pair is kept under the manual key, and never under the typed-length key", async () => {
    const storage = fakeStorage();
    const outcome = await submitAndRemember(MANUAL, storage, respond(201));
    expect(outcome.status).toBe("success");
    expect([...storage.items.keys()]).toEqual([resultManualEntryKey(SCAN_ID)]);
    expect(storage.items.get(resultManualEntryKey(SCAN_ID))).toBe(
      JSON.stringify({ handLengthMm: 185, handWidthMm: 82 }),
    );
    expect(storage.items.has(resultLengthKey(SCAN_ID))).toBe(false);
  });

  it("typed length, 201: only the length key", async () => {
    const storage = fakeStorage();
    await submitAndRemember(TYPED_LENGTH, storage, respond(201));
    expect([...storage.items.entries()]).toEqual([
      [resultLengthKey(SCAN_ID), "186"],
    ]);
  });

  it("a scan measured from a photo writes nothing", async () => {
    const storage = fakeStorage();
    await submitAndRemember(PAPER, storage, respond(201));
    expect(storage.items.size).toBe(0);
  });

  it("every failure writes nothing, for a typed pair and a typed length", async () => {
    for (const submission of [MANUAL, TYPED_LENGTH]) {
      for (const status of [400, 413, 429, 500]) {
        const storage = fakeStorage();
        const outcome = await submitAndRemember(
          submission,
          storage,
          respond(status),
        );
        expect(outcome.status, String(status)).toBe("error");
        expect(storage.items.size, String(status)).toBe(0);
      }
      const storage = fakeStorage();
      const offline = (async () => {
        throw new TypeError("offline");
      }) as typeof fetch;
      const outcome = await submitAndRemember(submission, storage, offline);
      expect(outcome).toMatchObject({ status: "error", kind: "network" });
      expect(storage.items.size).toBe(0);
    }
  });

  it("blocked storage does not break the send", async () => {
    const throwing = {
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const outcome = await submitAndRemember(MANUAL, throwing, respond(201));
    expect(outcome.status).toBe("success");
    expect(() =>
      rememberScanDisclosures(throwing, MANUAL, SCAN_ID),
    ).not.toThrow();
    expect(() => rememberScanDisclosures(null, MANUAL, SCAN_ID)).not.toThrow();
  });
});
