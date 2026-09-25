import Link from "next/link";
import logitechCatalogue from "@/db/seed/logitech.json";
import { NavMenu } from "@/components/nav/NavMenu";
import { formatCatalogueSpec } from "./format-catalogue-spec";
import "./home.css";

export default function HomePage() {
  const featuredMouse = logitechCatalogue.find(
    (mouse) => mouse.model === "G Pro X Superlight 2",
  );
  if (!featuredMouse || featuredMouse.weightG === null)
    throw new Error(
      "Featured mouse specifications are missing from the catalogue",
    );
  const specs = [
    ["Length", formatCatalogueSpec(featuredMouse.lengthMm, "mm")],
    ["Width", formatCatalogueSpec(featuredMouse.widthMm, "mm")],
    ["Height", formatCatalogueSpec(featuredMouse.heightMm, "mm")],
    ["Weight", formatCatalogueSpec(featuredMouse.weightG, "g")],
  ] as const;

  return (
    <main className="home-main landing-page">
      <nav className="home-nav" aria-label="Primary">
        <span className="home-wordmark">Open Mouse</span>
        <div className="home-nav-actions">
          <Link className="home-signin-link" href="/account">
            Sign in
          </Link>
          <NavMenu />
        </div>
      </nav>

      <p className="landing-eyebrow">EARLY PREVIEW · HAND-FIT RANKING</p>
      <h1>Shape matters more than specs.</h1>
      <p className="home-subhead">
        The right mouse starts with the size of your hand.
      </p>

      <figure className="landing-sketch">
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG sketch */}
        <img
          src="/images/g-pro-sketch.svg"
          alt="Line sketch of the G Pro X Superlight 2 mouse"
        />
        <figcaption>G Pro X Superlight 2 · sketch</figcaption>
      </figure>

      <dl
        className="landing-specs"
        aria-label="G Pro X Superlight 2 specifications"
      >
        {specs.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <Link className="home-cta" href="/scan/easy">
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
          focusable="false"
        >
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
        Scan my hand
      </Link>
      <Link className="landing-how-link" href="/how-it-works">
        How it works <span aria-hidden="true">→</span>
      </Link>

      <section className="landing-points" aria-label="Why scan your hand">
        <div>
          <span>01</span>
          <div>
            <h2>One photo. No printing.</h2>
            <p>A blank sheet of A4 is the ruler.</p>
          </div>
        </div>
        <div>
          <span>02</span>
          <div>
            <h2>Ranked for your hand, not the hype.</h2>
            <p>
              {logitechCatalogue.length} Logitech mice scored on length, grip
              width and weight.
            </p>
          </div>
        </div>
        <div>
          <span>03</span>
          <div>
            <h2>Your photo never leaves your phone.</h2>
            <p>Only the measurements are sent.</p>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <p>Early preview — measurements are still being validated.</p>
        <p>
          Not affiliated with Logitech. Sizes from Logitech&apos;s published
          specs.
        </p>
      </footer>
    </main>
  );
}
