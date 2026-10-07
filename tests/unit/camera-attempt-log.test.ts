import { describe, expect, it } from "vitest";
import {
  ATTEMPT_LOG_KEY,
  MAX_ATTEMPTS,
  appendAttempt,
  buildAttemptRecord,
  mergeAttempts,
  describeAttempt,
  parseAttempts,
  readAttempts,
  recordAttempt,
  sanitizeAttempt,
  serialiseAttempts,
  writeAttempts,
  type AttemptCapture,
  type AttemptRecord,
} from "../../src/client/camera/attemptLog";
import type { StorageLike } from "../../src/client/camera/easyScanPreferences";
import type { PipelineResult } from "../../src/client/photo/pipeline";
import type { PipelineDiagnostics } from "../../src/client/photo/diagnostics";

const CAPTURE: AttemptCapture = {
  method: "takePhoto",
  photoWidth: 3000,
  photoHeight: 4000,
  photoKb: 4403.2,
  previewWidth: 1080,
  previewHeight: 1920,
};

const DIAGNOSTICS: PipelineDiagnostics = {
  decodeMs: 311.4,
  paperMs: 402.8,
  handMs: 187.2,
  totalMs: 1204.9,
  decoded: { width: 2250, height: 3000 },
  analysed: { width: 1686, height: 3000 },
  fovCrop: { x: 282, y: 0, width: 1686, height: 3000 },
  view: {
    stream: { width: 1080, height: 1920 },
    visibleInStream: { x: 96.4, y: 0, width: 887.2, height: 1920 },
    model: "stream-in-still",
    modelApplies: true,
    aspectDiff: 0.33333,
  },
  paper: {
    cornersSeen: 4,
    paperRegionFound: true,
    widthFraction: 0.8123456,
    heightFraction: 0.7654321,
    edgeFitResidualMm: 1.62345,
    minSideCoverage: 0.71234,
    gateFailures: ["PAPER_CURLED"],
  },
  laplacianVariance: 142.3456,
  hand: { detected: true, confidence: 0.91234, handedness: "left" },
  parallaxCorrected: null,
  measured: { handLengthMm: null, palmWidthMm: null },
  focal: null,
};

const ERROR_RESULT: PipelineResult = {
  status: "error",
  errors: [
    { code: "PAPER_CURLED", message: "The paper doesn't look flat." },
    { code: "LOW_LANDMARK_CONFIDENCE", message: "The hand wasn't clear." },
  ],
  overlay: {
    imageWidth: 2250,
    imageHeight: 3000,
    markers: [],
    card: null,
    landmarksPx: null,
  },
  diagnostics: DIAGNOSTICS,
};

function record(overrides: Record<string, unknown> = {}): AttemptRecord {
  const base = buildAttemptRecord({
    at: new Date("2026-10-06T10:20:30.456Z"),
    userAgent: "Android 15; SM-S931B · Chrome/141",
    capture: CAPTURE,
    outcome: { kind: "result", result: ERROR_RESULT },
  });
  const sanitised = sanitizeAttempt({ ...base, ...overrides });
  if (!sanitised) throw new Error("test record did not sanitise");
  return sanitised;
}

/** An in-memory store that can be made to fail. */
function fakeStorage(
  options: {
    initial?: string;
    getThrows?: boolean;
    setThrows?: boolean;
  } = {},
) {
  const data = new Map<string, string>();
  if (options.initial !== undefined) data.set(ATTEMPT_LOG_KEY, options.initial);
  const storage: StorageLike = {
    getItem: (key) => {
      if (options.getThrows) throw new Error("blocked");
      return data.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (options.setThrows) throw new Error("quota");
      data.set(key, value);
    },
  };
  return { storage, data };
}

describe("buildAttemptRecord", () => {
  it("records a rejected photo with every error, not only the first", () => {
    const r = record();
    expect(r.result).toBe("error");
    expect(r.errors.map((e) => e.code)).toEqual([
      "PAPER_CURLED",
      "LOW_LANDMARK_CONFIDENCE",
    ]);
    expect(r.errors[0].message).toBe("The paper doesn't look flat.");
  });

  it("carries the sizes, the preview, the paper's share of the photo, the residual and the coverage", () => {
    const r = record();
    expect(r.at).toBe("2026-10-06T10:20:30.456Z");
    expect(r.method).toBe("takePhoto");
    expect(r.photo).toEqual({ width: 3000, height: 4000, kb: 4403 });
    expect(r.preview.width).toBe(1080);
    expect(r.preview.height).toBe(1920);
    // 16:9 against 4:3.
    expect(r.preview.aspectDiff).toBeCloseTo(0.3333, 3);
    expect(r.preview.fovMismatch).toBe(true);
    expect(r.paper).toEqual({
      cornersSeen: 4,
      widthFraction: 0.8123,
      heightFraction: 0.7654,
      edgeFitResidualMm: 1.623,
      minSideCoverage: 0.712,
      gateFailures: ["PAPER_CURLED"],
    });
    expect(r.sharpness).toBe(142.35);
  });

  it("carries the hand, the crop and the timings", () => {
    const r = record();
    expect(r.hand).toEqual({
      detected: true,
      confidence: 0.912,
      handedness: "left",
    });
    expect(r.analysed).toEqual({
      width: 1686,
      height: 3000,
      crop: { x: 282, y: 0, width: 1686, height: 3000 },
    });
    expect(r.timingMs).toEqual({
      decode: 311,
      paper: 403,
      hand: 187,
      total: 1205,
    });
    expect(r.userAgent).toBe("Android 15; SM-S931B · Chrome/141");
    expect(r.v).toBe(1);
  });

  it("a measured photo is ok, with its warnings by code and the parallax flag", () => {
    const ok = buildAttemptRecord({
      at: "2026-10-06T10:20:30.000Z",
      userAgent: "x",
      capture: { ...CAPTURE, previewWidth: 1080, previewHeight: 1440 },
      outcome: {
        kind: "result",
        result: {
          status: "ok",
          measurements: {} as never,
          submission: {} as never,
          warnings: [{ code: "LOW_SHARPNESS", message: "A little blurry." }],
          overlay: ERROR_RESULT.overlay,
          diagnostics: {
            ...DIAGNOSTICS,
            parallaxCorrected: true,
            fovCrop: null,
          },
        },
      },
    });
    expect(ok.result).toBe("ok");
    expect(ok.errors).toEqual([]);
    expect(ok.warnings).toEqual(["LOW_SHARPNESS"]);
    expect(ok.parallaxCorrected).toBe(true);
    expect(ok.analysed.crop).toBeNull();
    // A 3:4 preview against a 3:4 photo: the same field of view.
    expect(ok.preview.fovMismatch).toBe(false);
    expect(ok.preview.aspectDiff).toBe(0);
  });

  it("an upload has no preview, so no flag either", () => {
    const upload = buildAttemptRecord({
      at: "2026-10-06T10:20:30.000Z",
      userAgent: "x",
      capture: {
        method: "upload",
        photoWidth: 3000,
        photoHeight: 4000,
        photoKb: 1200,
        previewWidth: null,
        previewHeight: null,
      },
      outcome: { kind: "result", result: ERROR_RESULT },
    });
    expect(upload.method).toBe("upload");
    expect(upload.preview).toEqual({
      width: null,
      height: null,
      aspectDiff: null,
      fovMismatch: null,
    });
  });

  it("a pipeline that threw is one error with the code it was given", () => {
    const thrown = buildAttemptRecord({
      at: "2026-10-06T10:20:30.000Z",
      userAgent: "x",
      capture: CAPTURE,
      outcome: {
        kind: "thrown",
        code: "DETECTOR_LOAD_FAILED",
        message: "Failed to load the MediaPipe HandLandmarker.",
      },
    });
    expect(thrown.result).toBe("error");
    expect(thrown.errors).toEqual([
      {
        code: "DETECTOR_LOAD_FAILED",
        message: "Failed to load the MediaPipe HandLandmarker.",
      },
    ]);
    expect(thrown.paper).toBeNull();
    expect(thrown.hand.detected).toBeNull();
    expect(thrown.timingMs.total).toBeNull();
  });

  it("a result with no diagnostics (a demo pipeline) is still a record, with the unknowns null", () => {
    const bare = buildAttemptRecord({
      at: "2026-10-06T10:20:30.000Z",
      userAgent: "x",
      capture: CAPTURE,
      outcome: {
        kind: "result",
        result: { ...ERROR_RESULT, diagnostics: undefined },
      },
    });
    expect(bare.paper).toBeNull();
    expect(bare.sharpness).toBeNull();
    expect(bare.analysed).toEqual({ width: null, height: null, crop: null });
    expect(bare.errors).toHaveLength(2);
  });

  it("an unexpected 'needs a card' result is recorded as UNEXPECTED, as the screen shows it", () => {
    const odd = buildAttemptRecord({
      at: "2026-10-06T10:20:30.000Z",
      userAgent: "x",
      capture: CAPTURE,
      outcome: {
        kind: "result",
        result: { status: "needsManualCard", overlay: ERROR_RESULT.overlay },
      },
    });
    expect(odd.errors.map((e) => e.code)).toEqual(["UNEXPECTED"]);
  });
});

describe("the ring buffer", () => {
  it("keeps the newest 20 and drops the oldest", () => {
    let list: AttemptRecord[] = [];
    for (let i = 0; i < 25; i++)
      list = appendAttempt(
        list,
        record({ at: new Date(Date.UTC(2026, 9, 6, 10, 0, i)).toISOString() }),
      );
    expect(MAX_ATTEMPTS).toBe(20);
    expect(list).toHaveLength(20);
    expect(list[0].at).toBe("2026-10-06T10:00:05.000Z");
    expect(list[19].at).toBe("2026-10-06T10:00:24.000Z");
  });

  it("adds to the end and does not change the list it was given", () => {
    const before = [record({ at: "2026-10-06T10:00:00.000Z" })];
    const after = appendAttempt(
      before,
      record({ at: "2026-10-06T10:00:01.000Z" }),
    );
    expect(before).toHaveLength(1);
    expect(after.map((r) => r.at)).toEqual([
      "2026-10-06T10:00:00.000Z",
      "2026-10-06T10:00:01.000Z",
    ]);
  });

  it("does not add something that is not a record", () => {
    const list = [record()];
    for (const junk of [
      null,
      undefined,
      5,
      "x",
      [],
      {},
      { at: "nope", result: "ok" },
    ])
      expect(appendAttempt(list, junk), JSON.stringify(junk)).toHaveLength(1);
  });

  it("takes the limit as an argument", () => {
    let list: AttemptRecord[] = [];
    for (let i = 0; i < 5; i++) list = appendAttempt(list, record(), 3);
    expect(list).toHaveLength(3);
  });
});

describe("parseAttempts — bad data in storage", () => {
  it("is empty for nothing, for text that is not JSON and for JSON that is not a list", () => {
    for (const raw of [
      null,
      undefined,
      "",
      "not json",
      "{",
      "{}",
      "42",
      '"x"',
      "null",
    ])
      expect(parseAttempts(raw), String(raw)).toEqual([]);
  });

  it("skips the entries that are not records and keeps the ones that are", () => {
    const good = record({ at: "2026-10-06T10:00:00.000Z" });
    const raw = JSON.stringify([
      null,
      7,
      "text",
      { result: "ok" },
      good,
      { at: "2026-10-06T10:00:01.000Z", result: "maybe" },
      [],
    ]);
    expect(parseAttempts(raw)).toEqual([good]);
  });

  it("keeps at most the newest 20 of an over-long list", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      record({ at: new Date(Date.UTC(2026, 9, 6, 10, 0, i)).toISOString() }),
    );
    const parsed = parseAttempts(JSON.stringify(many));
    expect(parsed).toHaveLength(20);
    expect(parsed[0].at).toBe("2026-10-06T10:00:10.000Z");
  });

  it("round-trips what it wrote", () => {
    const list = [
      record({ at: "2026-10-06T10:00:00.000Z" }),
      record({ at: "2026-10-06T10:00:01.000Z", result: "ok", errors: [] }),
    ];
    expect(parseAttempts(serialiseAttempts(list))).toEqual(list);
  });

  it("a record with wrong types in it is rebuilt with those fields null, not trusted", () => {
    const parsed = parseAttempts(
      JSON.stringify([
        {
          at: "2026-10-06T10:00:00.000Z",
          result: "error",
          method: "teleport",
          photo: { width: "3000", height: {}, kb: Infinity },
          preview: { fovMismatch: "yes", aspectDiff: [1] },
          errors: "PAPER_CURLED",
          hand: { handedness: "both", confidence: "high" },
          timingMs: null,
        },
      ]),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].method).toBeNull();
    expect(parsed[0].photo).toEqual({ width: null, height: null, kb: null });
    expect(parsed[0].preview.fovMismatch).toBeNull();
    expect(parsed[0].preview.aspectDiff).toBeNull();
    expect(parsed[0].errors).toEqual([]);
    expect(parsed[0].hand).toEqual({
      detected: null,
      confidence: null,
      handedness: null,
    });
    expect(parsed[0].timingMs).toEqual({
      decode: null,
      paper: null,
      hand: null,
      total: null,
    });
  });
});

describe("storage that is missing or broken", () => {
  it("reads null with no storage, and null when reading throws", () => {
    expect(readAttempts(null)).toBeNull();
    expect(readAttempts(fakeStorage({ getThrows: true }).storage)).toBeNull();
  });

  it("reads an empty list from an empty store, and what was written back", () => {
    const { storage } = fakeStorage();
    expect(readAttempts(storage)).toEqual([]);
    const list = [record()];
    writeAttempts(storage, list);
    expect(readAttempts(storage)).toEqual(list);
  });

  it("writing never throws: a full or blocked store, or no store", () => {
    expect(() =>
      writeAttempts(fakeStorage({ setThrows: true }).storage, [record()]),
    ).not.toThrow();
    expect(() => writeAttempts(null, [record()])).not.toThrow();
  });

  it("recordAttempt adds to what is stored, and returns the new list", () => {
    const { storage, data } = fakeStorage();
    const a = recordAttempt(
      storage,
      record({ at: "2026-10-06T10:00:00.000Z" }),
    );
    const b = recordAttempt(
      storage,
      record({ at: "2026-10-06T10:00:01.000Z" }),
      a,
    );
    expect(b).toHaveLength(2);
    expect(parseAttempts(data.get(ATTEMPT_LOG_KEY))).toEqual(b);
  });

  it("recordAttempt re-reads the store, so another tab's attempts are not overwritten", () => {
    const { storage } = fakeStorage();
    recordAttempt(storage, record({ at: "2026-10-06T10:00:00.000Z" }));
    // This page's own copy is stale (empty): the store is what counts.
    const next = recordAttempt(
      storage,
      record({ at: "2026-10-06T10:00:01.000Z" }),
      [],
    );
    expect(next.map((r) => r.at)).toEqual([
      "2026-10-06T10:00:00.000Z",
      "2026-10-06T10:00:01.000Z",
    ]);
  });

  it("with no storage the page's own copy is added to, so the panel still shows this session", () => {
    const first = recordAttempt(
      null,
      record({ at: "2026-10-06T10:00:00.000Z" }),
    );
    const second = recordAttempt(
      null,
      record({ at: "2026-10-06T10:00:01.000Z" }),
      first,
    );
    expect(second).toHaveLength(2);
  });

  it("a store that can be read but not written (a full quota) still gives back every attempt of the session", () => {
    // The panel shows what recordAttempt returns: with the store refusing every
    // write, the stored list stays empty, and the session's list must not
    // shrink to the newest record.
    const { storage } = fakeStorage({ setThrows: true });
    let session: AttemptRecord[] = [];
    for (let i = 0; i < 3; i++)
      session = recordAttempt(
        storage,
        record({ at: `2026-10-06T10:00:0${i}.000Z` }),
        session,
      );
    expect(session.map((r) => r.at)).toEqual([
      "2026-10-06T10:00:00.000Z",
      "2026-10-06T10:00:01.000Z",
      "2026-10-06T10:00:02.000Z",
    ]);
    expect(readAttempts(storage)).toEqual([]);
  });

  it("a store that can be written is the truth: a log deleted in another tab does not come back from this page's copy", () => {
    const { storage, data } = fakeStorage();
    let session = recordAttempt(
      storage,
      record({ at: "2026-10-06T10:00:00.000Z" }),
    );
    session = recordAttempt(
      storage,
      record({ at: "2026-10-06T10:00:01.000Z" }),
      session,
    );
    expect(session).toHaveLength(2);
    // The person deletes their data in another tab.
    data.delete(ATTEMPT_LOG_KEY);
    session = recordAttempt(
      storage,
      record({ at: "2026-10-06T10:00:02.000Z" }),
      session,
    );
    expect(session.map((r) => r.at)).toEqual(["2026-10-06T10:00:02.000Z"]);
    expect(readAttempts(storage)?.map((r) => r.at)).toEqual([
      "2026-10-06T10:00:02.000Z",
    ]);
  });

  it("writeAttempts says whether the store took the list", () => {
    expect(writeAttempts(fakeStorage().storage, [record()])).toBe(true);
    expect(
      writeAttempts(fakeStorage({ setThrows: true }).storage, [record()]),
    ).toBe(false);
    expect(writeAttempts(null, [record()])).toBe(false);
  });

  it("a store that is written by another tab as well adds its records to the session's, in time order, without repeats", () => {
    const { storage } = fakeStorage();
    const mine = recordAttempt(
      storage,
      record({ at: "2026-10-06T10:00:00.000Z" }),
    );
    // Another tab writes a record and this page does not know.
    writeAttempts(storage, [
      ...mine,
      record({ at: "2026-10-06T10:00:05.000Z", method: "canvas" }),
    ]);
    const next = recordAttempt(
      storage,
      record({ at: "2026-10-06T10:00:09.000Z" }),
      mine,
    );
    expect(next.map((r) => r.at)).toEqual([
      "2026-10-06T10:00:00.000Z",
      "2026-10-06T10:00:05.000Z",
      "2026-10-06T10:00:09.000Z",
    ]);
  });

  it("a store that throws on read falls back to the page's copy, and a throwing write loses nothing in memory", () => {
    const { storage } = fakeStorage({ getThrows: true, setThrows: true });
    const first = recordAttempt(
      storage,
      record({ at: "2026-10-06T10:00:00.000Z" }),
    );
    const second = recordAttempt(
      storage,
      record({ at: "2026-10-06T10:00:01.000Z" }),
      first,
    );
    expect(second).toHaveLength(2);
  });
});

describe("no image can be in a record", () => {
  const FAKE_DATA_URL = `data:image/jpeg;base64,${"A".repeat(5_000_000)}`;

  /** Every string in a value, however deep. */
  function strings(value: unknown, out: string[] = []): string[] {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) for (const v of value) strings(v, out);
    else if (value && typeof value === "object")
      for (const v of Object.values(value)) strings(v, out);
    return out;
  }

  it("a data URL in an error message, a code, the user agent or a time is taken out", () => {
    const hostile = buildAttemptRecord({
      at: new Date("2026-10-06T10:20:30.000Z"),
      userAgent: `UA ${FAKE_DATA_URL}`,
      capture: CAPTURE,
      outcome: {
        kind: "result",
        result: {
          ...ERROR_RESULT,
          errors: [
            { code: FAKE_DATA_URL, message: FAKE_DATA_URL },
            { code: "OK_CODE", message: `see ${FAKE_DATA_URL} here` },
          ],
        },
      },
    });
    const json = JSON.stringify(hostile);
    expect(json).not.toMatch(/data:/i);
    expect(json).not.toMatch(/base64/i);
    expect(json.length).toBeLessThan(5000);
  });

  it("no string in a record is longer than 200 characters, whatever went in", () => {
    const long = "x".repeat(100_000);
    const hostile = sanitizeAttempt({
      at: "2026-10-06T10:20:30.000Z",
      result: "error",
      method: long,
      errors: [{ code: long, message: long }],
      warnings: [long, long],
      paper: { gateFailures: [long] },
      userAgent: long,
      photo: { width: long },
      extra: long,
      image: FAKE_DATA_URL,
      canvas: { toDataURL: FAKE_DATA_URL },
    });
    expect(hostile).not.toBeNull();
    for (const s of strings(hostile))
      expect(s.length, s.slice(0, 20)).toBeLessThanOrEqual(200);
    expect(Object.keys(hostile!)).not.toContain("image");
    expect(Object.keys(hostile!)).not.toContain("extra");
    expect(Object.keys(hostile!)).not.toContain("canvas");
  });

  it("a record of a real run has no string over 200 characters and is a few hundred bytes", () => {
    const r = record();
    for (const s of strings(r)) expect(s.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(r).length).toBeLessThan(1500);
  });

  it("a full ring of the most a record can hold stays small", () => {
    const fat = sanitizeAttempt({
      at: "2026-10-06T10:20:30.000Z",
      result: "error",
      errors: Array.from({ length: 50 }, () => ({
        code: "C".repeat(500),
        message: "m".repeat(5000),
      })),
      warnings: Array.from({ length: 50 }, () => "w".repeat(500)),
      userAgent: "u".repeat(5000),
    })!;
    let list: AttemptRecord[] = [];
    for (let i = 0; i < 40; i++) list = appendAttempt(list, fat);
    expect(list).toHaveLength(20);
    expect(serialiseAttempts(list).length).toBeLessThan(80_000);
  });

  it("numbers that are not finite become null; the rest are rounded", () => {
    const r = sanitizeAttempt({
      at: "2026-10-06T10:20:30.000Z",
      result: "ok",
      sharpness: Infinity,
      photo: { width: NaN, height: 4000.4, kb: -Infinity },
      paper: {
        cornersSeen: 4,
        widthFraction: 0.123456789,
        minSideCoverage: NaN,
        edgeFitResidualMm: 1.23456789,
      },
    })!;
    expect(r.sharpness).toBeNull();
    expect(r.photo).toEqual({ width: null, height: 4000, kb: null });
    expect(r.paper?.widthFraction).toBe(0.1235);
    expect(r.paper?.edgeFitResidualMm).toBe(1.235);
    expect(r.paper?.minSideCoverage).toBe(0);
  });

  it("rejects a time that is not a time, so a record cannot be made of nothing", () => {
    expect(sanitizeAttempt({ at: "tomorrow-ish", result: "ok" })).toBeNull();
    expect(sanitizeAttempt({ at: 123, result: "ok" })).toBeNull();
  });
});

describe("mergeAttempts", () => {
  const at = (s: number) =>
    record({ at: new Date(Date.UTC(2026, 9, 6, 10, 0, s)).toISOString() });

  it("is the two lists in time order, without a record twice", () => {
    const a = at(1);
    const b = at(2);
    const c = at(3);
    expect(mergeAttempts([a, c], [b, c]).map((r) => r.at)).toEqual([
      a.at,
      b.at,
      c.at,
    ]);
  });

  it("keeps the newest 20", () => {
    const stored = Array.from({ length: 15 }, (_, i) => at(i));
    const session = Array.from({ length: 15 }, (_, i) => at(100 + i));
    const merged = mergeAttempts(stored, session);
    expect(merged).toHaveLength(20);
    expect(merged[19].at).toBe(session[14].at);
    expect(merged[0].at).toBe(stored[10].at);
  });

  it("keeps two records that differ only a little, and records with the same time in the order given", () => {
    const first = record({ at: "2026-10-06T10:00:00.000Z", method: "upload" });
    const second = record({ at: "2026-10-06T10:00:00.000Z", method: "canvas" });
    expect(mergeAttempts([first], [second])).toEqual([first, second]);
  });

  it("does not change the lists it was given", () => {
    const stored = [at(2)];
    const session = [at(1)];
    mergeAttempts(stored, session);
    expect(stored).toHaveLength(1);
    expect(session).toHaveLength(1);
  });
});

describe("settleTimedOut — the shutter opened because the camera did not answer in time", () => {
  const withCapture = (settleTimedOut: boolean | null | undefined) =>
    buildAttemptRecord({
      at: "2026-10-06T10:20:30.000Z",
      userAgent: "x",
      capture: { ...CAPTURE, settleTimedOut },
      outcome: { kind: "result", result: ERROR_RESULT },
    });

  it("is recorded as it was, and null when the capture says nothing (an upload)", () => {
    expect(withCapture(true).settleTimedOut).toBe(true);
    expect(withCapture(false).settleTimedOut).toBe(false);
    expect(withCapture(null).settleTimedOut).toBeNull();
    expect(withCapture(undefined).settleTimedOut).toBeNull();
    expect(record().settleTimedOut).toBeNull();
  });

  it("a stored value that is not a boolean is not trusted", () => {
    const r = sanitizeAttempt({
      at: "2026-10-06T10:20:30.000Z",
      result: "ok",
      settleTimedOut: "yes",
    })!;
    expect(r.settleTimedOut).toBeNull();
  });

  it("the line for the panel says so, only when it happened", () => {
    expect(describeAttempt(withCapture(true))).toContain("settle timed out");
    expect(describeAttempt(withCapture(false))).not.toContain("settle");
  });
});

describe("a frame of the video (captureSource frame)", () => {
  const FRAME_CAPTURE: AttemptCapture = {
    method: "canvas",
    captureSource: "frame",
    photoWidth: 580,
    photoHeight: 1088,
    photoKb: 210,
    previewWidth: 1088,
    previewHeight: 1088,
    frame: {
      stream: { width: 1088, height: 1088 },
      visibleInStream: { x: 253.67, y: 0, width: 580.66, height: 1088 },
    },
  };
  const frameRecord = (diagnostics: PipelineDiagnostics | undefined) =>
    buildAttemptRecord({
      at: "2026-10-06T10:20:30.000Z",
      userAgent: "x",
      capture: FRAME_CAPTURE,
      outcome: {
        kind: "result",
        result: { ...ERROR_RESULT, diagnostics },
      },
    });

  it("is recorded as a canvas frame from the frame source, with the stream, the part on screen and the picture's own size", () => {
    const r = frameRecord({ ...DIAGNOSTICS, view: null, fovCrop: null });
    expect(r.method).toBe("canvas");
    expect(r.captureSource).toBe("frame");
    expect(r.photo).toEqual({ width: 580, height: 1088, kb: 210 });
    expect(r.view).toEqual({
      stream: { width: 1088, height: 1088 },
      visibleInStream: { x: 253.7, y: 0, width: 580.7, height: 1088 },
      model: "frame",
      modelApplies: true,
      aspectDiff: 0,
    });
    expect(r.analysed.crop).toBeNull();
  });

  it("does not compare the frame with a photo: the stream is recorded, the mismatch flag is not", () => {
    const r = frameRecord({ ...DIAGNOSTICS, view: null, fovCrop: null });
    expect(r.preview).toEqual({
      width: 1088,
      height: 1088,
      aspectDiff: null,
      fovMismatch: null,
    });
    expect(describeAttempt(r)).not.toContain("FOV mismatch");
  });

  it("the line for the panel calls it a frame", () => {
    const r = frameRecord(undefined);
    expect(describeAttempt(r)).toContain("· frame ·");
    expect(describeAttempt(r)).toContain("580×1088");
  });

  it("the camera's photo and an upload keep their own source; an unknown value is not trusted", () => {
    const takePhoto = buildAttemptRecord({
      at: "2026-10-06T10:20:30.000Z",
      userAgent: "x",
      capture: { ...CAPTURE, captureSource: "takePhoto" },
      outcome: { kind: "result", result: ERROR_RESULT },
    });
    expect(takePhoto.captureSource).toBe("takePhoto");
    // The photo-versus-preview comparison still runs for the camera's photo.
    expect(takePhoto.preview.fovMismatch).toBe(true);
    expect(record().captureSource).toBeNull();
    expect(
      sanitizeAttempt({
        at: "2026-10-06T10:20:30.000Z",
        result: "ok",
        captureSource: "satellite",
      })!.captureSource,
    ).toBeNull();
    expect(
      sanitizeAttempt({
        at: "2026-10-06T10:20:30.000Z",
        result: "ok",
        captureSource: "upload",
      })!.captureSource,
    ).toBe("upload");
  });

  it("a view that the pipeline reported (the camera's photo, cropped) is not replaced by the frame's", () => {
    const r = buildAttemptRecord({
      at: "2026-10-06T10:20:30.000Z",
      userAgent: "x",
      capture: { ...FRAME_CAPTURE, captureSource: "takePhoto" },
      outcome: { kind: "result", result: ERROR_RESULT },
    });
    expect(r.view?.model).toBe("stream-in-still");
  });
});

describe("what the person saw (view) in a record", () => {
  it("carries the stream, the part of it on screen and how it was carried over to the photo", () => {
    expect(record().view).toEqual({
      stream: { width: 1080, height: 1920 },
      visibleInStream: { x: 96.4, y: 0, width: 887.2, height: 1920 },
      model: "stream-in-still",
      modelApplies: true,
      aspectDiff: 0.3333,
    });
  });

  it("is null for an upload (no viewfinder) and for a run with no diagnostics", () => {
    const bare = buildAttemptRecord({
      at: "2026-10-06T10:20:30.000Z",
      userAgent: "x",
      capture: CAPTURE,
      outcome: {
        kind: "result",
        result: {
          ...ERROR_RESULT,
          diagnostics: { ...DIAGNOSTICS, view: null },
        },
      },
    });
    expect(bare.view).toBeNull();
  });

  it("is rebuilt from numbers and a short model name: wrong types and long strings do not survive", () => {
    const r = sanitizeAttempt({
      at: "2026-10-06T10:20:30.000Z",
      result: "ok",
      view: {
        stream: { width: "1080", height: 1920.4 },
        visibleInStream: { x: 1.234, y: NaN, width: 5, height: 6 },
        model: "m".repeat(500),
        modelApplies: "yes",
        aspectDiff: Infinity,
        extra: "data:image/png;base64,AAAA",
      },
    })!;
    expect(r.view!.stream).toEqual({ width: null, height: 1920 });
    expect(r.view!.visibleInStream).toEqual({
      x: 1.2,
      y: 0,
      width: 5,
      height: 6,
    });
    expect(r.view!.model).toHaveLength(32);
    expect(r.view!.modelApplies).toBeNull();
    expect(r.view!.aspectDiff).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/data:|base64/i);
  });

  it("the line for the panel says when the model did not hold", () => {
    const wider = record({
      view: { ...record().view!, model: "stream-wider", modelApplies: false },
    });
    expect(describeAttempt(wider)).toContain("view model n/a");
    expect(describeAttempt(record())).not.toContain("view model n/a");
  });
});

describe("describeAttempt", () => {
  it("is one line: the time, how, the size, what happened, the sheet's share and the residual", () => {
    expect(describeAttempt(record())).toBe(
      "10:20:30Z · takePhoto · 3000×4000 · PAPER_CURLED+LOW_LANDMARK_CONFIDENCE · paper 81%×77% · resid 1.623 mm · FOV mismatch · cropped",
    );
  });

  it("an ok attempt says ok, and an upload with no sheet found leaves the paper out", () => {
    const ok = record({ result: "ok", errors: [], paper: null });
    expect(describeAttempt(ok)).toContain("· ok");
    expect(describeAttempt(ok)).not.toContain("paper");
  });
});

describe("measured and focal — what a few scans in a row are compared on", () => {
  const OK_DIAGNOSTICS: PipelineDiagnostics = {
    ...DIAGNOSTICS,
    parallaxCorrected: true,
    // Unrounded, as the result carries them.
    measured: { handLengthMm: 188.4372, palmWidthMm: 66.0551 },
    focal: { source: "exif", px: 2871.6489 },
  };
  const okResult = (diagnostics?: PipelineDiagnostics): PipelineResult => ({
    status: "ok",
    measurements: {} as never,
    submission: {} as never,
    warnings: [],
    overlay: ERROR_RESULT.overlay,
    diagnostics,
  });
  const build = (
    outcome: Parameters<typeof buildAttemptRecord>[0]["outcome"],
  ) =>
    buildAttemptRecord({
      at: "2026-10-08T10:20:30.000Z",
      userAgent: "x",
      capture: CAPTURE,
      outcome,
    });
  const NOTHING = { handLengthMm: null, palmWidthMm: null };

  it("an ok result carries the length and width to 0.1 mm and the focal source and value", () => {
    const r = build({ kind: "result", result: okResult(OK_DIAGNOSTICS) });
    expect(r.result).toBe("ok");
    expect(r.measured).toEqual({ handLengthMm: 188.4, palmWidthMm: 66.1 });
    expect(r.focal).toEqual({ source: "exif", px: 2871.6 });
    expect(r.parallaxCorrected).toBe(true);
  });

  it("no correction is a focal source of none with no value", () => {
    const r = build({
      kind: "result",
      result: okResult({
        ...OK_DIAGNOSTICS,
        parallaxCorrected: false,
        focal: { source: "none", px: null },
      }),
    });
    expect(r.focal).toEqual({ source: "none", px: null });
    expect(r.parallaxCorrected).toBe(false);
  });

  it("an error result has no measurement, even if its diagnostics held numbers", () => {
    const r = build({
      kind: "result",
      result: { ...ERROR_RESULT, diagnostics: OK_DIAGNOSTICS },
    });
    expect(r.result).toBe("error");
    expect(r.measured).toEqual(NOTHING);
  });

  it("an error result that stopped early has the focal null as well", () => {
    const r = build({ kind: "result", result: ERROR_RESULT });
    expect(r.measured).toEqual(NOTHING);
    expect(r.focal).toEqual({ source: null, px: null });
  });

  it("a thrown pipeline and a result with no diagnostics have neither", () => {
    const thrown = build({ kind: "thrown", code: "X", message: "x" });
    expect(thrown.measured).toEqual(NOTHING);
    expect(thrown.focal).toEqual({ source: null, px: null });
    const bare = build({ kind: "result", result: okResult(undefined) });
    expect(bare.measured).toEqual(NOTHING);
    expect(bare.focal).toEqual({ source: null, px: null });
  });

  it("an old stored record without the fields still parses, with both null", () => {
    const old = JSON.parse(JSON.stringify(record())) as Record<string, unknown>;
    delete old.measured;
    delete old.focal;
    const parsed = parseAttempts(JSON.stringify([old]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].v).toBe(1);
    expect(parsed[0].measured).toEqual(NOTHING);
    expect(parsed[0].focal).toEqual({ source: null, px: null });
  });

  it("round-trips through storage", () => {
    const r = build({ kind: "result", result: okResult(OK_DIAGNOSTICS) });
    expect(parseAttempts(serialiseAttempts([r]))).toEqual([r]);
  });

  it("is rebuilt from finite numbers and three known names: NaN, Infinity, strings and data URLs become null", () => {
    const dataUrl = `data:image/jpeg;base64,${"A".repeat(10_000)}`;
    const r = sanitizeAttempt({
      at: "2026-10-08T10:20:30.000Z",
      result: "ok",
      measured: { handLengthMm: NaN, palmWidthMm: Infinity, extra: dataUrl },
      focal: { source: dataUrl, px: "2871" },
    })!;
    expect(r.measured).toEqual(NOTHING);
    expect(r.focal).toEqual({ source: null, px: null });
    expect(JSON.stringify(r)).not.toMatch(/data:|base64/i);

    const strings = sanitizeAttempt({
      at: "2026-10-08T10:20:30.000Z",
      result: "ok",
      measured: { handLengthMm: "188.4", palmWidthMm: -Infinity },
      focal: { source: "gps", px: dataUrl },
    })!;
    expect(strings.measured).toEqual(NOTHING);
    expect(strings.focal).toEqual({ source: null, px: null });
    expect(JSON.stringify(strings)).not.toMatch(/data:|base64/i);

    const notObjects = sanitizeAttempt({
      at: "2026-10-08T10:20:30.000Z",
      result: "ok",
      measured: [188.4, 66.1],
      focal: "exif",
    })!;
    expect(notObjects.measured).toEqual(NOTHING);
    expect(notObjects.focal).toEqual({ source: null, px: null });
  });

  it("rounds to 0.1 mm and keeps all three focal sources", () => {
    for (const source of ["exif", "homography", "none"] as const) {
      const r = sanitizeAttempt({
        at: "2026-10-08T10:20:30.000Z",
        result: "ok",
        measured: { handLengthMm: 150.04, palmWidthMm: 70.06 },
        focal: { source, px: 1234.56 },
      })!;
      expect(r.measured).toEqual({ handLengthMm: 150, palmWidthMm: 70.1 });
      expect(r.focal).toEqual({ source, px: 1234.6 });
    }
  });

  it("the line for the panel shows length and width when present, one or both", () => {
    const both = record({
      result: "ok",
      errors: [],
      measured: { handLengthMm: 188.4, palmWidthMm: 66.1 },
    });
    expect(describeAttempt(both)).toContain("len 188.4 mm · palm 66.1 mm");
    const lengthOnly = record({
      result: "ok",
      errors: [],
      measured: { handLengthMm: 190, palmWidthMm: null },
    });
    expect(describeAttempt(lengthOnly)).toContain("len 190.0 mm");
    expect(describeAttempt(lengthOnly)).not.toContain("palm");
    // Nothing measured, nothing said.
    expect(describeAttempt(record())).not.toMatch(/len |palm /);
  });

  it("the debug JSON carries the new fields in each attempt record", () => {
    const r = build({ kind: "result", result: okResult(OK_DIAGNOSTICS) });
    const json = JSON.parse(serialiseAttempts([r])) as Record<
      string,
      unknown
    >[];
    expect(json[0].measured).toEqual({
      handLengthMm: 188.4,
      palmWidthMm: 66.1,
    });
    expect(json[0].focal).toEqual({ source: "exif", px: 2871.6 });
  });
});
