"use client";

import { useEffect } from "react";
import { sweepLegacyHandKeys } from "./handDisclosure";

/** Renders nothing; on mount, clears the hand keys older builds left in
 * this browser's storage (see handDisclosure.ts). */
export function LegacyHandKeySweep() {
  useEffect(() => {
    try {
      sweepLegacyHandKeys(localStorage);
    } catch {
      // Storage may be disabled; there is nothing to clean then.
    }
  }, []);
  return null;
}
