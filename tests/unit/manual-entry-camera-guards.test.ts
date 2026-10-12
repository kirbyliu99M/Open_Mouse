import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The typed-size form must never meet a photo (candidate, 2026-10-12). The
 * races cannot be staged from the screen (the handle is hidden while a photo
 * is taken or analysed), so the guards are pinned in the source, the way
 * camera-live-loop.test.ts pins the loop's.
 */
const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");

/** The text of a `const name = useCallback(` block, up to the next top-level const. */
function block(start: string): string {
  const from = source.indexOf(start);
  expect(from, `${start} exists`).toBeGreaterThan(-1);
  const next = source.indexOf("\n  const ", from + start.length);
  return source.slice(from, next === -1 ? undefined : next);
}

describe("the camera screen and the typed-size form", () => {
  it("the handle's press is ignored while a photo is being taken or a result is up", () => {
    const open = block("const openManualSheet = useCallback(");
    expect(open).toContain("capturingRef.current");
    expect(open).toContain('resultRef.current.kind !== "none"');
    expect(open).toContain("return;");
  });

  it("a shutter press (or the auto-shutter) does nothing once the form is open", () => {
    expect(block("const captureNow = useCallback(")).toMatch(
      /if \(capturingRef\.current \|\| manualActiveRef\.current\) return;/,
    );
  });

  it("an uploaded photo is ignored once the form is open", () => {
    expect(block("const onFilePicked = useCallback(")).toContain(
      "manualActiveRef.current",
    );
  });

  it("the pipeline neither starts nor takes a late result in once the form is open, and does not reset the answers", () => {
    const run = block("const runPipeline = useCallback(");
    // At the top: before the run id, the analytics and the reset.
    const guard = run.indexOf("manualActiveRef.current");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(run.indexOf("++runIdRef.current"));
    expect(guard).toBeLessThan(
      run.indexOf('dispatchAnswers({ type: "reset" })'),
    );
    // After the await, on both the success and the failure path.
    const afterGuards = run.match(/if \(manualActiveRef\.current\) \{/g) ?? [];
    expect(afterGuards.length).toBeGreaterThanOrEqual(3);
    // A dropped result leaves the processing screen for the plain camera.
    expect(run).toContain("NO_RESULT");
  });

  it("the live loop waits while the form or its pages are open", () => {
    expect(source).toContain(
      'if (camState.kind !== "live" || tipOpen || manualActive) return;',
    );
    expect(source).toContain("manualActiveRef.current = manualActive;");
  });
});
