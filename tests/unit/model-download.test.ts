import { describe, expect, it } from "vitest";
import {
  announcedPercent,
  describeDetectorLoad,
  describeDownload,
  downloadWithProgress,
  expectedTotalBytes,
  formatMegabytes,
  progressChanged,
  progressFraction,
  progressPercent,
  type DownloadProgress,
} from "../../src/client/photo/model-download";

const headers = (init: Record<string, string>) => new Headers(init);

describe("expectedTotalBytes", () => {
  it("reads Content-Length of an unencoded body", () => {
    expect(expectedTotalBytes(headers({ "content-length": "7819674" }))).toBe(
      7_819_674,
    );
    expect(
      expectedTotalBytes(
        headers({ "content-length": " 1024 ", "content-encoding": "identity" }),
      ),
    ).toBe(1024);
  });

  it.each([
    ["missing", {}],
    ["zero", { "content-length": "0" }],
    ["not a number", { "content-length": "lots" }],
    ["negative", { "content-length": "-5" }],
    ["fractional", { "content-length": "12.5" }],
    ["too large to trust", { "content-length": "99999999999999999999" }],
  ])("is unknown when Content-Length is %s", (_name, init) => {
    expect(expectedTotalBytes(headers(init))).toBeNull();
  });

  it.each(["gzip", "br", "deflate", "zstd"])(
    "is unknown for a %s body: the stream yields decoded bytes, so Content-Length (the encoded size) would overshoot",
    (encoding) => {
      expect(
        expectedTotalBytes(
          headers({ "content-length": "1000", "content-encoding": encoding }),
        ),
      ).toBeNull();
    },
  );
});

describe("progress numbers", () => {
  const p = (loadedBytes: number, totalBytes: number | null) => ({
    loadedBytes,
    totalBytes,
  });

  it("is a fraction of the total, never above 1 or below 0", () => {
    expect(progressFraction(p(0, 100))).toBe(0);
    expect(progressFraction(p(50, 100))).toBe(0.5);
    expect(progressFraction(p(100, 100))).toBe(1);
    // A server that sends more than it announced must not show 130%.
    expect(progressFraction(p(130, 100))).toBe(1);
    expect(progressFraction(p(-5, 100))).toBe(0);
  });

  it("has no fraction without a usable total", () => {
    expect(progressFraction(p(50, null))).toBeNull();
    expect(progressFraction(p(50, 0))).toBeNull();
    expect(progressPercent(p(50, null))).toBeNull();
    expect(announcedPercent(p(50, null))).toBeNull();
  });

  it("rounds the percent down, so the bar is never ahead of the download", () => {
    expect(progressPercent(p(999, 1000))).toBe(99);
    expect(progressPercent(p(1000, 1000))).toBe(100);
    expect(progressPercent(p(1, 1000))).toBe(0);
  });

  it("announces in steps of 10 and says 100 only when it is done", () => {
    const at = (percent: number) => announcedPercent(p(percent, 100));
    expect([0, 9, 10, 19, 47, 99, 100].map(at)).toEqual([
      0, 0, 10, 10, 40, 90, 100,
    ]);
  });

  it("gives a screen reader at most 11 distinct values over a whole download", () => {
    const seen = new Set<number | null>();
    for (let loaded = 0; loaded <= 7_819_674; loaded += 16_384)
      seen.add(announcedPercent(p(loaded, 7_819_674)));
    seen.add(announcedPercent(p(7_819_674, 7_819_674)));
    expect(seen.size).toBeLessThanOrEqual(11);
  });

  it("formats decimal megabytes with one digit", () => {
    expect(formatMegabytes(0)).toBe("0.0");
    expect(formatMegabytes(3_460_000)).toBe("3.5");
    expect(formatMegabytes(7_819_674)).toBe("7.8");
    expect(formatMegabytes(-1)).toBe("0.0");
  });

  it("describes a determinate and an indeterminate download", () => {
    expect(describeDownload(p(3_910_000, 7_819_674))).toEqual({
      determinate: true,
      percent: 50,
      announced: 50,
      sizeText: "3.9 of 7.8 MB",
    });
    expect(describeDownload(p(3_910_000, null))).toEqual({
      determinate: false,
      percent: null,
      announced: null,
      sizeText: "3.9 MB",
    });
  });
});

describe("progressChanged (a re-render only when the display would change)", () => {
  it("reports the first reading, a new total, and a moved percent", () => {
    expect(progressChanged(null, { loadedBytes: 0, totalBytes: 100 })).toBe(
      true,
    );
    const before = { loadedBytes: 10, totalBytes: 100 };
    expect(progressChanged(before, { loadedBytes: 10, totalBytes: 200 })).toBe(
      true,
    );
    expect(progressChanged(before, { loadedBytes: 11, totalBytes: 100 })).toBe(
      true,
    );
    expect(progressChanged(before, { loadedBytes: 10, totalBytes: 100 })).toBe(
      false,
    );
  });

  it("ignores a chunk that does not move the whole percent", () => {
    const before = { loadedBytes: 100_000, totalBytes: 10_000_000 };
    expect(
      progressChanged(before, { loadedBytes: 116_384, totalBytes: 10_000_000 }),
    ).toBe(false);
  });

  it("with no total, follows the tenth of a megabyte", () => {
    const before = { loadedBytes: 1_000_000, totalBytes: null };
    expect(
      progressChanged(before, { loadedBytes: 1_020_000, totalBytes: null }),
    ).toBe(false);
    expect(
      progressChanged(before, { loadedBytes: 1_100_000, totalBytes: null }),
    ).toBe(true);
  });
});

function streamOf(chunks: Uint8Array[], failAfter?: number) {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (failAfter !== undefined && sent === failAfter) {
        controller.error(new Error("connection reset"));
        return;
      }
      const next = chunks[sent];
      if (next === undefined) controller.close();
      else controller.enqueue(next);
      sent += 1;
    },
  });
}

function responseOf(
  chunks: Uint8Array[],
  init: ResponseInit & { failAfter?: number } = {},
) {
  const { failAfter, ...rest } = init;
  return new Response(streamOf(chunks, failAfter), rest);
}

const bytes = (length: number, fill: number) =>
  new Uint8Array(length).fill(fill);

describe("downloadWithProgress", () => {
  const url = "/mediapipe/models/hand_landmarker.task";

  it("streams the file, counts the bytes and returns them in order", async () => {
    const chunks = [bytes(40, 1), bytes(35, 2), bytes(25, 3)];
    const seen: DownloadProgress[] = [];
    const result = await downloadWithProgress(
      async () => responseOf(chunks, { headers: { "content-length": "100" } }),
      url,
      (progress) => seen.push(progress),
    );
    expect(result).not.toBeNull();
    expect(result!.length).toBe(100);
    expect([...result!.slice(0, 40)].every((v) => v === 1)).toBe(true);
    expect([...result!.slice(40, 75)].every((v) => v === 2)).toBe(true);
    expect([...result!.slice(75)].every((v) => v === 3)).toBe(true);
    // From 0, never backwards, and ends exactly at the total.
    expect(seen[0]).toEqual({ loadedBytes: 0, totalBytes: 100 });
    expect(seen.map((s) => s.loadedBytes)).toEqual(
      [...seen.map((s) => s.loadedBytes)].sort((a, b) => a - b),
    );
    expect(seen.at(-1)).toEqual({ loadedBytes: 100, totalBytes: 100 });
  });

  it("does not turn a fast stream into a re-render per chunk", async () => {
    const total = 1_000_000;
    const chunks = Array.from({ length: 1000 }, () => bytes(1000, 7));
    let reports = 0;
    const result = await downloadWithProgress(
      async () =>
        responseOf(chunks, { headers: { "content-length": String(total) } }),
      url,
      () => {
        reports += 1;
      },
    );
    expect(result!.length).toBe(total);
    // 0..100 percent plus the first reading and the final one.
    expect(reports).toBeLessThanOrEqual(103);
  });

  it("with no Content-Length still returns the bytes, and reports an unknown total", async () => {
    const seen: DownloadProgress[] = [];
    const result = await downloadWithProgress(
      async () => responseOf([bytes(10, 9), bytes(10, 9)]),
      url,
      (progress) => seen.push(progress),
    );
    expect(result!.length).toBe(20);
    expect(seen.every((s) => s.totalBytes === null)).toBe(true);
    expect(seen.at(-1)!.loadedBytes).toBe(20);
  });

  it("with a content-encoded body, does not measure against the encoded length", async () => {
    const seen: DownloadProgress[] = [];
    const result = await downloadWithProgress(
      async () =>
        responseOf([bytes(300, 1)], {
          headers: { "content-length": "100", "content-encoding": "gzip" },
        }),
      url,
      (progress) => seen.push(progress),
    );
    expect(result!.length).toBe(300);
    expect(seen.every((s) => s.totalBytes === null)).toBe(true);
  });

  it("reads a response with no stream whole, in one request", async () => {
    let calls = 0;
    const fake = {
      ok: true,
      headers: new Headers({ "content-length": "6" }),
      body: null,
      arrayBuffer: async () => bytes(6, 4).buffer,
    } as unknown as Response;
    const result = await downloadWithProgress(
      async () => {
        calls += 1;
        return fake;
      },
      url,
      () => {},
    );
    expect(result!.length).toBe(6);
    expect(calls).toBe(1);
  });

  it.each([
    ["a network error", async () => Promise.reject(new TypeError("offline"))],
    ["a non-2xx response", async () => new Response("nope", { status: 404 })],
    ["an empty body", async () => responseOf([])],
    [
      "a stream that fails midway",
      async () => responseOf([bytes(10, 1), bytes(10, 1)], { failAfter: 1 }),
    ],
    [
      "a stream shorter than its Content-Length (a truncated model)",
      async () =>
        responseOf([bytes(10, 1)], { headers: { "content-length": "25" } }),
    ],
  ])(
    "returns null on %s, so the caller falls back to MediaPipe's own load",
    async (_name, fetchImpl) => {
      const result = await downloadWithProgress(
        fetchImpl as unknown as typeof fetch,
        url,
        () => {},
      );
      expect(result).toBeNull();
    },
  );
});

describe("describeDetectorLoad", () => {
  it("shows a determinate pill while the model streams in", () => {
    expect(
      describeDetectorLoad({
        stage: "model",
        loadedBytes: 3_910_000,
        totalBytes: 7_819_674,
      }),
    ).toEqual({
      visible: true,
      text: "Loading the hand detector",
      detail: "3.9 of 7.8 MB",
      percent: 50,
      announced: 50,
    });
  });

  it("shows an indeterminate pill while the runtime starts, and when the model's size is unknown", () => {
    expect(describeDetectorLoad({ stage: "runtime" })).toEqual({
      visible: true,
      text: "Starting the hand detector",
      detail: null,
      percent: null,
      announced: null,
    });
    const unknown = describeDetectorLoad({
      stage: "model",
      loadedBytes: 1_200_000,
      totalBytes: null,
    });
    expect(unknown).toMatchObject({
      visible: true,
      detail: "1.2 MB",
      percent: null,
      announced: null,
    });
  });

  it.each(["idle", "ready", "failed"] as const)(
    "shows nothing when the detector is %s",
    (stage) => {
      expect(describeDetectorLoad({ stage }).visible).toBe(false);
    },
  );
});
