"use client";

/**
 * The main page's side menu (docs/design/product-shell-2026-09-25/README.md:
 * "a navigation panel with a close control and a dimmed main page behind
 * it... closes by the close control, scrim, or Escape. Return focus to the
 * trigger."). Only today's real, functioning routes are listed — no
 * catalogue browser or "My results" yet, so no dead links.
 *
 * Built on a native `<dialog>` (the same pattern AccountView's delete
 * confirmation already uses): `showModal()` gives us a top-layer focus trap
 * and Escape-to-close for free, and the backdrop click closes it too.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import "./nav-menu.css";

export function NavMenu() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      dialog?.close();
      trigger?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="navMenuTrigger"
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Open menu"
        onClick={() => setOpen(true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M4 6h16M4 12h16M4 18h16"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open && (
        <dialog
          ref={dialogRef}
          className="navMenu"
          aria-label="Navigation"
          onClose={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        >
          <div className="navMenuHeader">
            <span className="navMenuTitle">Menu</span>
            <button
              type="button"
              className="navMenuClose"
              ref={closeRef}
              aria-label="Close menu"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <nav aria-label="Main">
            <ul className="navMenuList">
              <li>
                <Link href="/" onClick={() => setOpen(false)}>
                  Home
                </Link>
              </li>
              <li>
                <Link href="/scan/easy" onClick={() => setOpen(false)}>
                  Scan my hand
                </Link>
              </li>
              <li>
                <Link href="/how-it-works" onClick={() => setOpen(false)}>
                  How it works
                </Link>
              </li>
              <li>
                <Link href="/account" onClick={() => setOpen(false)}>
                  Account
                </Link>
              </li>
            </ul>
          </nav>
        </dialog>
      )}
    </>
  );
}
