"use client";

import { useFormStatus } from "react-dom";

/**
 * The "in" action reads "Continue with Google" (docs/design/
 * easy-scan-shell-2026-09-25/README.md, screen 12) — outlined, neutral, no
 * drawn Google logo (Google's branding rules reserve their mark for their
 * own asset; a hand-drawn stand-in would misrepresent it).
 */
export function AuthButton({ action }: { action: "in" | "out" }) {
  const { pending } = useFormStatus();
  const label = action === "in" ? "Continue with Google" : "Sign out";
  const pendingLabel = action === "in" ? "Signing in…" : "Signing out…";
  const currentLabel = pending ? pendingLabel : label;
  return (
    <button
      type="submit"
      className={action === "in" ? "account-google-button" : "button-secondary"}
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
