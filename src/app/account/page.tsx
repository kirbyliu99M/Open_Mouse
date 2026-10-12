import { auth, signIn, signOut } from "../../auth";
import { createDrizzleAccountRepo } from "../../server/account/drizzle-repo";
import { isAuthConfigured } from "../../server/auth/config";
import {
  readAccountEmail,
  readCatalogueChoices,
  readMouseNames,
  readSessionLatestScanId,
} from "../../server/account/profile";
import {
  SCAN_SESSION_COOKIE,
  parseSessionId,
} from "../../server/scans/cookies";
import { SignedInProfile, SignedOutAnswer } from "./AccountClient";
import { mouseNamesFromRows } from "./profile-model";
import { AuthButton } from "./AuthButton";
import { LegacyHandKeySweep } from "@/components/results/LegacyHandKeySweep";
import { TopBar } from "@/components/nav/TopBar";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { accountCopy } from "@/lib/copy/account";
import { getLocale } from "@/server/i18n/getLocale";
import "./account.css";
import "./questionnaire.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: accountCopy(await getLocale()).metaTitle };
}

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const copy = accountCopy(await getLocale());
  const session = await auth();

  if (!session?.user) {
    const configured = isAuthConfigured();
    // Whether this browser holds a scan decides where the link goes: the form
    // for a scan of this browser's own session cookie, else a scan first. Both
    // reads are extras: a failure leaves the link going to /scan/easy.
    const sessionId = configured
      ? parseSessionId((await cookies()).get(SCAN_SESSION_COOKIE)?.value)
      : null;
    const [ownScanId, choices] = configured
      ? await Promise.all([
          readSessionLatestScanId(sessionId).catch(() => null),
          readCatalogueChoices().catch(() => []),
        ])
      : [null, []];
    return (
      <main className="account">
        <LegacyHandKeySweep />
        <TopBar backHref="/" backLabel={copy.home} stepLabel={copy.title} />
        <h1>{copy.title}</h1>
        <p className="account-subtitle">
          {configured
            ? copy.signedOutSubtitle
            : copy.signedOutSubtitleUnavailable}
        </p>
        {configured ? (
          <>
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/account" });
              }}
            >
              <AuthButton action="in" />
            </form>
            <SignedOutAnswer
              scanId={ownScanId}
              catalogue={choices}
              mouseNames={mouseNamesFromRows(choices)}
            />
            <p className="account-fine-print">
              {copy.answerWithoutAccountNote}
            </p>
            <p className="account-fine-print">{copy.finePrint}</p>
          </>
        ) : (
          <>
            <div className="account-unavailable" role="status">
              <span aria-hidden="true">
                <InfoIcon />
              </span>
              <p>{copy.unavailable}</p>
            </div>
            <Link className="account-start-button" href="/scan/easy">
              <CameraIcon /> {copy.scanMyHand}
            </Link>
            <p className="account-fine-print">{copy.whenOpens}</p>
          </>
        )}
      </main>
    );
  }

  const userId = session.user.id;
  const repo = createDrizzleAccountRepo();
  // The e-mail and the mouse names are extras: the page still renders, without
  // them, when either read fails.
  const [scans, email, mouseNames, catalogue] = await Promise.all([
    repo.listScans(userId),
    readAccountEmail(userId).catch(() => null),
    readMouseNames().catch(() => ({}) as Record<string, string>),
    readCatalogueChoices().catch(() => []),
  ]);

  return (
    <main className="account">
      <LegacyHandKeySweep />
      <TopBar backHref="/" backLabel={copy.home} stepLabel={copy.title} />
      <h1>{copy.title}</h1>
      <p className="account-subtitle">{copy.signedInSubtitle}</p>
      <SignedInProfile
        catalogue={catalogue}
        scans={scans}
        profile={{
          name: session.user.name ?? null,
          email,
          image: session.user.image ?? null,
        }}
        mouseNames={mouseNames}
        signOut={
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <AuthButton action="out" />
          </form>
        }
      />
    </main>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" focusable="false">
      <circle
        cx="10"
        cy="10"
        r="7.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M10 9.3v4.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="10" cy="6.8" r="0.9" fill="currentColor" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      focusable="false"
      aria-hidden="true"
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
  );
}
