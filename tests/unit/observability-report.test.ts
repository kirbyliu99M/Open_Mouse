import { beforeEach, describe, expect, it, vi } from "vitest";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureException }));

const { isCameraPermissionDenial, reportCaught } =
  await import("@/lib/observability/report");

describe("isCameraPermissionDenial", () => {
  it("is true for a user who blocked the camera", () => {
    expect(
      isCameraPermissionDenial(new DOMException("no", "NotAllowedError")),
    ).toBe(true);
    expect(
      isCameraPermissionDenial(new DOMException("no", "PermissionDeniedError")),
    ).toBe(true);
  });
  it("is false for a camera fault", () => {
    for (const name of [
      "NotReadableError",
      "NotFoundError",
      "OverconstrainedError",
      "AbortError",
    ]) {
      expect(isCameraPermissionDenial(new DOMException("x", name))).toBe(false);
    }
  });
  it("is false for anything that is not a DOMException", () => {
    const lookalike = Object.assign(new Error("x"), {
      name: "NotAllowedError",
    });
    expect(isCameraPermissionDenial(lookalike)).toBe(false);
    expect(isCameraPermissionDenial("NotAllowedError")).toBe(false);
    expect(isCameraPermissionDenial(undefined)).toBe(false);
  });
});

describe("reportCaught", () => {
  beforeEach(() => captureException.mockClear());
  it("captures the error tagged with where it was caught", () => {
    const err = new Error("detector failed to load");
    reportCaught(err, "easy-scan.process");
    expect(captureException).toHaveBeenCalledWith(err, {
      tags: { where: "easy-scan.process" },
    });
  });
});
