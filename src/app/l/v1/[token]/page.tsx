import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TopBar } from "@/components/nav/TopBar";
import { guardDemoRouteFromProduction } from "@/app/scan/demo-guard";
import {
  GESTURES,
  buildSequence,
  gestureByCode,
  kitCodeToken,
  parseKitToken,
  shotsPerHand,
  type KitCode,
} from "@/lib/learning/kit";
import "../../../learn/learn.css";

/**
 * Where a printed kit QR code lands. The URL is the QR content, so this page
 * must keep answering for every code ever printed at kit version 1.
 */

export const metadata: Metadata = {
  title: "Learning kit pose — Open Mouse",
  robots: { index: false, follow: false },
};

const VERSION = 1;

function poseHref(code: KitCode): string {
  return `/l/v${VERSION}/${kitCodeToken(code)}`;
}

export default async function KitCodePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  guardDemoRouteFromProduction();
  const { token } = await params;
  const code = parseKitToken(token, VERSION);
  if (!code) notFound();

  if (code.kind === "participant") {
    const first = GESTURES[0]!;
    return (
      <main className="learn">
        <TopBar
          backHref="/learn"
          backLabel="Learning kit"
          stepLabel="Session"
        />
        <p className="learn-pose-code">{code.participant}</p>
        <h1>Session {code.participant}</h1>
        <p className="learn-lead">
          Photograph this card with the ruler values written on it, then work
          through the seven poses: {shotsPerHand()} photos per hand, right hand
          first.
        </p>
        <div className="learn-actions">
          <Link
            className="learn-button"
            href={poseHref({
              kind: "gesture",
              version: VERSION,
              gesture: first.code,
              hand: "right",
            })}
          >
            Start with {first.code}R, {first.name.toLowerCase()}
          </Link>
          <Link className="learn-button-secondary" href="/learn/check?sheet=v1">
            Check photos
          </Link>
        </div>
      </main>
    );
  }

  const gesture = gestureByCode(code.gesture);
  const handWord = code.hand === "right" ? "Right hand" : "Left hand";
  const sequence = buildSequence();
  const lastOfThis = sequence.findLast(
    (s) => s.gesture.code === code.gesture && s.hand === code.hand,
  );
  const next = lastOfThis ? sequence[lastOfThis.index] : undefined;

  return (
    <main className="learn">
      <TopBar
        backHref="/learn"
        backLabel="Learning kit"
        stepLabel={`Pose ${GESTURES.indexOf(gesture) + 1} of ${GESTURES.length}`}
      />
      <p className="learn-pose-code">{kitCodeToken(code)}</p>
      <h1>{gesture.name}</h1>
      <p className="learn-lead">
        {handWord}, {gesture.shots} photos.{" "}
        {gesture.camera === "above"
          ? "Keep the sheet's top flap flat."
          : "Fold the sheet's top flap up."}
      </p>
      <ol className="learn-steps">
        {gesture.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <h2>What these photos are for</h2>
      <p>{gesture.yields}</p>
      <div className="learn-next">
        {next ? (
          <>
            <p>
              Next:{" "}
              <strong>
                {kitCodeToken({
                  kind: "gesture",
                  version: VERSION,
                  gesture: next.gesture.code,
                  hand: next.hand,
                })}
              </strong>
              , {next.gesture.name.toLowerCase()}
              {next.hand !== code.hand ? ", other hand" : ""}.
            </p>
            <Link
              className="learn-button-secondary"
              href={poseHref({
                kind: "gesture",
                version: VERSION,
                gesture: next.gesture.code,
                hand: next.hand,
              })}
            >
              Open the next pose
            </Link>
          </>
        ) : (
          <>
            <p>
              That was the last pose. Check the photos before the person leaves.
            </p>
            <Link className="learn-button" href="/learn/check?sheet=v1">
              Check photos
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
