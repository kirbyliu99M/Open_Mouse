import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScanSubmission } from "@/lib/contracts/measurement";

/**
 * `useScanSubmit` asks for the anonymous copy (hand-sample.ts, candidate) only
 * when its screen's notice is mounted AND the switch is on at the moment of
 * sending. Called as a plain function, as in use-scan-submit-once.test.ts:
 * React's hooks are inert stand-ins, the router and the send are mocked.
 */
const live = vi.hoisted(() => ({ sent: [] as ScanSubmission[] }));

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
  submitAndRemember: (submission: ScanSubmission) => {
    live.sent.push(submission);
    return new Promise(() => {});
  },
}));

vi.mock("@/client/analytics/track", () => ({ track: () => {} }));

import { HAND_SAMPLE_NOTICE_VERSION } from "@/lib/contracts/hand-sample";
import {
  resetSampleConsentMemory,
  setSampleConsent,
} from "@/client/scan/sampleConsent";
import { useScanSubmit } from "@/client/scan/useScanSubmit";

const SUBMISSION = { hand: "right" } as ScanSubmission;

describe("useScanSubmit and the anonymous copy", () => {
  beforeEach(() => {
    live.sent.length = 0;
    resetSampleConsentMemory();
  });

  it("a screen that never showed the notice never asks for a copy", () => {
    const { submit } = useScanSubmit();
    submit(SUBMISSION);
    expect("sampleNotice" in live.sent[0]!).toBe(false);
  });

  it("with the notice on screen and the switch on, it asks for one", () => {
    const { submit, sampleNotice } = useScanSubmit();
    sampleNotice();
    submit(SUBMISSION);
    expect(live.sent[0]!.sampleNotice).toBe(HAND_SAMPLE_NOTICE_VERSION);
  });

  it("with the switch turned off before sending, it does not", () => {
    const { submit, sampleNotice } = useScanSubmit();
    sampleNotice();
    setSampleConsent(false);
    submit(SUBMISSION);
    expect("sampleNotice" in live.sent[0]!).toBe(false);
  });

  it("once the notice has unmounted, it no longer asks (a release twice counts once)", () => {
    const { submit, sampleNotice } = useScanSubmit();
    const first = sampleNotice();
    const second = sampleNotice();
    first();
    first();
    // One notice still mounted: asks.
    submit(SUBMISSION);
    expect(live.sent[0]!.sampleNotice).toBe(HAND_SAMPLE_NOTICE_VERSION);

    const other = useScanSubmit();
    const shown = other.sampleNotice();
    shown();
    other.submit(SUBMISSION);
    expect("sampleNotice" in live.sent[1]!).toBe(false);
    second();
  });
});
