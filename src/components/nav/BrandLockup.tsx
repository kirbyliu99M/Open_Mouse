import Link from "next/link";
import { SITE_NAME } from "@/lib/site";
import "./brand-lockup.css";

/**
 * The blue starlight glass tile (Pencil "Logo 套用" board, q9pLv) with the
 * "Palmate" wordmark on its right, at the left of the landing page's nav and
 * of the results top bar (Kirby 2026-10-26, candidate / 未拍板; on 2026-10-10
 * the nav had kept the wordmark alone). The tile is decorative: the wordmark
 * names the site. With `href` it
 * is a link (home, from the results); without, plain text (on home itself).
 */
export function BrandLockup({
  href,
  className,
}: {
  href?: string;
  className?: string;
}) {
  const inner = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- our own fixed SVG mark, no next/image config needed */}
      <img
        className="brandLockup-mark"
        src="/images/brand/palmate-glass-36.svg"
        alt=""
        width={36}
        height={36}
      />
      <span className="brandLockup-name">{SITE_NAME}</span>
    </>
  );
  const classes = `brandLockup${className ? ` ${className}` : ""}`;
  return href ? (
    <Link href={href} className={classes}>
      {inner}
    </Link>
  ) : (
    <span className={classes}>{inner}</span>
  );
}
