/**
 * F10 item 2 (R6 F1, candidate): a frame the person places on a photo keeps
 * the focal length the automatic run on that same photo found, so the
 * placed frame keeps its parallax correction. The rule is the tested pure
 * `reusableFocal` / `reusedFocalFor` (pipeline-reused-focal.test.ts,
 * manual-frame-parallax.test.ts); this file pins where the camera wires it
 * (review of F10: removing the wiring left every test green). The repo has no
 * DOM test library, so the wiring is read from the camera's source, as
 * paper-adjust-screen.test.ts does for the placed frame itself.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8")
  .split("\r\n")
  .join("\n");
const run = source.slice(
  source.indexOf("const runPipeline = useCallback("),
  source.indexOf("const captureNow = useCallback("),
);
const callStart = run.indexOf("await runPhotoPipelineImpl({");
const call = run.slice(callStart, run.indexOf("});", callStart));

describe("the camera keeps the automatic run's focal length for a frame placed on the same photo (F10 item 2)", () => {
  it("the slices read are the run and its pipeline call", () => {
    expect(run.length).toBeGreaterThan(0);
    expect(callStart).toBeGreaterThan(0);
    expect(call.length).toBeGreaterThan(0);
  });

  it("an automatic run forgets the earlier focal length before it starts, and the reused one is chosen from the placed frame and this photo", () => {
    const forget = run.indexOf(
      "if (!paperInput.pipeline.manualPaperCorners) autoFocalRef.current = null;",
    );
    const choose = run.search(
      /const reusedFocal = reusedFocalFor\(\{\s*placedFrame: Boolean\(paperInput\.pipeline\.manualPaperCorners\),\s*file,\s*auto: autoFocalRef\.current,\s*\}\);/,
    );
    expect(forget).toBeGreaterThan(
      run.indexOf("const paperInput = pipelinePaperInput("),
    );
    expect(choose).toBeGreaterThan(forget);
    // Both come before the pipeline is called.
    expect(choose).toBeLessThan(callStart);
  });

  it("the pipeline call is given the reused focal length", () => {
    expect(call).toContain("...(reusedFocal ? { reusedFocal } : {}),");
  });

  it("only an ok automatic run (no placed frame) records its focal length, through reusableFocal, for that photo", () => {
    const after = run.slice(callStart);
    const ok = after.indexOf('if (pipelineResult.status === "ok") {');
    expect(ok).toBeGreaterThan(0);
    const okBlock = after.slice(ok, after.indexOf('track("scan_measured"', ok));
    expect(okBlock).toMatch(
      /if \(!paperInput\.pipeline\.manualPaperCorners\) \{\s*const focal = reusableFocal\(pipelineResult\.diagnostics\?\.focal\);\s*autoFocalRef\.current = focal \? \{ file, focal \} : null;\s*\}/,
    );
    // Nowhere else is it written: once cleared before the run, once here.
    expect(source.split("autoFocalRef.current =").length - 1).toBe(2);
  });
});
