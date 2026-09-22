import { auth, signIn, signOut } from "../../auth";
import { createDrizzleAccountRepo } from "../../server/account/drizzle-repo";
import { isAuthConfigured } from "../../server/auth/config";
import { AccountView } from "./AccountView";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await auth();

  if (!session?.user) {
    const configured = isAuthConfigured();
    return (
      <main className="account">
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
            <button type="submit" className="button-primary">
              Sign in with Google
            </button>
          </form>
        ) : (
          <p className="note" role="status">
            Sign-in unavailable
          </p>
        )}
      </main>
    );
  }

  const repo = createDrizzleAccountRepo();
  const scans = await repo.listScans(session.user.id);

  return (
    <main className="account">
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
          <button type="submit" className="button-secondary">
            Sign out
          </button>
        </form>
      </div>
      <AccountView scans={scans} />
    </main>
  );
}
