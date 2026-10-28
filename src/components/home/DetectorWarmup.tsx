"use client";

import { useEffect } from "react";
import { preloadDetectorAssets } from "@/client/photo/preloadDetector";

/**
 * On the landing page: once the page is idle, warm the hand detector's model
 * (7.8 MB, preloadDetector.ts); the scan button warms the rest. Renders
 * nothing.
 */
export function DetectorWarmup() {
  useEffect(() => {
    const start = () => void preloadDetectorAssets("landing");
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(start, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(start, 2000);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
