/**
 * V3.3 WP3 (candidate 未拍板): how EasyScanCamera wires the soft hints, read
 * from the source (the repo has no DOM test library). With the hints off
 * (`placementHintsOn` false: every visit without ?debug=1) the cue on screen
 * IS the paper's cue, no hysteresis is fed, no banner is worked out or drawn,
 * and the ring and the F14 wait never read a hand hint.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8")
  .split("\r\n")
  .join("\n");
const tick = source.slice(
  source.indexOf("function tick(now: number)"),
  source.indexOf(
    "rafRef.current = requestAnimationFrame(tick);\n    return () =>",
  ),
);
const run = source.slice(
  source.indexOf("const runPipeline = useCallback("),
  source.indexOf("const captureNow = useCallback("),
);

describe("live hints (WP3a)", () => {
  it("the ring and the F14 wait read the paper's cue, built without the hand; with the hints on, a hand hint on screen holds the ring (Kirby 2026-10-27)", () => {
    expect(tick).toContain(
      'const nextCue = pickCue(cueInput, "paper-edge", localeRef.current);',
    );
    // Hints off: `handHint` is null, so the ring is what it was before WP3.
    expect(tick).toMatch(
      /const handHint = placementHintsOn\(hintsDebugRef\.current\)\s*\?\s*\(placementCueInput\(placementHysteresisRef\.current, \{[\s\S]*?\}\)\?\.hint \?\? null\)\s*:\s*null;/,
    );
    expect(tick).toMatch(
      /const paperPassing =\s*nextCue\.allPass && previewSettledRef\.current && handHint === null;/,
    );
    expect(tick).toContain("const sheetFound = sheetFoundByCue(nextCue.code);");
    // The cue input itself has no hand in it.
    const input = tick.slice(
      tick.indexOf("const cueInput: CueInput = {"),
      tick.indexOf("const nextCue = pickCue("),
    );
    expect(input).not.toMatch(/placement/);
  });

  it("hints off: the cue on screen is the paper's cue", () => {
    expect(tick).toMatch(
      /const shownCandidate = placementHintsOn\(hintsDebugRef\.current\)\s*\?\s*pickCue\(\s*\{\s*\.\.\.cueInput,\s*placement: placementCueInput\(placementHysteresisRef\.current, \{\s*nowMs: now,\s*detectorReady: isHandLandmarkerReady\(\),\s*\}\),\s*\},[\s\S]*?\)\s*:\s*nextCue;/,
    );
    expect(tick).toMatch(
      /advanceCueDebounce\(\s*cueDebounceRef\.current,\s*shownCandidate\.code,\s*now,\s*\)/,
    );
  });

  it("the hysteresis is fed once per hand reading, only with the hints on", () => {
    expect(tick).toMatch(
      /if \(placementHintsOn\(hintsDebugRef\.current\)\)\s*placementHysteresisRef\.current = advancePlacementHysteresis\(/,
    );
    expect(tick.match(/advancePlacementHysteresis\(/g)).toHaveLength(1);
    const reset = source.slice(
      source.indexOf("const resetLoopState = useCallback("),
      source.indexOf("}, [noteCaptureOutcome]);"),
    );
    expect(reset).toContain(
      "placementHysteresisRef.current = INITIAL_PLACEMENT_HYSTERESIS_STATE;",
    );
    expect(reset).toContain("sizeStatusRef.current = null;");
  });

  it("the softer cue style only for a hand hint", () => {
    expect(source).toContain(
      'isPlacementCueCode(cue.code) ? " cameraCueSoftHint" : ""',
    );
  });
});

describe("post-shot banner (WP3b)", () => {
  it("is worked out only with the hints on, for a measured photo with a placement", () => {
    expect(run).toMatch(
      /if \(\s*placementHintsOn\(hintsDebugRef\.current\) &&\s*pipelineResult\.status === "ok" &&\s*pipelineResult\.diagnostics\?\.placement\s*\)/,
    );
    expect(source.match(/pickSoftHintBanner\(/g)).toHaveLength(1);
    // Off, nothing reaches the record or the result.
    expect(run).toContain(
      "banner ? { at: bannerAt, result: banner } : undefined,",
    );
    expect(run).toMatch(/\.\.\.\(banner\s*\?\s*\{\s*softHint: \{/);
  });

  it("is drawn only from that result, inside the measured sheet, and never replaces its buttons", () => {
    expect(source.split("<SoftHintBanner").length - 1).toBe(1);
    expect(source).toMatch(
      /sheetResult\?\.kind === "measured" &&\s*!sheetLeave\.leaving &&\s*sheetResult\.softHint\?\.code &&/,
    );
    const at = source.indexOf("<SoftHintBanner");
    const measuredBranch = source.lastIndexOf(
      'sheetResult.kind === "measured" ? (',
      at,
    );
    expect(measuredBranch).toBeGreaterThan(0);
    // Retake and Continue are still there after it.
    const after = source.slice(at);
    expect(after.indexOf('className="easyRetakeButton"')).toBeGreaterThan(0);
    expect(
      after.indexOf('data-testid="answers-continue-button"'),
    ).toBeGreaterThan(0);
  });

  it("closing, retaking and continuing are noted in the local log only", () => {
    expect(source).toContain(
      "noteSoftHintOutcome(shown.at, { dismissed: true });",
    );
    expect(source).toMatch(
      /if \(result\.kind === "measured" && result\.softHint\)\s*noteSoftHintOutcome\(result\.softHint\.at, \{ after: "retake" \}\);/,
    );
    expect(source).toMatch(
      /if \(sheetResult\.softHint\)\s*noteSoftHintOutcome\(sheetResult\.softHint\.at, \{\s*after: "continue",\s*\}\);\s*dispatchAnswers\(\{ type: "open" \}\);/,
    );
    const calls = source.match(/track\("[a-z_]+"[^;]*;/g) ?? [];
    for (const call of calls) expect(call).not.toMatch(/softHint|banner/i);
  });
});
