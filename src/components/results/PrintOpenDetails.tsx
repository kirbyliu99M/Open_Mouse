"use client";

import { useEffect } from "react";
import { PRINT_OPENED_ATTRIBUTE } from "@/lib/results/disclosure";

/**
 * Prints the contents of the closed disclosures (Details, Other mice).
 *
 * Where the browser supports `::details-content` (Chromium 131 and later,
 * Safari 18.4), results.css makes a closed disclosure's content visible in
 * print and this does nothing. Elsewhere, the disclosures that are closed are
 * opened on `beforeprint` and closed again on `afterprint`. Opening Details
 * there is marked with `data-print-opened`, so it is not counted as the
 * person opening it (no analytics event, no 3D viewer download).
 */
export function PrintOpenDetails() {
  useEffect(() => {
    if (
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("selector(::details-content)")
    )
      return;
    let opened: HTMLDetailsElement[] = [];
    const open = () => {
      opened = [
        ...document.querySelectorAll<HTMLDetailsElement>(
          ".results-disclosure:not([open])",
        ),
      ];
      for (const details of opened) {
        details.setAttribute(PRINT_OPENED_ATTRIBUTE, "");
        details.open = true;
      }
    };
    const restore = () => {
      const marked = opened;
      for (const details of marked) details.open = false;
      opened = [];
      // The `toggle` events of those changes are delivered a moment later;
      // the mark has to outlive them.
      setTimeout(() => {
        for (const details of marked)
          details.removeAttribute(PRINT_OPENED_ATTRIBUTE);
      }, 100);
    };
    window.addEventListener("beforeprint", open);
    window.addEventListener("afterprint", restore);
    return () => {
      window.removeEventListener("beforeprint", open);
      window.removeEventListener("afterprint", restore);
    };
  }, []);
  return null;
}
