import { auth, signIn, signOut } from "../../auth";
import { createDrizzleAccountRepo } from "../../server/account/drizzle-repo";
import { isAuthConfigured } from "../../server/auth/config";
import { AccountView } from "./AccountView";
import { AuthButton } from "./AuthButton";
import { TopBar } from "@/components/nav/TopBar";
import Link from "next/link";
import "./account.css";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await auth();

  if (!session?.user) {
    const configured = isAuthConfigured();
    return (
      <main className="account">
        <TopBar backHref="/" backLabel="Home" stepLabel="Account" />
        <p className="eyebrow">Account</p>
        <h1>Sign in to keep your scans</h1>
        <p>
          Without an account, your scan is deleted within 24 hours of when you
          made it. Sign in and it&apos;s kept until you delete it.
        </p>
        {configured ? (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: "/account" });
            }}
          >
            <AuthButton action="in" />
          </form>
        ) : (
          <div className="account-unavailable" role="status">
            <p>Sign-in is unavailable right now.</p>
            <Link href="/sheet">Start measuring without signing in</Link>
          </div>
        )}
      </main>
    );
  }

  const repo = createDrizzleAccountRepo();
  const scans = await repo.listScans(session.user.id);

  return (
    <main className="account">
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
