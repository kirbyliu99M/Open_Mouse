"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { track } from "@/client/analytics/track";
import type { AnalyticsEventProps } from "@/lib/contracts/analytics";

type Cta = AnalyticsEventProps<"home_cta_clicked">["cta"];

/** A home-page link that reports which call to action was clicked. The page
 * itself stays a server component. */
export function HomeCtaLink({
  cta,
  onClick,
  ...rest
}: { cta: Cta } & ComponentProps<typeof Link>) {
  return (
    <Link
      {...rest}
      onClick={(e) => {
        track("home_cta_clicked", { cta });
        onClick?.(e);
      }}
    />
  );
}
