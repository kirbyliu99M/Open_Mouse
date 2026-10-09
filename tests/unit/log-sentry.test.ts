import { beforeEach, describe, expect, it, vi } from "vitest";

const captureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureMessage }));

const { log } = await import("../../src/server/log");

const SCAN_ID = "0b5c1f7e-3a4d-4e6f-8a9b-1c2d3e4f5a6b";

/**
 * `log.error` also goes to Sentry. What goes is the finished, redacted log
 * line, never the caller's fields.
 */
describe("log.error to Sentry", () => {
  beforeEach(() => {
    captureMessage.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("sends the redacted line as extra, at error level", () => {
    log.error("survey.failed", {
      route: null,
      error: new Error(`scan ${SCAN_ID} for kirby@example.com failed`),
    });
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [event, hint] = captureMessage.mock.calls[0]!;
    expect(event).toBe("survey.failed");
    expect(hint.level).toBe("error");
    const sent = JSON.stringify(hint.extra);
    expect(sent).not.toContain(SCAN_ID);
    expect(sent).not.toContain("kirby@example.com");
    expect(hint.extra).toEqual(
      JSON.parse(vi.mocked(console.error).mock.calls[0]![0] as string),
    );
  });

  it("sends nothing for info and warn", () => {
    log.info("x.ok", { route: null });
    log.warn("x.slow", { route: null });
    expect(captureMessage).not.toHaveBeenCalled();
  });
});
