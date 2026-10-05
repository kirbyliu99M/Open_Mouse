"use client";

import { useEffect, useRef } from "react";

/**
 * The home page's particle canvases (Home v3, PR B and the WebGL stage). It
 * renders two empty, decorative <canvas> elements that the story panel holds:
 * the WebGL layer that draws the particles, and on top of it the 2D layer that
 * draws the overlay (and the particles too, if WebGL is not available). After
 * the first paint it loads the stage module with a dynamic import, so the
 * particles never delay the logo or the headline (the LCP). Until the module
 * has loaded and drawn its first frame the canvases are hidden by CSS and the
 * page is PR A's static layout, which is also what reduced motion, no JS and
 * small screens keep. If the module fails to load, nothing changes.
 *
 * One canvas can not give both a 2D and a WebGL context, hence two.
 */
export function ParticleStage() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const glCanvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let cancelled = false;
    let stage: { destroy(): void } | null = null;
    let loading = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    const load = () => {
      if (cancelled || loading || stage || reduced.matches) return;
      loading = true;
      import("./particle-stage")
        .then((module) => {
          loading = false;
          if (!cancelled) {
            stage = module.startParticleStage(element, glCanvas.current);
          }
        })
        .catch(() => {
          // The page stays as it is: the static layout. (Nothing is logged:
          // src/ writes no console output outside src/server/log.ts.)
          loading = false;
        });
    };

    // After the first paint, and when the browser has nothing better to do.
    let stopWaiting = () => {};
    const whenIdle = () => {
      let timer = 0;
      let idle = 0;
      const frame = requestAnimationFrame(() => {
        timer = window.setTimeout(() => {
          if ("requestIdleCallback" in window) {
            idle = window.requestIdleCallback(load, { timeout: 2000 });
          } else {
            load();
          }
        }, 0);
      });
      stopWaiting = () => {
        cancelAnimationFrame(frame);
        window.clearTimeout(timer);
        if (idle) window.cancelIdleCallback(idle);
      };
    };
    if (document.readyState === "complete") {
      whenIdle();
    } else {
      window.addEventListener("load", whenIdle, { once: true });
    }
    // Motion allowed again later (the setting was changed): load then.
    const onMotionChange = () => {
      if (!reduced.matches) whenIdle();
    };
    reduced.addEventListener("change", onMotionChange);

    return () => {
      cancelled = true;
      stopWaiting();
      window.removeEventListener("load", whenIdle);
      reduced.removeEventListener("change", onMotionChange);
      stage?.destroy();
    };
  }, []);

  return (
    <>
      <canvas ref={glCanvas} className="story-canvas-gl" aria-hidden="true" />
      <canvas ref={canvas} className="story-canvas" aria-hidden="true" />
    </>
  );
}
