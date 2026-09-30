import { auth, signIn, signOut } from "../../auth";
import { createDrizzleAccountRepo } from "../../server/account/drizzle-repo";
import { isAuthConfigured } from "../../server/auth/config";
import { AccountView } from "./AccountView";
import { AuthButton } from "./AuthButton";
import { LegacyHandKeySweep } from "@/components/results/LegacyHandKeySweep";
import { TopBar } from "@/components/nav/TopBar";
import type { Metadata } from "next";
import Link from "next/link";
import "./account.css";

export const metadata: Metadata = { title: "Account" };

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await auth();

  if (!session?.user) {
    const configured = isAuthConfigured();
    return (
      <main className="account">
        <LegacyHandKeySweep />
        <TopBar backHref="/" backLabel="Home" stepLabel="Account" />
        <span className="account-hero-icon" aria-hidden="true">
          <PersonIcon />
        </span>
        <h1>Keep your scans</h1>
        <p className="account-subtitle">
          Signing in is optional. Without an account, a scan is deleted
          automatically after a while.
        </p>
        <ul className="account-benefits">
          <li>
            <span aria-hidden="true">
              <BookmarkIcon />
            </span>
            Your scans stay until you delete them
          </li>
          <li>
            <span aria-hidden="true">
              <DeviceIcon />
            </span>
            Open your results on any device
          </li>
          <li>
            <span aria-hidden="true">
              <TrashIcon />
            </span>
            Delete everything in one tap, any time
          </li>
        </ul>
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
            <Link className="account-skip-link" href="/scan/easy">
              Scan without an account
            </Link>
            <p className="account-fine-print">
              We keep your email address and your scans — never your photo. Your
              current scan joins your account when you sign in.
            </p>
          </>
        ) : (
          <>
            <div className="account-unavailable" role="status">
              <span aria-hidden="true">
                <InfoIcon />
              </span>
              <p>
                Sign-in is unavailable right now. You can still scan — your
                result is kept for a while, then deleted automatically.
              </p>
            </div>
            <Link className="account-start-button" href="/scan/easy">
              <CameraIcon /> Scan my hand
            </Link>
            <p className="account-fine-print">
              When sign-in opens, your scans can be saved to your account.
            </p>
          </>
        )}
      </main>
    );
  }

  const repo = createDrizzleAccountRepo();
  const scans = await repo.listScans(session.user.id);

  return (
    <main className="account">
      <LegacyHandKeySweep />
      <TopBar backHref="/" backLabel="Home" stepLabel="Account" />
      <div className="account-header">
        <div>
          <p className="eyebrow">Account</p>
          <h1>Your scans</h1>
          <p className="note">Kept until you delete it.</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <AuthButton action="out" />
        </form>
      </div>
      <AccountView scans={scans} />
    </main>
  );
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" focusable="false">
      <circle
        cx="12"
        cy="8"
        r="3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" focusable="false">
      <path
        d="M5 3.5h10a1 1 0 0 1 1 1V17l-6-3.5L4 17V4.5a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M7.3 9.3l1.6 1.6 3-3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DeviceIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" focusable="false">
      <rect
        x="6"
        y="2.5"
        width="8"
        height="15"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M9.3 15h1.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" focusable="false">
      <path
        d="M4.5 6h11M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6M6 6l.7 9.3a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L14 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 9v4M11.5 9v4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
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
