import { describe, expect, it } from "vitest";
import {
  CAPTURE_FAILURE_HINT_COPY,
  CAPTURE_FAILURE_HINT_THRESHOLD,
  advanceCaptureFailures,
  captureFailureHintText,
  captureFailureLangAttribute,
  hintUnderViewfinder,
  pickCaptureFailureLanguage,
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

describe("the line under the viewfinder", () => {
  const line = "Hold still — taking the photo";

  it("is left as it was before the third failure", () => {
    expect(hintUnderViewfinder(line, 0)).toBe(line);
    expect(hintUnderViewfinder(line, 2)).toBe(line);
    expect(hintUnderViewfinder("", 2)).toBe("");
  });

  it("is empty while the failure hint shows, and comes back after a success", () => {
    expect(hintUnderViewfinder(line, 3)).toBe("");
    expect(
      hintUnderViewfinder(line, advanceCaptureFailures(3, "success")),
    ).toBe(line);
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

  it("is English by default, and either language on request", () => {
    expect(captureFailureHintText()).toBe(CAPTURE_FAILURE_HINT_COPY.en);
    expect(captureFailureHintText("zh-TW")).toBe(
      CAPTURE_FAILURE_HINT_COPY["zh-TW"],
    );
    expect(captureFailureHintText("en")).toBe(CAPTURE_FAILURE_HINT_COPY.en);
  });
});

describe("the hint's lang attribute", () => {
  it("marks the zh-TW line, and leaves English unmarked", () => {
    expect(captureFailureLangAttribute("zh-TW")).toBe("zh-TW");
    expect(captureFailureLangAttribute("en")).toBeUndefined();
  });
});

describe("the hint's language", () => {
  it("is zh-TW when the first preferred language is Chinese", () => {
    expect(pickCaptureFailureLanguage(["zh-TW"])).toBe("zh-TW");
    expect(pickCaptureFailureLanguage(["zh-Hant-TW", "en-US"])).toBe("zh-TW");
    expect(pickCaptureFailureLanguage(["zh-CN"])).toBe("zh-TW");
    expect(pickCaptureFailureLanguage(["zh"])).toBe("zh-TW");
    expect(pickCaptureFailureLanguage(["ZH-tw"])).toBe("zh-TW");
  });

  it("is English for anything else", () => {
    expect(pickCaptureFailureLanguage(["en-US"])).toBe("en");
    expect(pickCaptureFailureLanguage(["en-US", "zh-TW"])).toBe("en");
    expect(pickCaptureFailureLanguage(["ja"])).toBe("en");
    expect(pickCaptureFailureLanguage(["zhx"])).toBe("en");
  });

  it("is English with no language at all", () => {
    expect(pickCaptureFailureLanguage([])).toBe("en");
    expect(pickCaptureFailureLanguage(undefined)).toBe("en");
    expect(pickCaptureFailureLanguage(null, null)).toBe("en");
    expect(pickCaptureFailureLanguage([], "")).toBe("en");
  });

  it("falls back to the single language when the list is missing or empty", () => {
    expect(pickCaptureFailureLanguage(undefined, "zh-TW")).toBe("zh-TW");
    expect(pickCaptureFailureLanguage([], "zh-CN")).toBe("zh-TW");
    expect(pickCaptureFailureLanguage(undefined, "en-GB")).toBe("en");
  });

  it("ignores the single language when the list has an entry", () => {
    expect(pickCaptureFailureLanguage(["en-US"], "zh-TW")).toBe("en");
  });
});
