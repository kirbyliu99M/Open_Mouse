"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/client/camera/useReducedMotion";
import { canvasScale, PALETTE } from "@/lib/particles/budget";
import {
  armGuard,
  breakChain,
  newGuard,
  observeFrame,
} from "@/lib/particles/degrade";
import {
  breathLook,
  cloudPoints,
  litColor,
  loaderParticleCount,
  loaderStep,
  particleLook,
  RING,
  loaderStatusText,
  ringAngle,
  type CloudPoint,
  type LoaderDrawState,
  type LoaderInput,
} from "@/lib/particles/loading";
import "./particle-loader.css";

/** Narrower than this (48rem, the home stage's line) is a phone's budget. */
const WIDE_QUERY = "(min-width: 48rem)";

/** The cloud's radius as a share of the ring's. */
const CLOUD_IN_RING = 0.74;
/** A particle's base radius at a scale of 1 (CSS px). */
const DOT_PX = 1.35;
/** The ring's line and the bright dot at its head (CSS px). */
const RING_LINE_PX = 2;
const HEAD_PX = 3.25;

interface Drawn {
  progress: number;
  failed: boolean;
  bright: boolean;
  breath: number;
  count: number;
}

function draw(
  ctx: CanvasRenderingContext2D,
  points: readonly CloudPoint[],
  sizePx: number,
  dpr: number,
  d: Drawn,
) {
  const s = sizePx * dpr;
  const c = s / 2;
  const ringR = c - (HEAD_PX + 2) * dpr;
  const look = breathLook(d.bright ? 1 : d.breath);
  const cloudR = ringR * CLOUD_IN_RING * look.scale;
  ctx.clearRect(0, 0, s, s);

  // The glow of the cloud: one soft disc, as bright as the breath.
  const halo = ctx.createRadialGradient(c, c, 0, c, c, cloudR * 1.15);
  halo.addColorStop(0, PALETTE.glow);
  halo.addColorStop(1, "transparent");
  ctx.globalAlpha = look.glow * (d.failed ? 0.4 : 1);
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, s, s);

  // The particles, in two batches: the lit ones and the dark ones.
  const lit = new Path2D();
  const dark = new Path2D();
  let litAlpha = 0;
  let darkAlpha = 0;
  for (let i = 0; i < d.count && i < points.length; i += 1) {
    const p = points[i]!;
    const l = particleLook(p.threshold, d.progress);
    const r = DOT_PX * dpr * p.size * l.radius;
    const x = c + p.x * cloudR;
    const y = c + p.y * cloudR;
    const path = l.lit ? lit : dark;
    path.moveTo(x + r, y);
    path.arc(x, y, r, 0, Math.PI * 2);
    if (l.lit) litAlpha = l.alpha;
    else darkAlpha = l.alpha;
  }
  const dim = d.failed ? 0.45 : 1;
  ctx.globalAlpha = darkAlpha * look.brightness * dim;
  ctx.fillStyle = PALETTE.detail;
  ctx.fill(dark);
  ctx.globalAlpha = litAlpha * look.brightness * dim;
  ctx.fillStyle = d.failed ? PALETTE.detail : litColor(d.progress);
  ctx.fill(lit);

  // The ring: its track, the progress from the top clockwise, a bright head.
  ctx.lineWidth = RING_LINE_PX * dpr;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.globalAlpha = RING.TRACK_ALPHA;
  ctx.beginPath();
  ctx.arc(c, c, ringR, 0, Math.PI * 2);
  ctx.stroke();
  const start = -Math.PI / 2;
  const end = start + ringAngle(d.progress);
  if (d.progress > 0.002) {
    ctx.globalAlpha = d.failed ? RING.FAILED_ALPHA : 1;
    ctx.beginPath();
    ctx.arc(c, c, ringR, start, end);
    ctx.stroke();
    if (!d.failed) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(
        c + Math.cos(end) * ringR,
        c + Math.sin(end) * ringR,
        HEAD_PX * dpr,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * The particle loader (V3.2 U1, candidate; design loading-v5-ring): the home
 * page's blue-white particles in a round cloud that breathes, inside a thin
 * progress ring. No text and no number on screen; one `role="status"` says
 * 「正在比對」 (or the photo's words) and then 「完成」, never a percentage.
 *
 * Everything it draws comes from `loaderFrameAt` (src/lib/particles/
 * loading.ts) for the clock's `now`: the caller only says when it started,
 * the minimum time, the steps (a photo) and the answer. The caller also holds
 * back what comes next until `loaderTimeline(...).doneAt`, so the two agree.
 *
 * Canvas 2D, half the home stage's 2D budget (`loaderParticleCount`), and the
 * home stage's slow-frame guard (degrade.ts) draws fewer when frames come
 * slowly. The loop stops while the page is hidden and once the loader has
 * nothing left to move (failed, or gone). Reduced motion: no breathing and no
 * flash; the ring still moves smoothly.
 */
export function ParticleLoader({
  input,
  status,
  className,
}: {
  input: LoaderInput;
  /** What the status region says: while waiting, and once the answer is ok. */
  status: { working: string; done: string };
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const live = useRef({ input, reducedMotion });
  live.current = { input, reducedMotion };
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d") ?? null;
    if (!canvas || !ctx) return;
    const wide = window.matchMedia?.(WIDE_QUERY).matches === true;
    const budget = loaderParticleCount(wide, navigator.hardwareConcurrency);
    const points = cloudPoints(budget);
    // Nothing scrolls here: the frames count from the start.
    let guard = armGuard(newGuard(budget));
    let raf = 0;
    let drawn: LoaderDrawState = { shown: 0, lastAt: 0 };
    let sizePx = 0;
    let dpr = 1;

    const fit = () => {
      const box = canvas.getBoundingClientRect();
      const next = Math.max(1, Math.round(Math.min(box.width, box.height)));
      const scale = canvasScale(window.devicePixelRatio);
      if (next === sizePx && scale === dpr) return;
      sizePx = next;
      dpr = scale;
      canvas.width = Math.round(sizePx * dpr);
      canvas.height = Math.round(sizePx * dpr);
    };

    const frame = (now: number) => {
      raf = 0;
      fit();
      guard = observeFrame(guard, now, budget);
      const { input: at, reducedMotion: still } = live.current;
      const step = loaderStep(drawn, at, now, still);
      drawn = step.state;
      const { frame: f, breath, settled } = step;
      draw(ctx, points, sizePx, dpr, {
        progress: drawn.shown,
        failed: f.phase === "failed",
        bright: f.phase === "filling" || f.phase === "done",
        breath,
        count: guard.drawCount,
      });
      // The whole loader fades (a veil behind it too), by opacity only.
      if (rootRef.current) rootRef.current.style.opacity = String(f.opacity);
      if (!settled && document.visibilityState !== "hidden") {
        raf = requestAnimationFrame(frame);
      }
    };

    const start = () => {
      if (raf === 0) raf = requestAnimationFrame(frame);
    };
    wake.current = start;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (raf !== 0) cancelAnimationFrame(raf);
        raf = 0;
        guard = breakChain(guard);
      } else {
        start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (raf !== 0) cancelAnimationFrame(raf);
      wake.current = () => {};
    };
  }, []);

  // A new answer or step (or a failed loader told to show again): draw.
  useEffect(() => {
    wake.current();
  }, [input, reducedMotion]);

  const said = loaderStatusText(input, status);
  return (
    <div
      ref={rootRef}
      className={`particleLoader${className ? ` ${className}` : ""}`}
      data-phase={
        input.arrival === null ? "waiting" : input.arrival.ok ? "ok" : "failed"
      }
    >
      <canvas
        ref={canvasRef}
        className="particleLoader-canvas"
        aria-hidden="true"
      />
      <p className="particleLoader-status" role="status">
        {said}
      </p>
    </div>
  );
}
