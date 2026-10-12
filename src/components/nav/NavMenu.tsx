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
import { useLocale } from "@/client/i18n/LocaleProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { navCopy } from "@/lib/copy/nav";
import { UnansweredMarker } from "./UnansweredMarker";
import "./nav-menu.css";

export function NavMenu({
  profileUnanswered = false,
}: {
  /**
   * True when the signed-in person has not answered the questionnaire: the
   * profile item then carries the marker 「尚未填答」. Off by default; the rule
   * that decides it belongs to the results work (Builder R), not to the menu.
   */
  profileUnanswered?: boolean;
}) {
  const copy = navCopy(useLocale());
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
        aria-label={copy.menuOpen}
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
          aria-label={copy.menuDialogLabel}
          onClose={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        >
          <div className="navMenuHeader">
            <span className="navMenuTitle">{copy.menuTitle}</span>
            <button
              type="button"
              className="navMenuClose"
              ref={closeRef}
              aria-label={copy.menuClose}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          <nav aria-label={copy.menuMainLabel}>
            <ul className="navMenuList">
              <li>
                <Link href="/" onClick={() => setOpen(false)}>
                  {copy.home}
                </Link>
              </li>
              <li>
                <Link href="/scan/easy" onClick={() => setOpen(false)}>
                  {copy.scanMyHand}
                </Link>
              </li>
              <li>
                <Link href="/how-it-works" onClick={() => setOpen(false)}>
                  {copy.howItWorks}
                </Link>
              </li>
              <li>
                <Link href="/account" onClick={() => setOpen(false)}>
                  {copy.account}
                  {profileUnanswered && <UnansweredMarker />}
                </Link>
              </li>
            </ul>
          </nav>
          <LanguageSwitcher className="navMenu-language" />
        </dialog>
      )}
    </>
  );
}
