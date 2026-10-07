import Link from "next/link";
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
  return (
    <nav className="journey-top-bar" aria-label="Journey navigation">
      <Link
        href={backHref}
        aria-label={backLinkName(backLabel)}
        onClick={onBackClick}
      >
        <span aria-hidden="true">‹</span>
        <span>{backLabel}</span>
      </Link>
      <span className="journey-top-bar-step">{stepLabel}</span>
    </nav>
  );
}
