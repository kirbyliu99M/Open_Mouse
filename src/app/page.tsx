import Link from "next/link";
import logitechCatalogue from "@/db/seed/logitech.json";
import { NavMenu } from "@/components/nav/NavMenu";
import "./home.css";

/**
 * The real main page (docs/design/easy-scan-shell-2026-09-25/README.md,
 * screen 11): "Scan my hand" opens the easy-scan camera directly — no
 * printed sheet, no setup page. "Browse the mice first" is hidden; there is
 * no catalogue page yet, and a shipped link must never be a dead end.
 *
 * The mouse count is read from the seed data at render time, never
 * hard-coded, so the copy stays correct as the catalogue grows.
 */
export default function HomePage() {
  const mouseCount = logitechCatalogue.length;

  return (
    <main className="home-main">
      <nav className="home-nav" aria-label="Primary">
        <span className="home-wordmark">Open Mouse</span>
        <div className="home-nav-actions">
          <Link className="home-signin-link" href="/account">
            Sign in
          </Link>
          <NavMenu />
        </div>
      </nav>

      <p className="home-eyebrow-pill">
        Early preview · measurements still being validated
      </p>

      <h1>Find the mouse that fits your hand.</h1>
      <p className="home-subhead">
        Lay your hand on any blank sheet of A4 and point your phone at it. We
        measure your hand and rank {mouseCount} Logitech mice for you.
      </p>

      <div className="home-hero">
        {/* eslint-disable-next-line @next/next/no-img-element -- static marketing asset, no next/image config needed for one fixed hero */}
        <img
          src="/images/hand-on-a4-hero.png"
          alt="Illustration of a hand laid flat on a sheet of A4 paper, seen from directly above a phone's camera"
          className="home-hero-img"
        />
        <span className="home-hero-corner tl" aria-hidden="true">
          <CheckIcon />
        </span>
        <span className="home-hero-corner tr" aria-hidden="true">
          <CheckIcon />
        </span>
        <span className="home-hero-corner bl" aria-hidden="true">
          <CheckIcon />
        </span>
        <span className="home-hero-corner br" aria-hidden="true">
          <CheckIcon />
        </span>
        <span className="home-hero-badge" aria-hidden="true">
          <ScanBadgeIcon /> All four corners found
        </span>
      </div>

      <Link className="home-cta" href="/scan/easy">
        <CameraIcon /> Scan my hand
      </Link>
      <p className="home-cta-caption">
        No printing, no sign-up. About a minute.
      </p>

      <section className="home-how" aria-labelledby="home-how-heading">
        <h2 id="home-how-heading">How it works</h2>
        <ul className="home-how-list">
          <li>
            <span className="home-how-icon" aria-hidden="true">
              <SheetIcon />
            </span>
            <div>
              <strong>Any blank A4 sheet</strong>
              <p>Put it on a darker table. That&apos;s your ruler.</p>
            </div>
          </li>
          <li>
            <span className="home-how-icon" aria-hidden="true">
              <HandIcon />
            </span>
            <div>
              <strong>Hand flat, phone above</strong>
              <p>The corners lock on and the photo takes itself.</p>
            </div>
          </li>
          <li>
            <span className="home-how-icon" aria-hidden="true">
              <ListIcon />
            </span>
            <div>
              <strong>Your best matches</strong>
              <p>
                {mouseCount} Logitech mice ranked by how they fit your hand.
              </p>
            </div>
          </li>
        </ul>
      </section>

      <div className="home-privacy-card">
        <p>
          <span aria-hidden="true">
            <ShieldIcon />
          </span>
          Your photo never leaves your phone. Only measurements are sent.
        </p>
        <p>
          <span aria-hidden="true">
            <ClockIcon />
          </span>
          Scans without an account are deleted within 24 hours.
        </p>
      </div>

      <p className="home-footer-signin">
        Have an account?{" "}
        <Link href="/account">Sign in to keep your scans.</Link>
      </p>
      <p className="home-footer-note">
        Not affiliated with Logitech. Sizes from Logitech&apos;s published
        specs.
      </p>
    </main>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" focusable="false">
      <path
        d="M3 8.3l3 3 7-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScanBadgeIcon() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" focusable="false">
      <path
        d="M3 7V4.5A1.5 1.5 0 0 1 4.5 3H7M13 3h2.5A1.5 1.5 0 0 1 17 4.5V7M17 13v2.5a1.5 1.5 0 0 1-1.5 1.5H13M7 17H4.5A1.5 1.5 0 0 1 3 15.5V13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" focusable="false">
      <path
        d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="13"
        r="3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    </svg>
  );
}

function SheetIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" focusable="false">
      <path
        d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M14 3v5h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HandIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" focusable="false">
      <path
        d="M8 12V6a1.5 1.5 0 0 1 3 0v5m0-4a1.5 1.5 0 0 1 3 0v4m0-2.5a1.5 1.5 0 0 1 3 0V13m0-1a1.5 1.5 0 0 1 3 0v5c0 3-2 6-6 6h-1c-3 0-4.5-1.3-6-3.5L5 14c-.6-.9-.2-2.2 1-2.4.7-.1 1.4.2 1.8.9L8 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" focusable="false">
      <path
        d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" focusable="false">
      <path
        d="M10 2.5l6 2.2v4.6c0 4-2.6 6.9-6 8.2-3.4-1.3-6-4.2-6-8.2V4.7l6-2.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M7.3 10l1.9 1.9 3.5-3.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" focusable="false">
      <circle
        cx="10"
        cy="10"
        r="7.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M10 6v4.3l3 1.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
