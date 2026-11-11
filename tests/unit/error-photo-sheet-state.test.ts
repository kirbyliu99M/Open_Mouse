/**
 * The consent sheet's states (src/client/error-photo/sheetState.ts), driven
 * the way the sheet drives them: a real `sendErrorPhoto` against a fake
 * fetch, its outcome into the reducer, and what the sheet would show
 * (`sheetView`). Review #241 round 4 (L1): once a request was attempted the
 * code stays on screen and Esc / back stay blocked, whatever happens next.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ERROR_PHOTO_CONSENT_VERSION,
  type ErrorPhotoMeta,
} from "../../src/lib/contracts/error-photo";
import {
  ERROR_PHOTO_UPLOAD_TIMEOUT_MS,
  createUploadSession,
  type SendOutcome,
} from "../../src/client/error-photo/send";
import {
  initialSheetState,
  runSheetSend,
  sheetReducer,
  sheetView,
  type SheetState,
} from "../../src/client/error-photo/sheetState";

const meta: ErrorPhotoMeta = {
  consent: ERROR_PHOTO_CONSENT_VERSION,
  trigger: "scan-failed" as const,
  reference: "a4" as const,
  widthPx: 640,
  heightPx: 480,
};

const photo = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

/** A session whose fetch answers with each of `answers` in turn. */
function session(answers: (() => Promise<Response>)[]) {
  let call = 0;
  const fetchImpl = vi.fn(() => answers[call++]!());
  const s = createUploadSession(photo, {
    randomBytes: (n) => Uint8Array.from({ length: n }, (_, k) => k * 3),
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { s, fetchImpl };
}

/** One press of 傳送, as the sheet does it. */
async function press(
  state: SheetState,
  send: () => Promise<SendOutcome>,
): Promise<SheetState> {
  const sending = sheetReducer(state, { type: "send" });
  // While the request is out the code is already shown and Esc is blocked.
  expect(sheetView(sending).code).toBe(state.code);
  expect(sheetView(sending).escClosable).toBe(false);
  return sheetReducer(sending, { type: "outcome", outcome: await send() });
}

const answer =
  (status: number, body: unknown = {}) =>
  () =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("the consent sheet keeps the code once a request was attempted", () => {
  it("(a) timeout, then a retry answered 429: code visible, Esc blocked", async () => {
    vi.useFakeTimers();
    try {
      const { s } = session([
        () => new Promise<Response>(() => {}),
        answer(429),
      ]);
      let state = initialSheetState(s.code);
      const first = press(state, () => s.send(meta));
      await vi.advanceTimersByTimeAsync(ERROR_PHOTO_UPLOAD_TIMEOUT_MS);
      state = await first;
      expect(sheetView(state)).toMatchObject({
        code: s.code,
        escClosable: false,
        message: "timeout",
      });
      state = await press(state, () => s.send(meta));
      expect(sheetView(state)).toEqual({
        code: s.code,
        escClosable: false,
        busy: false,
        sent: false,
        message: "uncertain",
        extra: "too-many",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("(b) first try fails with a network TypeError: code visible", async () => {
    const { s } = session([
      () => Promise.reject(new TypeError("Failed to fetch")),
    ]);
    const state = await press(initialSheetState(s.code), () => s.send(meta));
    expect(sheetView(state)).toMatchObject({
      code: s.code,
      escClosable: false,
      message: "uncertain",
      extra: null,
    });
  });

  it("(c) first try answered 500: code visible", async () => {
    const { s } = session([answer(500)]);
    const state = await press(initialSheetState(s.code), () => s.send(meta));
    expect(sheetView(state)).toMatchObject({
      code: s.code,
      escClosable: false,
      message: "uncertain",
    });
  });

  it("(d) a 2xx naming another code: not sent, code visible", async () => {
    const { s } = session([answer(201, { deleteCode: "MLKJHGFEDCBA" })]);
    const state = await press(initialSheetState(s.code), () => s.send(meta));
    expect(sheetView(state)).toMatchObject({
      code: s.code,
      sent: false,
      escClosable: false,
      message: "uncertain",
    });
  });

  it("(e) the device check fails before any request: send and fetch never called, no code, Esc closes", async () => {
    const { s, fetchImpl } = session([]);
    let state = initialSheetState(s.code);
    const events: string[] = [];
    const send = vi.fn((meta: ErrorPhotoMeta) => s.send(meta));
    await runSheetSend({
      build: () => null,
      dispatch: (event) => {
        events.push(event.type);
        state = sheetReducer(state, event);
      },
      send,
    });
    expect(events).toEqual(["local-failure"]);
    expect(send).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sheetView(state)).toMatchObject({
      code: null,
      escClosable: true,
      message: "local",
    });
  });

  it("runSheetSend shows the code before the request starts, then the outcome", async () => {
    const { s, fetchImpl } = session([answer(500)]);
    let state = initialSheetState(s.code);
    const order: string[] = [];
    let seenWhileSending: ReturnType<typeof sheetView> | null = null;
    await runSheetSend({
      build: () => {
        order.push("build");
        return meta;
      },
      dispatch: (event) => {
        order.push(`dispatch:${event.type}`);
        state = sheetReducer(state, event);
      },
      send: (built) => {
        order.push("send");
        seenWhileSending = sheetView(state);
        return s.send(built);
      },
    });
    expect(order).toEqual([
      "build",
      "dispatch:send",
      "send",
      "dispatch:outcome",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(seenWhileSending).toMatchObject({
      code: s.code,
      escClosable: false,
      busy: true,
    });
    expect(sheetView(state)).toMatchObject({
      code: s.code,
      message: "uncertain",
    });
    expect(state.failures).toBe(1);
  });

  it("ok:true naming another code is not sent; the code shown stays the session's", () => {
    const sending = sheetReducer(initialSheetState("ABCDEFGHJKLM"), {
      type: "send",
    });
    const state = sheetReducer(sending, {
      type: "outcome",
      outcome: { ok: true, deleteCode: "MLKJHGFEDCBA" },
    });
    expect(state.phase).toBe("failed");
    expect(sheetView(state)).toMatchObject({
      sent: false,
      code: "ABCDEFGHJKLM",
      escClosable: false,
      message: "uncertain",
    });
  });

  it("each failure gets a new alert key", () => {
    let state = sheetReducer(initialSheetState("ABCDEFGHJKLM"), {
      type: "send",
    });
    state = sheetReducer(state, {
      type: "outcome",
      outcome: { ok: false, reason: "failed" },
    });
    const first = state.failures;
    state = sheetReducer(state, { type: "send" });
    state = sheetReducer(state, {
      type: "outcome",
      outcome: { ok: false, reason: "too-many" },
    });
    expect(state.failures).toBe(first + 1);
  });
  it("a later local failure after an attempt still shows the code", async () => {
    const { s } = session([answer(503)]);
    let state = await press(initialSheetState(s.code), () => s.send(meta));
    expect(sheetView(state).extra).toBe("unavailable");
    state = sheetReducer(state, { type: "local-failure" });
    expect(sheetView(state)).toMatchObject({
      code: s.code,
      escClosable: false,
      message: "uncertain",
    });
  });

  it("a stored photo (201, or 200 for a retry) is sent, with its code", async () => {
    // The fake randomness is fixed, so the session's code is known up front.
    const code = session([]).s.code;
    const { s } = session([answer(500), answer(200, { deleteCode: code })]);
    expect(s.code).toBe(code);
    const failed = await press(initialSheetState(s.code), () => s.send(meta));
    const ok = await press(failed, () => s.send(meta));
    expect(sheetView(ok)).toMatchObject({
      sent: true,
      code: s.code,
      escClosable: false,
      message: null,
    });
  });

  it("before anything is sent the sheet has no code and Esc closes it", () => {
    expect(sheetView(initialSheetState("ABCDEFGHJKLM"))).toEqual({
      code: null,
      escClosable: true,
      busy: false,
      sent: false,
      message: null,
      extra: null,
    });
  });
});
