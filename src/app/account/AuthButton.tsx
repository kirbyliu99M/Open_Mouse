"use client";

import { useFormStatus } from "react-dom";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { accountCopy } from "@/lib/copy/account";

/**
 * The "in" action reads "Continue with Google" (docs/design/
 * easy-scan-shell-2026-09-25/README.md, screen 12) on a white pill with
 * Google's multi-colour G at its left (the profile frame, 2026-10-12). The G is
 * `public/images/google-g.png`: Kirby's file, scaled to 128 px and nothing else
 * (never recoloured, reshaped, shadowed or animated: it is Google's trademark
 * and Google's sign-in branding rules forbid changing it). Its source is not
 * confirmed; replacing it with Google's own "Sign in with Google" brand asset
 * (SVG) is recommended. The image is decoration (`alt=""`); the button's name is
 * its text. The "out" action is the plain grey 「登出」 at the foot of the
 * profile page.
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
        // eslint-disable-next-line @next/next/no-img-element -- one fixed 128 px brand mark, shown at 28 px; no next/image config needed
        <img
          className="account-google-mark"
          src="/images/google-g.png"
          alt=""
          width={28}
          height={28}
        />
      )}
      <span role="status" aria-live="polite">
        {currentLabel}
      </span>
    </button>
  );
}
