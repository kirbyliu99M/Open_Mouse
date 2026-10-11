"use client";

import { useFormStatus } from "react-dom";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { accountCopy } from "@/lib/copy/account";

/**
 * The "in" action reads "Continue with Google" (docs/design/
 * easy-scan-shell-2026-09-25/README.md, screen 12) — no drawn Google logo
 * (Google's branding rules reserve their mark for their own asset; a
 * hand-drawn stand-in would misrepresent it). The profile frame (2026-10-12)
 * shows the official multi-colour G on a white pill; that asset is still to
 * come from Claude, so the arrow below stays until it does. The "out" action is
 * the plain grey 「登出」 at the foot of the profile page.
 */
export function AuthButton({ action }: { action: "in" | "out" }) {
  const { pending } = useFormStatus();
  const copy = accountCopy(useLocale());
  const label = action === "in" ? copy.continueWithGoogle : copy.signOut;
  const pendingLabel = action === "in" ? copy.signingIn : copy.signingOut;
  const currentLabel = pending ? pendingLabel : label;
  return (
    <button
      type="submit"
      className={
        action === "in" ? "account-google-button" : "profile-signout-button"
      }
      disabled={pending}
      aria-disabled={pending}
      // Explicit, so the button's own accessible name is always this text —
      // some browsers exclude a nested role="status" region's content from
      // the "name from content" computation, which otherwise left this
      // button with no accessible name at all despite visible text.
      aria-label={currentLabel}
    >
      {action === "in" && (
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          aria-hidden="true"
          focusable="false"
        >
          <path
            d="M5 12h11M12 6l6 6-6 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <span role="status" aria-live="polite">
        {currentLabel}
      </span>
    </button>
  );
}
