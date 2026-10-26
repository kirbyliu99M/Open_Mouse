"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { track } from "@/client/analytics/track";
import { preloadDetectorAssets } from "@/client/photo/preloadDetector";
import type { AnalyticsEventProps } from "@/lib/contracts/analytics";

type Cta = AnalyticsEventProps<"home_cta_clicked">["cta"];

/** A home-page link that reports which call to action was clicked. The page
 * itself stays a server component. The scan link also starts warming the hand
 * detector's files on a press (DetectorWarmup may not have run yet). */
export function HomeCtaLink({
  cta,
  onClick,
  onPointerDown,
  ...rest
}: { cta: Cta } & ComponentProps<typeof Link>) {
  return (
    <Link
      {...rest}
      onPointerDown={(e) => {
        if (cta === "scan") void preloadDetectorAssets("scan");
        onPointerDown?.(e);
      }}
      onClick={(e) => {
        track("home_cta_clicked", { cta });
        onClick?.(e);
      }}
    />
  );
}
