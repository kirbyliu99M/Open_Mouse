"use client";

/**
 * V3.2 F13 (Kirby 2026-10-22, candidate / 未拍板): while the scan is sent from
 * the last question page, a veil (about 70 % of the page colour) fades in over
 * the whole screen in about 220 ms, with the particle loader (U1) on it, and
 * stays until the results page replaces the page. A failed send fades it out
 * again, and the page's own error and retry are there underneath. Under
 * reduced motion it appears and goes at once. The phases are `submitOverlayPhase.ts`.
 *
 * It is drawn inside the question page (itself inside the modal `<dialog>`,
 * which is in the top layer), so it covers that page and catches every tap
 * while it is up; the send's own lock (`useScanSubmit`) still guards against a
 * second send.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { ParticleLoader } from "@/components/loading/ParticleLoader";
import { usePrefersReducedMotion } from "@/client/camera/useReducedMotion";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { loadingCopy } from "@/lib/copy/loading";
import { LOADING_TIMING, type LoaderInput } from "@/lib/particles/loading";
import {
  SUBMIT_OVERLAY,
  overlayFadeMs,
  overlayPhaseFor,
  type OverlayPhase,
} from "./submitOverlayPhase";
import "./submit-overlay.css";

function nowMs(): number {
  return typeof performance === "undefined" ? 0 : performance.now();
}

function waitingLoader(): LoaderInput {
  return {
    startedAt: nowMs(),
    minMs: LOADING_TIMING.MIN_DISPLAY_FIT_MS,
    steps: null,
    arrival: null,
  };
}

export function SubmitOverlay({ busy }: { busy: boolean }) {
  const locale = useLocale();
  const words = loadingCopy(locale).fit;
  const reducedMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState<OverlayPhase>(busy ? "shown" : "hidden");
  const [seenBusy, setSeenBusy] = useState(busy);
  const [loader, setLoader] = useState<LoaderInput>(waitingLoader);

  // A change of `busy` moves the phase during render (React's "adjust state
  // when a prop changes"), so the veil is there in the same frame as the
  // disabled controls.
  if (busy !== seenBusy) {
    setSeenBusy(busy);
    setPhase(overlayPhaseFor(phase, busy));
    if (busy) setLoader(waitingLoader());
  }

  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = setTimeout(
      () => setPhase("hidden"),
      overlayFadeMs(reducedMotion),
    );
    return () => clearTimeout(timer);
  }, [phase, reducedMotion]);

  if (phase === "hidden") return null;
  return (
    <div
      className="submitOverlay"
      data-phase={phase}
      data-testid="submit-overlay"
      aria-busy={phase === "shown"}
      style={
        {
          "--submit-veil-opacity": `${SUBMIT_OVERLAY.VEIL_OPACITY * 100}%`,
          "--submit-fade-ms": `${SUBMIT_OVERLAY.FADE_MS}ms`,
        } as CSSProperties
      }
    >
      <ParticleLoader
        className="submitOverlay-loader"
        input={loader}
        status={words}
      />
    </div>
  );
}
