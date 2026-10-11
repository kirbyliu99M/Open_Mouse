import { auth, signIn, signOut } from "../../auth";
import { createDrizzleAccountRepo } from "../../server/account/drizzle-repo";
import { isAuthConfigured } from "../../server/auth/config";
import { readAccountEmail, readMouseNames } from "../../server/account/profile";
import { AccountView } from "./AccountView";
import { AnonymousAnswerLink } from "./AnonymousAnswerLink";
import { AuthButton } from "./AuthButton";
import { LegacyHandKeySweep } from "@/components/results/LegacyHandKeySweep";
import { TopBar } from "@/components/nav/TopBar";
import type { Metadata } from "next";
import Link from "next/link";
import { accountCopy } from "@/lib/copy/account";
import { getLocale } from "@/server/i18n/getLocale";
import "./account.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: accountCopy(await getLocale()).metaTitle };
}

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const copy = accountCopy(await getLocale());
  const session = await auth();

  if (!session?.user) {
    const configured = isAuthConfigured();
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
            {/* No client-readable id of a scan in this browser exists yet, so
                the link scans first (see AnonymousAnswerLink). */}
            <AnonymousAnswerLink scanId={null} />
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
  const [scans, email, mouseNames] = await Promise.all([
    repo.listScans(userId),
    readAccountEmail(userId).catch(() => null),
    readMouseNames().catch(() => ({}) as Record<string, string>),
  ]);

  return (
    <main className="account">
      <LegacyHandKeySweep />
      <TopBar backHref="/" backLabel={copy.home} stepLabel={copy.title} />
      <h1>{copy.title}</h1>
      <p className="account-subtitle">{copy.signedInSubtitle}</p>
      <AccountView
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
