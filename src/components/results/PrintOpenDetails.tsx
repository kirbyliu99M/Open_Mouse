"use client";

import { useEffect } from "react";

/**
 * Prints the contents of the closed disclosures (Details, Other mice).
 *
 * Where the browser supports `::details-content` (Chromium 131 and later,
 * Safari 18.4), results.css makes a closed disclosure's content visible in
 * print and this does nothing. Elsewhere, the disclosures that are closed are
 * opened on `beforeprint` and closed again on `afterprint`. Opening Details
 * there mounts the 3D viewer, which is the price of a printout in such a
 * browser.
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
      for (const details of opened) details.open = true;
    };
    const restore = () => {
      for (const details of opened) details.open = false;
      opened = [];
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
