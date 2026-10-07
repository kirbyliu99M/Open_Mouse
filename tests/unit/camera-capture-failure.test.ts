import { describe, expect, it } from "vitest";
import {
  CAPTURE_FAILURE_HINT_COPY,
  CAPTURE_FAILURE_HINT_LANGUAGE,
  CAPTURE_FAILURE_HINT_THRESHOLD,
  advanceCaptureFailures,
  captureFailureHintText,
  shouldShowCaptureFailureHint,
  type CaptureFailureEvent,
} from "@/client/camera/captureFailure";

/** Runs the events from a count of zero and returns the count after each. */
function run(events: readonly CaptureFailureEvent[]): number[] {
  const counts: number[] = [];
  let count = 0;
  for (const event of events) {
    count = advanceCaptureFailures(count, event);
    counts.push(count);
  }
  return counts;
}

describe("capture failure counting", () => {
  it("shows the hint after 3 failures in a row, not before", () => {
    expect(CAPTURE_FAILURE_HINT_THRESHOLD).toBe(3);
    expect(shouldShowCaptureFailureHint(0)).toBe(false);
    expect(shouldShowCaptureFailureHint(1)).toBe(false);
    expect(shouldShowCaptureFailureHint(2)).toBe(false);
    expect(shouldShowCaptureFailureHint(3)).toBe(true);
  });

  it("counts up on each failure", () => {
    expect(run(["failure", "failure", "failure"])).toEqual([1, 2, 3]);
  });

  it("stops counting at the threshold, so a long run stays shown", () => {
    const counts = run(Array(10).fill("failure"));
    expect(counts.at(-1)).toBe(CAPTURE_FAILURE_HINT_THRESHOLD);
    expect(shouldShowCaptureFailureHint(counts.at(-1)!)).toBe(true);
  });

  it("goes back to zero on a success, so failures must be consecutive", () => {
    expect(
      run(["failure", "failure", "success", "failure", "failure"]),
    ).toEqual([1, 2, 0, 1, 2]);
    const counts = run(["failure", "failure", "success", "failure", "failure"]);
    expect(shouldShowCaptureFailureHint(counts.at(-1)!)).toBe(false);
  });

  it("hides the hint again as soon as a capture succeeds", () => {
    const shown = run(["failure", "failure", "failure"]).at(-1)!;
    expect(shouldShowCaptureFailureHint(shown)).toBe(true);
    const after = advanceCaptureFailures(shown, "success");
    expect(after).toBe(0);
    expect(shouldShowCaptureFailureHint(after)).toBe(false);
  });

  it("goes back to zero when the person leaves or cancels the shutter flow", () => {
    const shown = run(["failure", "failure", "failure"]).at(-1)!;
    const after = advanceCaptureFailures(shown, "reset");
    expect(after).toBe(0);
    expect(shouldShowCaptureFailureHint(after)).toBe(false);
    // ...and it takes three new failures to show again.
    expect(run(["failure", "failure"]).at(-1)).toBe(2);
  });

  it("does not trust a bad count", () => {
    expect(advanceCaptureFailures(-5, "failure")).toBe(1);
    expect(advanceCaptureFailures(1.9, "failure")).toBe(2);
  });
});

describe("capture failure copy", () => {
  it("is Kirby's approved wording in both languages", () => {
    expect(CAPTURE_FAILURE_HINT_COPY.en).toBe(
      "Couldn't read the camera. Retrying…",
    );
    expect(CAPTURE_FAILURE_HINT_COPY["zh-TW"]).toBe(
      "相機畫面讀取失敗，正在重試…",
    );
  });

  it("is not a network message", () => {
    for (const text of Object.values(CAPTURE_FAILURE_HINT_COPY)) {
      expect(text.toLowerCase()).not.toMatch(/connect|network|upload/);
      expect(text).not.toMatch(/連線|網路|上傳/);
    }
  });

  it("shows the screen's language by default, and either one on request", () => {
    expect(captureFailureHintText()).toBe(
      CAPTURE_FAILURE_HINT_COPY[CAPTURE_FAILURE_HINT_LANGUAGE],
    );
    expect(captureFailureHintText("zh-TW")).toBe(
      CAPTURE_FAILURE_HINT_COPY["zh-TW"],
    );
    expect(captureFailureHintText("en")).toBe(CAPTURE_FAILURE_HINT_COPY.en);
  });
});
