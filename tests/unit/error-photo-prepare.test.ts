/**
 * The error photo's on-device geometry (src/client/error-photo/prepare.ts)
 * and its metadata and requests (src/client/error-photo/send.ts), with
 * synthetic inputs only: no real photo, no canvas.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ERROR_PHOTO_CONSENT_VERSION,
  ERROR_PHOTO_DELETE_PATH,
  ERROR_PHOTO_PATH,
} from "../../src/lib/contracts/error-photo";
import {
  CARD_GROW,
  growQuad,
  planErrorPhotoCrop,
  type ErrorPhotoOverlay,
} from "../../src/client/error-photo/prepare";
import {
  buildErrorPhotoMeta,
  deleteErrorPhoto,
  normaliseDeleteCode,
  parseExpectedCm,
  ERROR_PHOTO_UPLOAD_TIMEOUT_MS,
  afterSend,
  createUploadSession,
  sendErrorPhoto,
} from "../../src/client/error-photo/send";

/** A 21-point hand spread over [x0, x1] x [y0, y1]. */
function hand(x0: number, y0: number, x1: number, y1: number) {
  return Array.from({ length: 21 }, (_, k) => ({
    x: x0 + ((x1 - x0) * (k % 5)) / 4,
    y: y0 + ((y1 - y0) * Math.floor(k / 5)) / 4,
  }));
}

const quad = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe("planErrorPhotoCrop: paper", () => {
  const overlay: ErrorPhotoOverlay = {
    imageWidth: 3000,
    imageHeight: 2000,
    landmarksPx: hand(1000, 600, 1600, 1400),
    paperCorners: quad(800, 400, 2000, 1600),
  };

  it("crops the union of hand and sheet plus 8% each side, in the decoded frame", () => {
    const plan = planErrorPhotoCrop({
      overlay,
      mode: "paper",
      decoded: { width: 3000, height: 2000 },
    })!;
    // Union 800..2000 x 400..1600 (1200 x 1200), margin 96.
    expect(plan).toMatchObject({ sx: 704, sy: 304, sw: 1392, sh: 1392 });
    expect(plan.width).toBe(1392);
    expect(plan.height).toBe(1392);
    expect(plan.blackout).toBeNull();
  });

  it("scales the overlay to a full-resolution decode (the pipeline's was downscaled)", () => {
    const plan = planErrorPhotoCrop({
      overlay,
      mode: "paper",
      decoded: { width: 6000, height: 4000 },
    })!;
    expect(plan).toMatchObject({ sx: 1408, sy: 608, sw: 2784, sh: 2784 });
    // Long side held to the contract's 2048.
    expect(plan.width).toBe(2048);
    expect(plan.height).toBe(2048);
  });

  it("clamps the margin to the image", () => {
    const plan = planErrorPhotoCrop({
      overlay: { ...overlay, paperCorners: quad(0, 0, 3000, 2000) },
      mode: "paper",
      decoded: { width: 3000, height: 2000 },
    })!;
    expect(plan).toMatchObject({ sx: 0, sy: 0, sw: 3000, sh: 2000 });
    expect(plan.width).toBe(2048);
    expect(plan.height).toBe(1365);
  });

  it("refuses a decode turned the other way from the overlay", () => {
    expect(
      planErrorPhotoCrop({
        overlay,
        mode: "paper",
        decoded: { width: 2000, height: 3000 },
      }),
    ).toBeNull();
  });

  it("uses partial or guessed corners when the sheet was not fully found, else the hand alone", () => {
    const partial = planErrorPhotoCrop({
      overlay: {
        ...overlay,
        paperCorners: null,
        paperPartialCorners: [{ x: 500, y: 500 }, null, null, null],
      },
      mode: "paper",
      decoded: { width: 3000, height: 2000 },
    })!;
    expect(partial.sx).toBeLessThan(500);
    const handOnly = planErrorPhotoCrop({
      overlay: { ...overlay, paperCorners: null },
      mode: "paper",
      decoded: { width: 3000, height: 2000 },
    })!;
    expect(handOnly).toMatchObject({ sx: 952, sy: 536, sw: 696, sh: 928 });
  });

  it("refuses an overlay with nothing found, or a crop under 64 px", () => {
    expect(
      planErrorPhotoCrop({
        overlay: { imageWidth: 3000, imageHeight: 2000, landmarksPx: null },
        mode: "paper",
        decoded: { width: 3000, height: 2000 },
      }),
    ).toBeNull();
    expect(
      planErrorPhotoCrop({
        overlay: {
          imageWidth: 3000,
          imageHeight: 2000,
          landmarksPx: hand(100, 100, 130, 130),
        },
        mode: "paper",
        decoded: { width: 3000, height: 2000 },
      }),
    ).toBeNull();
    expect(
      planErrorPhotoCrop({
        overlay: { ...overlay, imageWidth: 0 },
        mode: "paper",
        decoded: { width: 3000, height: 2000 },
      }),
    ).toBeNull();
  });
});

describe("planErrorPhotoCrop: card", () => {
  const card = quad(1700, 900, 2100, 1150);
  const overlay: ErrorPhotoOverlay = {
    imageWidth: 1920,
    imageHeight: 1440,
    landmarksPx: hand(400, 200, 1200, 1300),
    paperCorners: card.map((p) => ({ x: p.x * 0.8, y: p.y * 0.8 })),
  };

  it("is not offered without a card outline", () => {
    for (const paperCorners of [null, undefined, card.slice(0, 3)]) {
      expect(
        planErrorPhotoCrop({
          overlay: { ...overlay, paperCorners },
          mode: "card",
          decoded: { width: 1920, height: 1440 },
        }),
      ).toBeNull();
    }
  });

  it("covers the card, grown from its centre, in output pixels", () => {
    const plan = planErrorPhotoCrop({
      overlay,
      mode: "card",
      decoded: { width: 1920, height: 1440 },
    })!;
    expect(plan.blackout).toHaveLength(4);
    const k = plan.width / plan.sw;
    const grown = growQuad(overlay.paperCorners!, CARD_GROW);
    plan.blackout!.forEach((p, i) => {
      expect(p.x).toBeCloseTo((grown[i]!.x - plan.sx) * k, 6);
      expect(p.y).toBeCloseTo((grown[i]!.y - plan.sy) * k, 6);
    });
    // Every card corner sits inside the black quad (it was grown).
    const xs = plan.blackout!.map((p) => p.x);
    const cardOut = overlay.paperCorners!.map((p) => (p.x - plan.sx) * k);
    expect(Math.min(...xs)).toBeLessThan(Math.min(...cardOut));
    expect(Math.max(...xs)).toBeGreaterThan(Math.max(...cardOut));
    // The crop includes the card and the hand.
    expect(plan.sx).toBeLessThanOrEqual(400);
    expect(plan.sx + plan.sw).toBeGreaterThanOrEqual(1680);
  });

  it("grows a quad away from its centroid", () => {
    expect(growQuad(quad(0, 0, 10, 10), 0.2)).toEqual([
      { x: -1, y: -1 },
      { x: 11, y: -1 },
      { x: 11, y: 11 },
      { x: -1, y: 11 },
    ]);
  });
});

describe("buildErrorPhotoMeta", () => {
  it("rounds measured and expected values to whole mm and passes the contract", () => {
    const meta = buildErrorPhotoMeta({
      trigger: "numbers-wrong",
      reference: "card",
      hand: "left",
      measured: { handLengthMm: 187.64, palmWidthMm: 83.2 },
      expected: { handLengthMm: 192.5 },
      measurementModelVersion: "landmark-raw-v3",
      deviceClass: "phone",
      captureMode: "camera",
      widthPx: 1200,
      heightPx: 900,
    });
    expect(meta).toEqual({
      consent: ERROR_PHOTO_CONSENT_VERSION,
      trigger: "numbers-wrong",
      reference: "card",
      hand: "left",
      measured: { handLengthMm: 188, palmWidthMm: 83 },
      expected: { handLengthMm: 193 },
      measurementModelVersion: "landmark-raw-v3",
      deviceClass: "phone",
      captureMode: "camera",
      widthPx: 1200,
      heightPx: 900,
    });
  });

  it("leaves out an empty expected and refuses what the contract refuses", () => {
    const meta = buildErrorPhotoMeta({
      trigger: "scan-failed",
      reference: "a4",
      failureCode: "PAPER_NOT_FOUND",
      expected: {},
      widthPx: 640,
      heightPx: 480,
    });
    expect(meta).not.toBeNull();
    expect(meta).not.toHaveProperty("expected");
    expect(
      buildErrorPhotoMeta({
        trigger: "scan-failed",
        reference: "a4",
        failureCode: "not a code",
        widthPx: 640,
        heightPx: 480,
      }),
    ).toBeNull();
    expect(
      buildErrorPhotoMeta({
        trigger: "scan-failed",
        reference: "a4",
        widthPx: 4000,
        heightPx: 480,
      }),
    ).toBeNull();
  });
});

describe("parseExpectedCm", () => {
  it("reads cm with up to two decimals as whole-ish mm, empty as null", () => {
    expect(parseExpectedCm("")).toBeNull();
    expect(parseExpectedCm(" 18.5 ")).toBe(185);
    expect(parseExpectedCm("8,4")).toBe(84);
    expect(parseExpectedCm("19")).toBe(190);
  });
  it("refuses what is not a plausible hand size in cm", () => {
    for (const raw of ["4", "41", "abc", "18.5cm", "-3", "185"])
      expect(parseExpectedCm(raw), raw).toBe("invalid");
  });
});

describe("requests", () => {
  const meta = buildErrorPhotoMeta({
    trigger: "scan-failed",
    reference: "a4",
    widthPx: 640,
    heightPx: 480,
  })!;

  it("posts multipart to the contract's path without credentials", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ deleteCode: "ABCDEFGHJKLM" }), {
          status: 201,
        }),
    );
    const out = await sendErrorPhoto(
      new Blob([new Uint8Array(4)], { type: "image/jpeg" }),
      meta,
      "ABCDEFGHJKLM",
      fetchImpl as unknown as typeof fetch,
    );
    expect(out).toEqual({ ok: true, deleteCode: "ABCDEFGHJKLM" });
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toBe(ERROR_PHOTO_PATH);
    expect(init.credentials).toBe("omit");
    const form = init.body as FormData;
    expect(JSON.parse(form.get("meta") as string)).toEqual(meta);
    expect((form.get("photo") as Blob).type).toBe("image/jpeg");
    expect(form.get("code")).toBe("ABCDEFGHJKLM");
  });

  it.each([
    [429, "too-many"],
    [503, "unavailable"],
    [500, "failed"],
  ] as const)("maps %i to %s", async (status, reason) => {
    const out = await sendErrorPhoto(
      new Blob([]),
      meta,
      "ABCDEFGHJKLM",
      (async () => new Response("{}", { status })) as unknown as typeof fetch,
    );
    expect(out).toEqual({ ok: false, reason });
  });

  it("gives up after 30 s on a fetch that never answers, and aborts it (H1)", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const never = vi.fn((_path: string, init: RequestInit) => {
        signal = init.signal ?? undefined;
        return new Promise<Response>(() => {});
      });
      const pending = sendErrorPhoto(
        new Blob([]),
        meta,
        "ABCDEFGHJKLM",
        never as unknown as typeof fetch,
      );
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(ERROR_PHOTO_UPLOAD_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      // The code goes with the timeout: the photo may have been stored.
      expect(await pending).toEqual({
        ok: false,
        reason: "timeout",
        deleteCode: "ABCDEFGHJKLM",
      });
      expect(ERROR_PHOTO_UPLOAD_TIMEOUT_MS).toBe(30_000);
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a session makes its code once and every retry sends it with the same bytes", async () => {
    const sent: { code: unknown; photo: Blob }[] = [];
    let call = 0;
    const fetchImpl = vi.fn(async (_path: string, init: RequestInit) => {
      const form = init.body as FormData;
      sent.push({
        code: form.get("code"),
        photo: form.get("photo") as Blob,
      });
      call++;
      return call === 1
        ? new Response("{}", { status: 500 })
        : new Response(JSON.stringify({ deleteCode: form.get("code") }), {
            status: 200,
          });
    });
    const photo = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    const session = createUploadSession(photo, {
      randomBytes: (n) => Uint8Array.from({ length: n }, (_, k) => k * 5),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(session.code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect(await session.send(meta)).toEqual({ ok: false, reason: "failed" });
    expect(await session.send(meta)).toEqual({
      ok: true,
      deleteCode: session.code,
    });
    expect(sent.map((s) => s.code)).toEqual([session.code, session.code]);
    expect(new Uint8Array(await sent[1]!.photo.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("a timeout keeps the code on screen; a stored photo shows it as sent", () => {
    expect(
      afterSend({ ok: false, reason: "timeout", deleteCode: "ABCDEFGHJKLM" }),
    ).toEqual({ kind: "timeout", code: "ABCDEFGHJKLM" });
    expect(afterSend({ ok: true, deleteCode: "ABCDEFGHJKLM" })).toEqual({
      kind: "sent",
      code: "ABCDEFGHJKLM",
    });
    expect(afterSend({ ok: false, reason: "too-many" })).toEqual({
      kind: "failed",
      reason: "too-many",
    });
    // The sheet draws that code, selectable, with the copy button.
    const sheet = readFileSync(
      "src/components/error-photo/ErrorPhotoSheet.tsx",
      "utf8",
    );
    const branch = sheet.slice(sheet.indexOf('phase.kind === "timeout" && ('));
    expect(branch).toMatch(
      /copy\.failTimeoutBefore[\s\S]*?\{phase\.code\}[\s\S]*?copy\.failTimeoutAfter/,
    );
    expect(branch).toMatch(/className="errorPhotoCode"/);
    expect(branch).toMatch(/copyCode\(phase\.code\)/);
  });

  it("a response that names another code is not taken as success", async () => {
    const out = await sendErrorPhoto(
      new Blob([]),
      meta,
      "ABCDEFGHJKLM",
      (async () =>
        new Response(JSON.stringify({ deleteCode: "MLKJHGFEDCBA" }), {
          status: 201,
        })) as unknown as typeof fetch,
    );
    expect(out).toEqual({ ok: false, reason: "failed" });
  });
  it("normalises a typed code and never sends a malformed one", async () => {
    expect(normaliseDeleteCode(" abcd-efgh jklm ")).toBe("ABCDEFGHJKLM");
    expect(normaliseDeleteCode("ABCDEFGHIJKL")).toBeNull();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    expect(
      await deleteErrorPhoto("abc", fetchImpl as unknown as typeof fetch),
    ).toBe("invalid");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      await deleteErrorPhoto(
        "abcdefghjklm",
        fetchImpl as unknown as typeof fetch,
      ),
    ).toBe("deleted");
    const [path, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(path).toBe(ERROR_PHOTO_DELETE_PATH);
    expect(JSON.parse(init.body as string)).toEqual({ code: "ABCDEFGHJKLM" });
  });
});
