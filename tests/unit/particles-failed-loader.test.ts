/**
 * Scan S2 (V3.2, 2026-10-21, candidate): when an analysis fails, the
 * particle loader does not just vanish. (The easy scan's photo loader that S2
 * kept on its failure sheet is gone with F10, Kirby 2026-10-21/22: no loader
 * after the shutter. The pure failed-loader rules below stay.) Its ring stops
 * where it was and dims, the cloud stays breathed out, and it stays on the
 * failure sheet above the retry, the way the results page's `failedLoader`
 * stays above its error.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LOADING_TIMING,
  RING,
  failedLoaderInput,
  loaderStep,
  type LoaderDrawState,
  type LoaderInput,
} from "../../src/lib/particles/loading";
import { ParticleLoader } from "../../src/components/loading/ParticleLoader";
import { loadingCopy } from "../../src/lib/copy/loading";

function photo(arrival: LoaderInput["arrival"]): LoaderInput {
  return {
    startedAt: 1000,
    minMs: 0,
    steps: { total: 4, done: 2, lastAt: 1400 },
    arrival,
  };
}

describe("failedLoaderInput (pure)", () => {
  it("is the loader only once its answer was a failure", () => {
    expect(failedLoaderInput(null)).toBeNull();
    expect(failedLoaderInput(photo(null))).toBeNull();
    expect(failedLoaderInput(photo({ at: 1900, ok: true }))).toBeNull();
    const failed = photo({ at: 1900, ok: false });
    expect(failedLoaderInput(failed)).toBe(failed);
  });
});

describe("the failed loader: frozen ring, dimmed, breathed out", () => {
  const failed = photo({ at: 1900, ok: false });

  it("the ring stays where it stopped, at every later frame", () => {
    // Drawn while waiting first, then the failure arrives.
    let state: LoaderDrawState = { shown: 0, lastAt: 0 };
    for (let t = 1000; t <= 1880; t += 16) {
      state = loaderStep(state, photo(null), t, false).state;
    }
    const stoppedAt = loaderStep(state, failed, 1900, false);
    expect(stoppedAt.frame.phase).toBe("failed");
    expect(stoppedAt.settled).toBe(true);
    const ring = stoppedAt.state.shown;
    expect(ring).toBeGreaterThan(0);
    expect(ring).toBeLessThan(LOADING_TIMING.WAIT_CAP);
    let later = stoppedAt.state;
    for (const t of [2000, 2500, 4000, 10_000]) {
      const step = loaderStep(later, failed, t, false);
      expect(step.state.shown).toBe(ring);
      expect(step.frame.opacity).toBe(1);
      later = step.state;
    }
  });

  it("the cloud is breathed out (breath 0) with or without reduced motion", () => {
    for (const t of [1900, 2700, 3300, 5100]) {
      expect(
        loaderStep({ shown: 0.4, lastAt: t - 16 }, failed, t, false).breath,
      ).toBe(0);
      expect(
        loaderStep({ shown: 0.4, lastAt: t - 16 }, failed, t, true).breath,
      ).toBe(0);
    }
  });

  it("the ring is drawn dimmed", () => {
    expect(RING.FAILED_ALPHA).toBeGreaterThan(0);
    expect(RING.FAILED_ALPHA).toBeLessThan(1);
  });

  it("its status region says nothing (the error says it); no text on screen", () => {
    const html = renderToStaticMarkup(
      createElement(ParticleLoader, {
        className: "easyFailedLoader",
        input: failed,
        status: loadingCopy("zh-TW").photo,
      }),
    );
    expect(html).toContain("easyFailedLoader");
    const status = [...html.matchAll(/role="status"[^>]*>([^<]*)</g)].map(
      (m) => m[1],
    );
    expect(status).toEqual([""]);
  });
});

describe("the easy scan no longer draws it (F10, Kirby 2026-10-21/22)", () => {
  // F10: no loader after the shutter, so there is no stopped ring to keep on
  // the failure sheet either; the failure sheet opens straight away.
  const source = readFileSync("src/client/camera/EasyScanCamera.tsx", "utf8");
  const css = readFileSync("src/client/camera/easy-scan.css", "utf8");

  it("has no failed loader on its failure sheet, and no style for one", () => {
    expect(source).not.toContain("failedLoaderInput");
    expect(source).not.toContain('className="easyFailedLoader"');
    expect(css).not.toContain("easyFailedLoader");
    expect(css).not.toContain("easyProcessingLoader");
  });
});
