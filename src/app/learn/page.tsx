import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/nav/TopBar";
import { guardDemoRouteFromProduction } from "@/app/scan/demo-guard";
import { GESTURES, KIT_V1_VERSION, shotsPerHand } from "@/lib/learning/kit";
import "./learn.css";

export const metadata: Metadata = {
  title: "Learning kit — Open Mouse",
  description:
    "Printed, QR-labelled pages for collecting ruler-checked hand photos.",
  robots: { index: false, follow: false },
};

export default function LearnPage() {
  guardDemoRouteFromProduction();
  const perHand = shotsPerHand();
  return (
    <main className="learn">
      <TopBar backHref="/" backLabel="Home" stepLabel="Learning kit" />
      <h1>Learning kit</h1>
      <p className="learn-lead">
        Printed pages that label every photo. Each page shows one hand pose and
        carries its own QR code, so a photo records which pose it is. Photos
        from many hands, checked against a ruler, set how accurate the
        blank-paper scan can be.
      </p>

      <h2>Kit v2: one sheet, one card</h2>
      <p>
        The collection protocol <code>agreed-v2</code> (2026-10-02): one A4
        sheet for both hands, a participant card in its slot, G02 ×3 then G04 ×2
        per person. The pose comes from the shooting order; the card&apos;s QR
        code names the participant. Sheet A keeps the product sheet&apos;s four
        markers; sheet B puts six markers on the outer ring and leaves the hand
        area blank. The S0 pilot picks one.
      </p>
      <div className="learn-actions">
        <Link className="learn-button" href="/learn/print?sheet=A">
          Print sheet A
        </Link>
        <Link className="learn-button" href="/learn/print?sheet=B">
          Print sheet B
        </Link>
        <Link
          className="learn-button-secondary"
          href="/learn/slates?kit=2&from=901&count=12"
        >
          Cards P901 to P912 (S0)
        </Link>
        <Link
          className="learn-button-secondary"
          href="/learn/slates?kit=2&from=1&count=48"
        >
          Cards P001 to P048
        </Link>
      </div>
      <p className="learn-note">
        After a session:{" "}
        <code>
          npm run learn:sort -- --in &lt;folder&gt; --session
          &lt;session.json&gt;
        </code>
        . It strips EXIF from the filed copies. Details:{" "}
        <code>docs/learning/README.md</code>, &ldquo;Kit v2&rdquo;.
      </p>

      <h2>Kit v1: seven poses per hand</h2>
      <p>
        The earlier kit, with a QR code on every pose page and a ruler-measured
        truth. Its pages stay printable below. Its photos are a version mismatch
        to a v2 run.
      </p>

      <h2>You need</h2>
      <ul>
        <li>A printer set to 100% / Actual size, and plain A4 paper</li>
        <li>A ruler, to check the printed 100 mm line and measure each hand</li>
        <li>
          A table darker than the paper, and a book to stand a flap against
        </li>
        <li>A phone. Use its normal camera app with the main 1× lens</li>
      </ul>

      <h2>Print</h2>
      <div className="learn-actions">
        <Link className="learn-button" href="/learn/print?hands=both">
          Print both hands, {GESTURES.length * 2} pages
        </Link>
        <Link
          className="learn-button-secondary"
          href="/learn/print?hands=right"
        >
          Right hand only, {GESTURES.length} pages
        </Link>
        <Link className="learn-button-secondary" href="/learn/print?hands=left">
          Left hand only, {GESTURES.length} pages
        </Link>
        <Link className="learn-button-secondary" href="/learn/slates?from=1">
          Participant cards
        </Link>
      </div>
      <p className="learn-note">
        The pages are reusable across people. Print one card per person: it
        carries their participant number, never their name.
      </p>

      <h2>Session order</h2>
      <p>
        {perHand} photos per hand, about 10 minutes per hand. Each page&apos;s
        QR code names its pose and hand; the checker reads it from the photo.
      </p>
      <ol className="learn-sequence">
        <li>
          <span className="learn-token">Card</span>
          <span className="learn-count">1 photo</span>
          <span className="learn-detail">
            Write the ruler values on the participant card: hand length (wrist
            crease to middle fingertip) and palm width. Photograph the card
            first.
          </span>
        </li>
        {GESTURES.map((g) => (
          <li key={g.code}>
            <span>
              <span className="learn-token">{g.code}</span> {g.name}
            </span>
            <span className="learn-count">{g.shots} × each hand</span>
            <span className="learn-detail">
              {g.camera === "above"
                ? "Camera above, flap flat."
                : "Camera at table height, flap folded up."}{" "}
              <Link href={`/l/v${KIT_V1_VERSION}/${g.code}R`}>
                Instructions
              </Link>
            </span>
          </li>
        ))}
      </ol>
      <p className="learn-note">
        Do all seven poses with the right hand, then all seven with the left.
        Lift the hand and place it again between photos, even within a pose.
      </p>

      <h2>Check and sort</h2>
      <div className="learn-actions">
        <Link className="learn-button" href="/learn/check">
          Check photos
        </Link>
      </div>
      <p>
        The checker reads each photo&apos;s QR code, finds the printed markers
        and the paper edges, and says which photos to retake. To file a whole
        folder by participant and pose, run{" "}
        <code>npm run learn:sort -- --in &lt;folder&gt;</code>. It writes to{" "}
        <code>../Fixtures/learning/</code>, outside the repo.
      </p>

      <h2>Privacy</h2>
      <p>
        The checker processes photos on this device; nothing is uploaded. Ask
        each person before photographing their hand, use participant numbers
        instead of names, and keep the photos out of the repo. These photos are
        for measuring hand shape and posture only; they are not a health
        assessment.
      </p>
    </main>
  );
}
