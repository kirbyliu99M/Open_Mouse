/**
 * V3.2 F13 (candidate): a scan measured with a frame placed by hand after the
 * detector found the sheet curled (`PAPER_CURLED`) gets one more line in the
 * results page's notes: 「紙張可能沒有完全平貼，數字僅供參考。」. The fact is kept
 * in this browser only (like F2's adjusted-frame note), written after a 201,
 * and never sent: the submission and the contract are unchanged.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ResultsView } from "../../src/components/results/ResultsView";
import { FIXTURES } from "../../src/components/results/fixtures";
import {
  clearScanDisclosures,
  parseStoredPaperCurled,
  readScanDisclosures,
  resultPaperAdjustedKey,
  resultPaperCurledKey,
} from "../../src/components/results/userLengthDisclosure";
import { submitAndRemember } from "../../src/client/scan/submitAndRemember";
import {
  adjustWarningFor,
  paperCurledNoteFor,
} from "../../src/client/camera/paperAdjustState";
import {
  MEASUREMENT_MODEL_VERSION,
  scanSubmissionSchema,
  type ScanSubmission,
} from "../../src/lib/contracts/measurement";
import { RESULTS_PAGE_COPY } from "../../src/lib/copy/results-page";

const SCAN_ID = "623e4567-e89b-12d3-a456-426614174012";
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
const TYPED = scanSubmissionSchema.parse({
  hand: "right",
  measurements: { handLengthMm: 186, palmLengthMm: 106, palmWidthMm: 82 },
  calibration: {
    method: "user-length",
    referenceMeasurement: "handLengthMm",
    referenceMm: 186,
    parallaxCorrected: false,
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
const respond = (status: number) =>
  vi.fn(
    async () =>
      new Response(
        JSON.stringify(status === 201 ? { scanId: SCAN_ID } : { error: "no" }),
        { status, headers: { "content-type": "application/json" } },
      ),
  );

describe("when the note is due (paperCurledNoteFor)", () => {
  it("only a hand-placed frame after a curled sheet", () => {
    for (const submission of [ADJUSTED, MANUAL])
      expect(paperCurledNoteFor({ submission, curledBefore: true })).toBe(true);
    for (const submission of [AUTO, TYPED])
      expect(paperCurledNoteFor({ submission, curledBefore: true })).toBe(
        false,
      );
    for (const submission of [ADJUSTED, MANUAL, AUTO])
      expect(paperCurledNoteFor({ submission, curledBefore: false })).toBe(
        false,
      );
  });

  it("curled is the PAPER_CURLED warning the adjustment screen already shows", () => {
    const failure = (code: string) =>
      ({
        kind: "gateFailure",
        previewUrl: "blob:x",
        overlay: null,
        errors: [{ code, message: "x" }],
        imageWidth: 1,
        imageHeight: 1,
      }) as never;
    expect(adjustWarningFor(failure("PAPER_CURLED"))).toBe("curled");
    expect(adjustWarningFor(failure("PAPER_EDGE_HIDDEN"))).toBeNull();
  });
});

describe("remembering it in this browser", () => {
  it("a 201 with the note writes the curled key next to the adjusted one, value 1", async () => {
    for (const submission of [ADJUSTED, MANUAL]) {
      const storage = fakeStorage();
      await submitAndRemember(submission, storage, respond(201) as never, {
        paperCurled: true,
      });
      expect(new Map(storage.items)).toEqual(
        new Map([
          [resultPaperAdjustedKey(SCAN_ID), "1"],
          [resultPaperCurledKey(SCAN_ID), "1"],
        ]),
      );
    }
  });

  it("no note, a detector frame, a typed size or a failed send: no curled key", async () => {
    const none = fakeStorage();
    await submitAndRemember(ADJUSTED, none, respond(201) as never);
    expect(none.items.has(resultPaperCurledKey(SCAN_ID))).toBe(false);
    for (const submission of [AUTO, TYPED]) {
      const storage = fakeStorage();
      await submitAndRemember(submission, storage, respond(201) as never, {
        paperCurled: true,
      });
      expect(storage.items.has(resultPaperCurledKey(SCAN_ID))).toBe(false);
    }
    const failed = fakeStorage();
    await submitAndRemember(ADJUSTED, failed, respond(500) as never, {
      paperCurled: true,
    });
    expect(failed.items.size).toBe(0);
  });

  it("the request is the submission alone: the note is never sent", async () => {
    const fetchImpl = respond(201);
    await submitAndRemember(ADJUSTED, fakeStorage(), fetchImpl as never, {
      paperCurled: true,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toEqual(ADJUSTED);
    expect(String(init.body)).not.toMatch(/curl/i);
  });

  it("is its own key per scan, read as true only for 1, read back and cleared with the others", () => {
    expect(resultPaperCurledKey("a")).not.toBe(resultPaperAdjustedKey("a"));
    expect(resultPaperCurledKey("a")).not.toBe(resultPaperCurledKey("b"));
    expect(parseStoredPaperCurled("1")).toBe(true);
    for (const raw of [null, "", "0", "true", " 1"])
      expect(parseStoredPaperCurled(raw)).toBe(false);
    const entries: Record<string, string> = {
      [resultPaperAdjustedKey(SCAN_ID)]: "1",
      [resultPaperCurledKey(SCAN_ID)]: "1",
    };
    const read = readScanDisclosures(
      { getItem: (k: string) => entries[k] ?? null },
      SCAN_ID,
    );
    expect(read.paperAdjusted).toBe(true);
    expect(read.paperCurled).toBe(true);
    expect(
      readScanDisclosures({ getItem: () => null }, SCAN_ID).paperCurled,
    ).toBe(false);
    const values = new Map(Object.entries(entries));
    clearScanDisclosures({ removeItem: (k: string) => values.delete(k) }, [
      SCAN_ID,
    ]);
    expect(values.size).toBe(0);
  });
});

describe("the results page line", () => {
  const response = FIXTURES["high-confidence"];
  const render = (props: Record<string, unknown>, language: "zh-TW" | "en") =>
    renderToStaticMarkup(
      createElement(ResultsView, { response, language, ...props }),
    );

  it("says the paper may not have been flat, in both languages, only when noted", () => {
    const zh = render({ paperAdjusted: true, paperCurled: true }, "zh-TW");
    expect(zh).toContain("紙張邊框是手動調整的。");
    expect(zh).toContain("紙張可能沒有完全平貼，數字僅供參考。");
    expect(zh.indexOf("紙張邊框")).toBeLessThan(zh.indexOf("紙張可能"));
    expect(render({ paperAdjusted: true, paperCurled: true }, "en")).toContain(
      "The paper may not have been lying flat, so treat the numbers as a guide.",
    );
    for (const props of [{}, { paperAdjusted: true }, { paperCurled: false }])
      expect(render(props, "zh-TW")).not.toContain("results-paper-curled");
    expect(RESULTS_PAGE_COPY["zh-TW"].paperCurledNotice).toBe(
      "紙張可能沒有完全平貼，數字僅供參考。",
    );
  });

  // No DOM test library: the wiring is pinned by its source, as
  // paper-adjusted-disclosure.test.ts does for the adjusted note.
  it("the provider reads it and the ranking page passes it on; the scan page sends it as a local note", () => {
    const provider = readFileSync(
      "src/app/results/[scanId]/ResultsScanProvider.tsx",
      "utf8",
    );
    expect(provider).toContain("setPaperCurled(notes.paperCurled);");
    expect(
      provider.match(/^\s*paperCurled,$/gm)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(
      readFileSync("src/app/results/[scanId]/ResultsRankClient.tsx", "utf8"),
    ).toContain("paperCurled={scan.paperCurled}");
    const camera = readFileSync(
      "src/client/camera/EasyScanCamera.tsx",
      "utf8",
    ).replace(/\r\n/g, "\n");
    expect(camera).toMatch(
      /if \(adjustWarningFor\(current\) === "curled"\)\s*curledBeforeRef\.current = true;/,
    );
    expect(camera).toMatch(
      /if \(!paperInput\.pipeline\.manualPaperCorners\)\s*curledBeforeRef\.current = false;/,
    );
    expect(camera).toMatch(
      /paperCurled: paperCurledNoteFor\(\{\s*submission,\s*curledBefore: curledBeforeRef\.current,\s*\}\)/,
    );
  });
});
