import Link from "next/link";
import logitechCatalogue from "@/db/seed/logitech.json";
import { NavMenu } from "@/components/nav/NavMenu";
import { PHOTO_PRIVACY_COPY } from "@/components/privacy-copy";
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
  const dimension = [
    featuredMouse.lengthMm,
    featuredMouse.widthMm,
    featuredMouse.heightMm,
  ]
    .map((value) => formatCatalogueSpec(value, "mm").replace(/ mm$/, ""))
    .join(" × ");

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

      <h1>Measure your hand. Find the mouse that fits.</h1>
      <p className="home-subhead">
        A blank sheet of A4 and your phone are all it takes.
      </p>

      <figure className="landing-sketch">
        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG sketch */}
        <img
          src="/images/g-pro-sketch.svg"
          alt="Line sketch of the G Pro X Superlight 2 mouse, seen from the left, showing its two side buttons"
        />
        <figcaption>G Pro X Superlight 2 · sketch</figcaption>
      </figure>
      <div
        className="landing-dimension"
        aria-label={`Length ${formatCatalogueSpec(featuredMouse.lengthMm, "mm")}`}
      >
        <span>{formatCatalogueSpec(featuredMouse.lengthMm, "mm")}</span>
      </div>
      <p
        className="landing-annotation"
        aria-label="G Pro X Superlight 2 dimensions and weight"
      >
        {dimension} mm{" "}
        <span>{formatCatalogueSpec(featuredMouse.weightG, "g")}</span>
      </p>

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
      <p className="landing-preview-note">
        Early preview — measurements are still being validated.
      </p>
      <Link className="landing-how-link" href="/how-it-works">
        How it works
      </Link>

      <section className="landing-points" aria-label="Why scan your hand">
        <div>
          <div>
            <h2>One photo. No printing.</h2>
            <p>A blank sheet of A4 is the ruler.</p>
          </div>
        </div>
        <div>
          <div>
            <h2>Ranked for your hand, not the hype.</h2>
            <p>
              {logitechCatalogue.length} Logitech mice scored on length, grip
              width and height.
            </p>
          </div>
        </div>
        <div>
          <div>
            <h2>Private by design.</h2>
            <p>{PHOTO_PRIVACY_COPY}</p>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <p>
          Not affiliated with Logitech. Sizes from Logitech&apos;s published
          specs.
        </p>
      </footer>
    </main>
  );
}
