import type { Metadata } from "next";
import Link from "next/link";
import logitechCatalogue from "@/db/seed/logitech.json";
import { howItWorksCopy } from "@/lib/copy/how-it-works";
import { privacyCopy } from "@/lib/copy/privacy";
import { getLocale } from "@/server/i18n/getLocale";
import "../home.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: howItWorksCopy(await getLocale()).title };
}

/** The original introduction, moved to its own route (screen 18). */
export default async function HowItWorksPage() {
  const locale = await getLocale();
  const copy = howItWorksCopy(locale);
  const mouseCount = logitechCatalogue.length;

  return (
    <main className="home-main home-how-page">
      <Link className="home-back-link" href="/">
        {copy.back}
      </Link>
      <h1>{copy.title}</h1>
      <p className="home-subhead">{copy.subhead}</p>

      <div className="home-hero">
        {/* eslint-disable-next-line @next/next/no-img-element -- static marketing asset, no next/image config needed for one fixed hero */}
        <img
          src="/images/hand-on-a4-camera.png"
          alt={copy.heroAlt}
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
          <ScanBadgeIcon /> {copy.cornersFound}
        </span>
      </div>

      <section className="home-how" aria-labelledby="home-how-heading">
        <h2 id="home-how-heading">{copy.stepsHeading}</h2>
        <ul className="home-how-list">
          <li>
            <span className="home-how-icon" aria-hidden="true">
              1
            </span>
            <div>
              <strong>{copy.step1Title}</strong>
              <p>{copy.step1Body}</p>
            </div>
          </li>
          <li>
            <span className="home-how-icon" aria-hidden="true">
              2
            </span>
            <div>
              <strong>{copy.step2Title}</strong>
              <p>{copy.step2Body}</p>
            </div>
          </li>
          <li>
            <span className="home-how-icon" aria-hidden="true">
              3
            </span>
            <div>
              <strong>{copy.step3Title}</strong>
              <p>{copy.step3Body(mouseCount)}</p>
            </div>
          </li>
        </ul>
      </section>

      <Link className="home-cta" href="/scan/easy">
        <CameraIcon /> {copy.scanMyHand}
      </Link>
      <p className="home-cta-caption">{copy.ctaCaption}</p>

      <div className="home-privacy-card" id="privacy">
        <p>
          <span aria-hidden="true">
            <ShieldIcon />
          </span>
          {privacyCopy(locale).photoStaysOnPhone}
        </p>
        <p>
          <span aria-hidden="true">
            <ClockIcon />
          </span>
          {copy.expiry}
        </p>
        {/* Wording confirmed by Kirby on 2026-10-07: discloses the anonymous
            PostHog counts (issue #138). */}
        <p>
          <span aria-hidden="true">
            <ShieldIcon />
          </span>
          {copy.analytics}
        </p>
      </div>

      <p className="home-privacy-link">
        {copy.questions} <Link href="#privacy">{copy.privacyLink}</Link>
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
