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
import { learnCopy } from "@/lib/copy/learn";
import { getLocale } from "@/server/i18n/getLocale";
import "../../../learn/learn.css";

/**
 * Where a printed kit QR code lands. The URL is the QR content, so this page
 * must keep answering for every code ever printed at kit version 1.
 */

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: learnCopy(await getLocale()).poseMetaTitle,
    robots: { index: false, follow: false },
  };
}

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
  const copy = learnCopy(await getLocale());
  const { token } = await params;
  const code = parseKitToken(token, VERSION);
  if (!code) notFound();

  if (code.kind === "participant") {
    const first = GESTURES[0]!;
    return (
      <main className="learn">
        <TopBar
          backHref="/learn"
          backLabel={copy.learningKit}
          stepLabel={copy.session}
        />
        <p className="learn-pose-code">{code.participant}</p>
        <h1>{copy.sessionTitle(code.participant)}</h1>
        <p className="learn-lead">{copy.sessionLead(shotsPerHand())}</p>
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
            {copy.startWith(`${first.code}R`, copy.gestures[first.code].name)}
          </Link>
          <Link className="learn-button-secondary" href="/learn/check?sheet=v1">
            {copy.checkPhotos}
          </Link>
        </div>
      </main>
    );
  }

  const gesture = gestureByCode(code.gesture);
  const poseCopy = copy.gestures[gesture.code];
  const handWord = code.hand === "right" ? copy.rightHand : copy.leftHand;
  const sequence = buildSequence();
  const lastOfThis = sequence.findLast(
    (s) => s.gesture.code === code.gesture && s.hand === code.hand,
  );
  const next = lastOfThis ? sequence[lastOfThis.index] : undefined;

  return (
    <main className="learn">
      <TopBar
        backHref="/learn"
        backLabel={copy.learningKit}
        stepLabel={copy.poseOf(GESTURES.indexOf(gesture) + 1, GESTURES.length)}
      />
      <p className="learn-pose-code">{kitCodeToken(code)}</p>
      <h1>{poseCopy.name}</h1>
      <p className="learn-lead">
        {copy.poseLead(handWord, gesture.shots, gesture.camera === "above")}
      </p>
      <ol className="learn-steps">
        {poseCopy.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <h2>{copy.whatFor}</h2>
      <p>{poseCopy.yields}</p>
      <div className="learn-next">
        {next ? (
          <>
            <p>
              {copy.nextPrefix}{" "}
              <strong>
                {kitCodeToken({
                  kind: "gesture",
                  version: VERSION,
                  gesture: next.gesture.code,
                  hand: next.hand,
                })}
              </strong>
              {copy.nextAfter(
                copy.gestures[next.gesture.code].name,
                next.hand !== code.hand,
              )}
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
              {copy.openNext}
            </Link>
          </>
        ) : (
          <>
            <p>{copy.lastPose}</p>
            <Link className="learn-button" href="/learn/check?sheet=v1">
              {copy.checkPhotos}
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
