import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanSubmission } from "@/lib/contracts/measurement";

/**
 * V3.2 F13: on the palm-thickness page the button no longer turns into
 * 「傳送中…」 and a veil comes over the page instead, so the only thing that
 * stops a second send is `useScanSubmit`'s own lock. Two presses in the same
 * task send once; a failure releases it so 再試一次 works; the page's local
 * notes reach `submitAndRemember` unchanged.
 *
 * The hook is called as a plain function (no DOM in unit tests): React's
 * hooks are replaced by inert stand-ins, the router and the send are mocked.
 */
const live = vi.hoisted(() => ({
  sends: [] as { notes: unknown }[],
  resolvers: [] as ((o: unknown) => void)[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => [initial, () => {}],
    useRef: (initial: unknown) => ({ current: initial }),
    useCallback: (fn: unknown) => fn,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

vi.mock("@/client/scan/submitAndRemember", () => ({
  submitAndRemember: (
    _submission: unknown,
    _storage: unknown,
    _fetch: unknown,
    notes: unknown,
  ) => {
    live.sends.push({ notes });
    return new Promise((resolve) => live.resolvers.push(resolve));
  },
}));

vi.mock("@/client/analytics/track", () => ({ track: () => {} }));

import { readFileSync } from "node:fs";
import { submitBusy, useScanSubmit } from "@/client/scan/useScanSubmit";

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe("useScanSubmit sends once (V3.2 F13: the lock, not the button text)", () => {
  beforeEach(() => {
    live.sends.length = 0;
    live.resolvers.length = 0;
  });

  it("two presses before any answer send one request", async () => {
    const { submit } = useScanSubmit();
    submit({} as ScanSubmission);
    submit({} as ScanSubmission);
    expect(live.sends).toHaveLength(1);
    live.resolvers[0]!({ status: "success", scanId: "s1" });
    await settle();
    // Still locked after a success: the results page is opening.
    submit({} as ScanSubmission);
    expect(live.sends).toHaveLength(1);
  });

  it("a failure releases the lock: the retry sends again, once", async () => {
    const { submit } = useScanSubmit();
    submit({} as ScanSubmission);
    live.resolvers[0]!({ status: "error", kind: "network", message: "x" });
    await settle();
    submit({} as ScanSubmission);
    submit({} as ScanSubmission);
    expect(live.sends).toHaveLength(2);
  });

  it("passes the page's local notes through (the curled-paper note, F13)", () => {
    const { submit } = useScanSubmit();
    submit({} as ScanSubmission, { paperCurled: true });
    expect(live.sends[0]?.notes).toEqual({ paperCurled: true });
  });
});

describe("busy holds through a 201 (the veil covers until the results page, F13)", () => {
  it("sending and sent are busy; idle and a failure are not", () => {
    expect(submitBusy({ kind: "submitting" })).toBe(true);
    expect(submitBusy({ kind: "success" })).toBe(true);
    expect(submitBusy({ kind: "idle" })).toBe(false);
    expect(submitBusy({ kind: "error", errorKind: "network" })).toBe(false);
  });

  it("the hook's busy is submitBusy(state)", () => {
    const hook = readFileSync("src/client/scan/useScanSubmit.ts", "utf8");
    expect(hook).toContain("const busy = submitBusy(state);");
    expect(hook).toContain("return { state, submit, busy, clearError };");
  });
});
