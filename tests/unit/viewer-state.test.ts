import { describe, expect, it } from "vitest";
import {
  initialViewerStatus,
  isFallback,
  viewerReducer,
  type ViewerEvent,
  type ViewerStatus,
} from "../../src/lib/viewer/viewer-state";

const EVENTS: ViewerEvent[] = [
  { type: "near" },
  { type: "loaded" },
  { type: "failed" },
  { type: "unsupported" },
];

const STATUSES: ViewerStatus[] = [
  "idle",
  "loading",
  "ready",
  "failed",
  "unsupported",
];

describe("initialViewerStatus", () => {
  it("starts idle for a mouse with a shell and unsupported for one without", () => {
    expect(initialViewerStatus(true)).toBe("idle");
    expect(initialViewerStatus(false)).toBe("unsupported");
  });
});

describe("viewerReducer", () => {
  it("walks idle -> loading -> ready", () => {
    let status: ViewerStatus = "idle";
    status = viewerReducer(status, { type: "near" });
    expect(status).toBe("loading");
    status = viewerReducer(status, { type: "loaded" });
    expect(status).toBe("ready");
  });

  it("ends loading as failed or unsupported", () => {
    expect(viewerReducer("loading", { type: "failed" })).toBe("failed");
    expect(viewerReducer("loading", { type: "unsupported" })).toBe(
      "unsupported",
    );
  });

  it("does nothing before the region is near: a download never starts from idle by itself", () => {
    for (const type of ["loaded", "failed", "unsupported"] as const) {
      expect(viewerReducer("idle", { type })).toBe("idle");
    }
  });

  it("ignores a second `near` while loading or after", () => {
    for (const status of [
      "loading",
      "ready",
      "failed",
      "unsupported",
    ] as const) {
      expect(viewerReducer(status, { type: "near" })).toBe(status);
    }
  });

  it("lets a ready viewer fail (a lost context), and nothing else change it", () => {
    expect(viewerReducer("ready", { type: "failed" })).toBe("failed");
    expect(viewerReducer("ready", { type: "loaded" })).toBe("ready");
    expect(viewerReducer("ready", { type: "unsupported" })).toBe("ready");
  });

  it("keeps failed and unsupported final", () => {
    for (const status of ["failed", "unsupported"] as const) {
      for (const event of EVENTS) {
        expect(viewerReducer(status, event)).toBe(status);
      }
    }
  });

  it("never goes back to idle once it has left it", () => {
    for (const status of STATUSES.filter((s) => s !== "idle")) {
      for (const event of EVENTS) {
        expect(viewerReducer(status, event)).not.toBe("idle");
      }
    }
  });
});

describe("isFallback", () => {
  it("is true only for failed and unsupported", () => {
    expect(STATUSES.map(isFallback)).toEqual([false, false, false, true, true]);
  });
});
