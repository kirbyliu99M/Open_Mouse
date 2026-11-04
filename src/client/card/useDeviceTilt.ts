"use client";

/**
 * v3.4 card reference (candidate 未拍板): the phone's tilt for card mode,
 * from DeviceMotion (gravity), as the scan lab read it (`LabClient.tsx`).
 * The product had no motion sensor reading before v3.4.
 *
 * - Android / most browsers: listening starts as soon as card mode is on.
 * - iOS Safari: `DeviceMotionEvent.requestPermission` must be called from a
 *   tap. `request()` is that call; the page calls it from the reference
 *   chip's tap (choosing 卡片) and from the 「開啟水平感測」 button.
 * - No samples within `NO_SAMPLE_MS` of listening (desktop, a refused or
 *   missing sensor): `unavailable`. Card mode then never fires the auto
 *   shutter and a manual shot is turned back with the "use paper" line
 *   (conservative: the card cannot be measured without the tilt).
 *
 * Only angles are read; nothing is sent anywhere.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  SensorBuffer,
  motionSampleOf,
  requestSensorPermission,
  tiltFromGravity,
  type SensorSnapshot,
} from "./tilt";

export type DeviceTiltState =
  "off" | "needs-permission" | "listening" | "live" | "denied" | "unavailable";

/** Wait this long for a first sample before calling the sensor unavailable, ms. */
export const NO_SAMPLE_MS = 1500;
/** A latest sample older than this is no live tilt, ms. */
export const LIVE_TILT_MAX_AGE_MS = 1000;

interface MotionCtor {
  requestPermission?: () => Promise<string>;
}

function motionCtor(): MotionCtor | null {
  if (typeof window === "undefined" || typeof DeviceMotionEvent === "undefined")
    return null;
  return DeviceMotionEvent as unknown as MotionCtor;
}

/** The screen's rotation, degrees (0 upright). */
export function screenAngleDeg(): number {
  if (typeof window === "undefined") return 0;
  const a = window.screen?.orientation?.angle;
  if (typeof a === "number" && Number.isFinite(a)) return a;
  const legacy = (window as unknown as { orientation?: unknown }).orientation;
  return typeof legacy === "number" && Number.isFinite(legacy) ? legacy : 0;
}

export interface DeviceTilt {
  readonly state: DeviceTiltState;
  /** The latest tilt, degrees, or `null` (no recent sample). */
  liveTiltDeg(): number | null;
  /** The window around `shutterT` (performance.now ms), or `null`. */
  snapshot(shutterT: number): SensorSnapshot | null;
  /** Ask for the sensor (iOS needs a tap) and start listening. */
  request(): Promise<void>;
}

export function useDeviceTilt(active: boolean): DeviceTilt {
  const bufferRef = useRef(new SensorBuffer());
  const listeningRef = useRef(false);
  const [state, setState] = useState<DeviceTiltState>("off");
  const stateRef = useRef<DeviceTiltState>("off");
  const timerRef = useRef<number | null>(null);

  const set = useCallback((s: DeviceTiltState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const onMotion = useCallback(
    (event: DeviceMotionEvent) => {
      const sample = motionSampleOf(
        event.accelerationIncludingGravity,
        performance.now(),
      );
      if (!sample) return;
      bufferRef.current.pushMotion(sample);
      if (stateRef.current !== "live") set("live");
    },
    [set],
  );

  const listen = useCallback(() => {
    if (listeningRef.current) return;
    window.addEventListener("devicemotion", onMotion);
    listeningRef.current = true;
    set("listening");
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (stateRef.current === "listening") set("unavailable");
    }, NO_SAMPLE_MS);
  }, [onMotion, set]);

  const stop = useCallback(() => {
    if (listeningRef.current)
      window.removeEventListener("devicemotion", onMotion);
    listeningRef.current = false;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, [onMotion]);

  // Card mode on: listen where no permission is needed; off: stop.
  useEffect(() => {
    if (!active) {
      stop();
      // Off from the start (the paper path): nothing to change, no render.
      if (stateRef.current === "off") return;
      // Deferred: no state change inside the effect body.
      const id = window.setTimeout(() => set("off"), 0);
      return () => window.clearTimeout(id);
    }
    const ctor = motionCtor();
    const id = window.setTimeout(() => {
      if (listeningRef.current) return;
      if (!ctor) set("unavailable");
      else if (typeof ctor.requestPermission === "function")
        set("needs-permission");
      else listen();
    }, 0);
    return () => window.clearTimeout(id);
  }, [active, listen, stop, set]);

  useEffect(() => stop, [stop]);

  const request = useCallback(async () => {
    const ctor = motionCtor();
    if (!ctor) {
      set("unavailable");
      return;
    }
    const answer = await requestSensorPermission(ctor);
    if (answer === "granted" || answer === "not-required") listen();
    else set("denied");
  }, [listen, set]);

  const liveTiltDeg = useCallback((): number | null => {
    const m = bufferRef.current.latestMotion();
    if (!m || performance.now() - m.t > LIVE_TILT_MAX_AGE_MS) return null;
    return tiltFromGravity([m.x, m.y, m.z], screenAngleDeg())?.tiltDeg ?? null;
  }, []);

  const snapshot = useCallback(
    (shutterT: number) =>
      bufferRef.current.snapshot(shutterT, screenAngleDeg()),
    [],
  );

  return { state, liveTiltDeg, snapshot, request };
}
