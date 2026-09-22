import { describe, expect, it, vi } from "vitest";
import {
  onPageHideBeacon,
  SESSION_DELETE_URL,
} from "../../src/app/BeaconOnUnload";

/**
 * Issue #17: "the beacon is anonymous-only". `onPageHideBeacon` is the pure
 * decision the `pagehide` handler makes — extracted so this is testable
 * without a DOM (`vitest.config.ts` runs unit tests in the `node`
 * environment, not `jsdom`). A signed-in caller never reaches the
 * `sendBeacon` call at all, matching `BeaconOnUnload`'s promise that a
 * signed-in user's scans survive closing the tab ("Kept until you delete
 * it").
 */
describe("onPageHideBeacon — anonymous-only", () => {
  it("sends the session-delete beacon for an anonymous caller", () => {
    const sendBeacon = vi.fn();
    onPageHideBeacon(true, sendBeacon);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon).toHaveBeenCalledWith(SESSION_DELETE_URL);
  });

  it("never sends the beacon for a signed-in caller", () => {
    const sendBeacon = vi.fn();
    onPageHideBeacon(false, sendBeacon);
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
