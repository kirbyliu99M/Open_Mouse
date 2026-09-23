"use client";

import { useFormStatus } from "react-dom";

export function AuthButton({ action }: { action: "in" | "out" }) {
  const { pending } = useFormStatus();
  const label = action === "in" ? "Sign in with Google" : "Sign out";
  const pendingLabel = action === "in" ? "Signing in…" : "Signing out…";
  return (
    <button
      type="submit"
      className={action === "in" ? "button-primary" : "button-secondary"}
      disabled={pending}
      aria-disabled={pending}
    >
      <span role="status" aria-live="polite">
        {pending ? pendingLabel : label}
      </span>
    </button>
  );
}
