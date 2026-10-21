import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanSubmission } from "@/lib/contracts/measurement";

/**
 * V3.2 F11-8: the results page's top-bar "‹ 重新掃描" only goes back in
 * history (instead of pushing /scan) when the scan page called
 * `noteScanHandoff(scanId)` BEFORE `router.push` opened the results. This
 * covers that wiring in `useScanSubmit`'s success branch: at the moment of the
 * push, the real module memory must already hold the scan id.
 *
 * The hook is called as a plain function (no DOM in unit tests): React's
 * hooks are replaced by inert stand-ins, the router and the send are mocked.
 */

// Filled in after the imports; `vi.mock` factories are hoisted above them.
const live = vi.hoisted(() => ({
  pushes: [] as { path: string; handoffAtPush: string | null }[],
  take: null as null | (() => { scanHandoff: string | null }),
}));
const pushes = live.pushes;
let outcome:
  | { status: "success"; scanId: string }
  | { status: "error"; kind: "network"; message: string } = {
  status: "success",
  scanId: "s7",
};

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
  useRouter: () => ({
    // Reads the real module memory synchronously, exactly when the push
    // happens: a handoff noted after the push would read null here.
    push: (path: string) => {
      live.pushes.push({ path, handoffAtPush: live.take!().scanHandoff });
    },
  }),
}));

vi.mock("@/client/scan/submitAndRemember", () => ({
  submitAndRemember: async () => outcome,
}));

vi.mock("@/client/analytics/track", () => ({ track: () => {} }));

import { useScanSubmit } from "@/client/scan/useScanSubmit";
import { resultsPagePath } from "@/lib/contracts/routes";
import { takeArrivalMemory } from "@/lib/results/resultsHistory";

live.take = takeArrivalMemory;

/** Lets the send's promise chain and the push settle. */
async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe("F11-8: useScanSubmit hands the scan id to the results page", () => {
  beforeEach(() => {
    pushes.length = 0;
    takeArrivalMemory();
  });

  it("notes the handoff before it pushes the results page", async () => {
    outcome = { status: "success", scanId: "s7" };
    const { submit } = useScanSubmit();
    submit({} as ScanSubmission);
    await settle();
    expect(pushes).toEqual([
      { path: resultsPagePath("s7"), handoffAtPush: "s7" },
    ]);
  });

  it("notes nothing and pushes nothing when the send fails", async () => {
    outcome = { status: "error", kind: "network", message: "x" };
    const { submit } = useScanSubmit();
    submit({} as ScanSubmission);
    await settle();
    expect(pushes).toEqual([]);
    expect(takeArrivalMemory().scanHandoff).toBeNull();
  });
});
