import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/nav/TopBar";
import { guardDemoRouteFromProduction } from "@/app/scan/demo-guard";
import { learnCopy } from "@/lib/copy/learn";
import { GESTURES, KIT_V1_VERSION, shotsPerHand } from "@/lib/learning/kit";
import { getLocale } from "@/server/i18n/getLocale";
import "./learn.css";

export async function generateMetadata(): Promise<Metadata> {
  const copy = learnCopy(await getLocale());
  return {
    title: copy.learningKit,
    description: copy.metaDescription,
    robots: { index: false, follow: false },
  };
}

export default async function LearnPage() {
  guardDemoRouteFromProduction();
  const copy = learnCopy(await getLocale());
  const perHand = shotsPerHand();
  const gestures = copy.gestures;
  return (
    <main className="learn">
      <TopBar backHref="/" backLabel={copy.home} stepLabel={copy.learningKit} />
      <h1>{copy.learningKit}</h1>
      <p className="learn-lead">{copy.lead}</p>

      <h2>{copy.v2Heading}</h2>
      <p>
        {copy.v2Before} <code>agreed-v2</code> {copy.v2After}
      </p>
      <div className="learn-actions">
        <Link className="learn-button" href="/learn/print?sheet=A">
          {copy.printSheetA}
        </Link>
        <Link className="learn-button-secondary" href="/learn/print?sheet=B">
          {copy.sheetBNotUsed}
        </Link>
        <Link
          className="learn-button-secondary"
          href="/learn/slates?kit=2&from=901&count=12"
        >
          {copy.cardsS0}
        </Link>
        <Link
          className="learn-button-secondary"
          href="/learn/slates?kit=2&from=1&count=48"
        >
          {copy.cardsMain}
        </Link>
        <Link className="learn-button-secondary" href="/learn/check?sheet=A">
          {copy.checkSheetA}
        </Link>
      </div>
      <p className="learn-note">
        {copy.afterSession}{" "}
        <code>
          npm run learn:sort -- --in &lt;folder&gt; --session
          &lt;session.json&gt;
        </code>
        {copy.afterSessionB} <code>docs/learning/README.md</code>
        {copy.afterSessionC}
      </p>

      <h2>{copy.v1Heading}</h2>
      <p>{copy.v1Body}</p>

      <h2>{copy.youNeed}</h2>
      <ul>
        <li>{copy.needPrinter}</li>
        <li>{copy.needRuler}</li>
        <li>{copy.needTable}</li>
        <li>{copy.needPhone}</li>
      </ul>

      <h2>{copy.printHeading}</h2>
      <div className="learn-actions">
        <Link className="learn-button" href="/learn/print?hands=both">
          {copy.printBoth(GESTURES.length * 2)}
        </Link>
        <Link
          className="learn-button-secondary"
          href="/learn/print?hands=right"
        >
          {copy.printRight(GESTURES.length)}
        </Link>
        <Link className="learn-button-secondary" href="/learn/print?hands=left">
          {copy.printLeft(GESTURES.length)}
        </Link>
        <Link className="learn-button-secondary" href="/learn/slates?from=1">
          {copy.participantCardsLink}
        </Link>
      </div>
      <p className="learn-note">{copy.reusableNote}</p>

      <h2>{copy.sessionOrder}</h2>
      <p>{copy.sessionOrderBody(perHand)}</p>
      <ol className="learn-sequence">
        <li>
          <span className="learn-token">{copy.seqCard}</span>
          <span className="learn-count">{copy.seqCardCount}</span>
          <span className="learn-detail">{copy.seqCardDetail}</span>
        </li>
        {GESTURES.map((g) => (
          <li key={g.code}>
            <span>
              <span className="learn-token">{g.code}</span>{" "}
              {gestures[g.code].name}
            </span>
            <span className="learn-count">{copy.eachHand(g.shots)}</span>
            <span className="learn-detail">
              {g.camera === "above" ? copy.cameraAbove : copy.cameraSide}{" "}
              <Link href={`/l/v${KIT_V1_VERSION}/${g.code}R`}>
                {copy.instructions}
              </Link>
            </span>
          </li>
        ))}
      </ol>
      <p className="learn-note">{copy.poseOrderNote}</p>

      <h2>{copy.checkSortHeading}</h2>
      <div className="learn-actions">
        <Link className="learn-button" href="/learn/check?sheet=v1">
          {copy.checkKitV1}
        </Link>
      </div>
      <p>
        {copy.checkerBody1}{" "}
        <code>
          npm run learn:sort -- --in &lt;folder&gt; --session
          &lt;session.json&gt;
        </code>
        {copy.checkerBody2} <code>../Fixtures/learning/</code>
        {copy.checkerBody3}
      </p>

      <h2>{copy.privacyHeading}</h2>
      <p>{copy.privacyBody}</p>
    </main>
  );
}
