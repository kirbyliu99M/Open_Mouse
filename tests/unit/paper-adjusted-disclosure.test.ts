/**
 * V3.2 F2 (candidate): after a scan whose paper frame was placed or moved by
 * hand, the results page says 「紙張邊框是手動調整的」. Like the typed-size
 * notes, the fact is kept per scan in this browser after a 201, and only the
 * value "1" is kept. What is sent is the contract's submission, numbers only.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ResultsView } from "../../src/components/results/ResultsView";
import { FIXTURES } from "../../src/components/results/fixtures";
import {
  clearScanDisclosures,
  parseStoredPaperAdjusted,
  readScanDisclosures,
  resultLengthKey,
  resultManualEntryKey,
  resultPaperAdjustedKey,
} from "../../src/components/results/userLengthDisclosure";
import {
  rememberScanDisclosures,
  submitAndRemember,
} from "../../src/client/scan/submitAndRemember";
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
  type ScanSubmission,
} from "../../src/lib/contracts/measurement";
import { RESULTS_PAGE_COPY } from "../../src/lib/copy/results-page";

const SCAN_ID = "623e4567-e89b-12d3-a456-426614174011";
const paper = (extra: Record<string, unknown>): ScanSubmission =>
  scanSubmissionSchema.parse({
    hand: "right",
    measurements: { handLengthMm: 186, palmLengthMm: 106, palmWidthMm: 82 },
    calibration: {
      method: "paper-edge",
      paperSize: "a4",
      parallaxCorrected: true,
      ...extra,
    },
    measurementModelVersion: MEASUREMENT_MODEL_VERSION,
  });
const ADJUSTED = paper({ cornersSource: "adjusted" });
const MANUAL = paper({ cornersSource: "manual" });
const AUTO = paper({ edgeFitResidualMm: 0.6, minSideCoverage: 0.92 });

function fakeStorage() {
  const items = new Map<string, string>();
  return {
    items,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}
const respond = (status: number) =>
  vi.fn(
    async () =>
      new Response(
        JSON.stringify(status === 201 ? { scanId: SCAN_ID } : { error: "no" }),
        { status, headers: { "content-type": "application/json" } },
      ),
  );

describe("remembering an adjusted frame", () => {
  it("adjusted and manual corners, 201: one key, value 1, and no other note", async () => {
    for (const submission of [ADJUSTED, MANUAL]) {
      const storage = fakeStorage();
      await submitAndRemember(submission, storage, respond(201) as never);
      expect([...storage.items.entries()]).toEqual([
        [resultPaperAdjustedKey(SCAN_ID), "1"],
      ]);
    }
  });

  it("the detector's own corners write nothing, and a failed send writes nothing", async () => {
    const storage = fakeStorage();
    await submitAndRemember(AUTO, storage, respond(201) as never);
    expect(storage.items.size).toBe(0);
    const failed = fakeStorage();
    await submitAndRemember(ADJUSTED, failed, respond(500) as never);
    expect(failed.items.size).toBe(0);
  });

  it("is its own key per scan, read as true only for 1, and cleared with the others", () => {
    expect(resultPaperAdjustedKey("a")).not.toBe(resultLengthKey("a"));
    expect(resultPaperAdjustedKey("a")).not.toBe(resultManualEntryKey("a"));
    expect(resultPaperAdjustedKey("a")).not.toBe(resultPaperAdjustedKey("b"));
    expect(parseStoredPaperAdjusted("1")).toBe(true);
    for (const raw of [null, "", "0", "true", "yes", " 1"])
      expect(parseStoredPaperAdjusted(raw)).toBe(false);
    const values = new Map([
      [resultPaperAdjustedKey("listed"), "1"],
      [resultPaperAdjustedKey("unlisted"), "1"],
    ]);
    clearScanDisclosures({ removeItem: (key: string) => values.delete(key) }, [
      "listed",
    ]);
    expect([...values.keys()]).toEqual([resultPaperAdjustedKey("unlisted")]);
    expect(() =>
      rememberScanDisclosures(null, ADJUSTED, SCAN_ID),
    ).not.toThrow();
  });

  it("the request is the submission and nothing else: numbers, no picture", async () => {
    const fetchImpl = respond(201);
    await submitAndRemember(MANUAL, fakeStorage(), fetchImpl as never);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = String(init.body);
    expect(JSON.parse(body)).toEqual(MANUAL);
    expect(body).not.toMatch(/blob:|data:|base64|image\//i);
    expect(scanSubmissionSchema.safeParse(JSON.parse(body)).success).toBe(true);
  });
});

describe("the results page line", () => {
  const response = FIXTURES["high-confidence"];
  const render = (props: Record<string, unknown>, language: "zh-TW" | "en") =>
    renderToStaticMarkup(
      createElement(ResultsView, { response, language, ...props }),
    );

  it("says the frame was adjusted by hand, in both languages, only when it was", () => {
    expect(render({ paperAdjusted: true }, "zh-TW")).toContain(
      "紙張邊框是手動調整的。",
    );
    expect(render({ paperAdjusted: true }, "en")).toContain(
      "The paper&#x27;s frame was adjusted by hand.",
    );
    for (const props of [{}, { paperAdjusted: false }])
      expect(render(props, "zh-TW")).not.toContain("results-paper-adjusted");
    expect(RESULTS_PAGE_COPY["zh-TW"].paperAdjustedNotice).toBe(
      "紙張邊框是手動調整的。",
    );
  });
});

describe("from this browser to the results page (the wiring between the two ends)", () => {
  const fakeStorage = (entries: Record<string, string>) => ({
    getItem: (key: string) =>
      Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null,
  });

  it("readScanDisclosures reads each note from its own key, for this scan only", () => {
    const other = "723e4567-e89b-12d3-a456-426614174099";
    expect(
      readScanDisclosures(
        fakeStorage({
          [resultPaperAdjustedKey(SCAN_ID)]: "1",
          [resultLengthKey(SCAN_ID)]: "190",
          [resultManualEntryKey(other)]: JSON.stringify({
            handLengthMm: 190,
            handWidthMm: 85,
          }),
        }),
        SCAN_ID,
      ),
    ).toEqual({ enteredLength: 190, enteredManual: null, paperAdjusted: true });
    // The adjusted note is read from its own key, not another note's.
    expect(
      readScanDisclosures(
        fakeStorage({
          [resultManualEntryKey(SCAN_ID)]: "1",
          [resultLengthKey(SCAN_ID)]: "1",
        }),
        SCAN_ID,
      ).paperAdjusted,
    ).toBe(false);
    expect(
      readScanDisclosures(
        fakeStorage({ [resultPaperAdjustedKey(other)]: "1" }),
        SCAN_ID,
      ),
    ).toEqual({
      enteredLength: null,
      enteredManual: null,
      paperAdjusted: false,
    });
  });

  // The repo has no DOM test library: the two components are locked by their
  // source, as result-fingerprint.test.ts does for the same files.
  it("the provider reads the notes with readScanDisclosures and hands paperAdjusted on", () => {
    const provider = readFileSync(
      "src/app/results/[scanId]/ResultsScanProvider.tsx",
      "utf8",
    );
    expect(provider).toContain(
      "const notes = readScanDisclosures(localStorage, scanId);",
    );
    expect(provider).toContain("setPaperAdjusted(notes.paperAdjusted);");
    expect(provider).toContain("setEnteredLength(notes.enteredLength);");
    expect(provider).toContain("setEnteredManual(notes.enteredManual);");
    // ...into the value the page reads.
    expect(
      provider.match(/^\s*paperAdjusted,$/gm)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
  });

  it("the ranking page passes it to ResultsView", () => {
    const rank = readFileSync(
      "src/app/results/[scanId]/ResultsRankClient.tsx",
      "utf8",
    );
    expect(rank).toContain("paperAdjusted={scan.paperAdjusted}");
  });
});
