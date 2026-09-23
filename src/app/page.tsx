import Link from "next/link";
import "./home.css";

export default function HomePage() {
  return (
    <main className="home-main">
      <p className="home-status">
        Early preview · measurements still being validated
      </p>
      <h1>Find a mouse that fits your hand.</h1>
      <p className="home-intro">
        Print a sheet, photograph your hand on it, and get mice ranked for your
        size and grip.
      </p>
      <ol className="home-steps">
        <li>
          <span>1</span>
          <div>
            <strong>Print the sheet</strong>
            <p>A4 or Letter, at actual size.</p>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <strong>Photograph your hand on it</strong>
            <p>From directly above, with a bank card beside it.</p>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <strong>See your matches</strong>
            <p>Ranked, with the reasons for each.</p>
          </div>
        </li>
      </ol>
      <div className="home-actions">
        <Link className="home-primary" href="/sheet">
          Get started
        </Link>
        <Link className="home-secondary" href="/scan">
          I already have the sheet
        </Link>
      </div>
      <p className="home-privacy">
        Your photo is processed on this device and never uploaded.
      </p>
      <Link className="home-account" href="/account">
        Sign in to keep your scans
      </Link>
    </main>
  );
}
