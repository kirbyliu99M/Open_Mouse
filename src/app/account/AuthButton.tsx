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
  return (
    <button
      type="submit"
      className={action === "in" ? "account-google-button" : "button-secondary"}
      disabled={pending}
      aria-disabled={pending}
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
        {pending ? pendingLabel : label}
      </span>
    </button>
  );
}
