import Link from "next/link";
import "./top-bar.css";
import { backLinkName } from "./labels";

export type TopBarProps = {
  backHref: string;
  backLabel: string;
  stepLabel: string;
};

/** Shared journey wayfinding: a named return destination and current step. */
export function TopBar({ backHref, backLabel, stepLabel }: TopBarProps) {
  return (
    <nav className="journey-top-bar" aria-label="Journey navigation">
      <Link href={backHref} aria-label={backLinkName(backLabel)}>
        <span aria-hidden="true">‹</span> {backLabel}
      </Link>
      <span className="journey-top-bar-step">{stepLabel}</span>
    </nav>
  );
}
