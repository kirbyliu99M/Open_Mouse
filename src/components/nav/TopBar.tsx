"use client";

import Link from "next/link";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { navCopy } from "@/lib/copy/nav";
import "./top-bar.css";
import { backLinkName } from "./labels";

export type TopBarProps = {
  backHref: string;
  backLabel: string;
  stepLabel: string;
  /** Called when the back link is clicked (analytics only; navigation is unchanged). */
  onBackClick?: () => void;
};

/** Shared journey wayfinding: a named return destination and current step. */
export function TopBar({
  backHref,
  backLabel,
  stepLabel,
  onBackClick,
}: TopBarProps) {
  const locale = useLocale();
  return (
    <nav
      className="journey-top-bar"
      aria-label={navCopy(locale).journeyNavLabel}
    >
      <Link
        href={backHref}
        aria-label={backLinkName(backLabel, locale)}
        onClick={onBackClick}
      >
        <span aria-hidden="true">‹</span>
        <span>{backLabel}</span>
      </Link>
      <span className="journey-top-bar-step">{stepLabel}</span>
    </nav>
  );
}
