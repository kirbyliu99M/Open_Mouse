import Link from "next/link";
import { ParticleStage } from "@/components/home/ParticleStage";
import { NavMenu } from "@/components/nav/NavMenu";
import { homeStoryNotes } from "@/lib/copy/home-story";
import { handSheetFrame } from "@/lib/particles/template-hand";
import "./home.css";

/**
 * Home v3 (docs/design/home-v3-2026-10-03/README.md, "Page structure"). The
 * story section holds the hero, the hand on A4 and the three mice as ordinary
 * stacked blocks with static SVGs (PR A). That static layout is what a visitor
 * gets without JS, with reduced motion, on a small screen, or if the particle
 * module fails to load. PR B's <ParticleStage /> loads after the first paint
 * and, when allowed, draws a canvas under the hero and switches the section to
 * the pinned, scroll-driven layout (`story--animated`). The copy is the
 * production copy minus the removed lines (the three taglines, "Measure your
 * hand.", and the photo-privacy sentence, which stays on How it works, the
 * scan screens and the camera).
 */
export default function HomePage() {
  const frame = handSheetFrame();
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

      <section className="story">
        <div className="story-panel">
          <div className="story-hero" data-testid="home-hero">
            {/* The mark is decorative: the wordmark in the nav names the site. */}
            <div className="story-logo">
              {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, and the LCP image: no loader wanted */}
              <img
                src="/images/logo-placeholder.svg"
                alt=""
                width={220}
                height={196}
              />
            </div>
            <h1>Find the mouse that fits.</h1>
            <p className="home-subhead">
              A blank sheet of A4 and your phone are all it takes.
            </p>
            <HomeActions />
            <p className="landing-preview-note">
              Early preview — measurements are still being validated.
            </p>
          </div>

          {/* The hand on A4 with its landmarks and the two measurement lines
              (end ticks, no numbers): an illustration, not a result. The
              sheet's outline is a CSS border over the image, so it follows
              --hairline and `prefers-contrast: more`. */}
          <div className="story-hand">
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG */}
            <img src="/images/hand-on-a4.svg" alt="" width={411} height={507} />
            <span
              className="story-hand-sheet"
              aria-hidden="true"
              style={{
                left: `${frame.left}%`,
                top: `${frame.top}%`,
                width: `${frame.width}%`,
                height: `${frame.height}%`,
              }}
            />
          </div>

          {/* Five short annotations on the hand's landmarks and lines (Home
              v3.1; candidate wording). Real text, in reading order after the
              hand. The static layout, reduced motion and no JS show them as
              this list; the particle stage places each beside or below the
              hand and fades them in and out over the hand's measured step.
              The canvas's rings and leaders are decoration and not part of
              this. */}
          <ul className="story-notes">
            {homeStoryNotes().map((note) => (
              <li key={note.key} className="story-note" data-note={note.key}>
                <p className="story-note-title">{note.title}</p>
                <p className="story-note-why">{note.why}</p>
              </li>
            ))}
          </ul>

          {/* Only G Pro exists, so all three are placeholders until more
              sketches do. Each mouse's name is real text. */}
          <ul className="story-mice">
            {[0, 1, 2].map((slot) => (
              <li key={slot}>
                <figure className="story-mouse" data-sketch="g-pro-sketch">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static SVG sketch */}
                  <img
                    src="/images/sketches/g-pro-sketch.svg"
                    alt=""
                    width={488}
                    height={232}
                  />
                  <figcaption>G Pro X Superlight 2 · sketch</figcaption>
                </figure>
              </li>
            ))}
          </ul>

          {/* Decorative, and last in the panel: it is drawn under everything. */}
          <ParticleStage />
        </div>
      </section>

      <section className="home-final" data-testid="home-final">
        <HomeActions />
        <p className="landing-preview-note">
          Early preview — measurements are still being validated.
        </p>
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

/** "Scan my hand" (the filled primary) and "How it works" (the outline secondary). */
function HomeActions() {
  return (
    <div className="home-actions">
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
      <Link className="home-cta-secondary" href="/how-it-works">
        How it works
      </Link>
    </div>
  );
}
