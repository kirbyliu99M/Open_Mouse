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
 * and Escape-to-close for free. A tap on the dimmed page beside it closes it
 * too (`useBlankTap`, Kirby 2026-10-26, candidate / 未拍板).
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { useBlankTap } from "@/components/dialog/useBlankTap";
import { usePresence } from "@/components/motion/Presence";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { navCopy } from "@/lib/copy/nav";
import { UnansweredMarker } from "./UnansweredMarker";
import "./nav-menu.css";
import { localizedPath } from "@/lib/i18n/localePath";

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
  const locale = useLocale();
  const copy = navCopy(locale);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Closing slides the menu back out to the right (V3.2 motion pass #14): it
  // stays open for leaveMs("sheet") after `open` turns false, and only then
  // closes and gives focus back to the trigger.
  const menu = usePresence(open, "sheet");
  const blankTap = useBlankTap(() => setOpen(false), {
    panel: "self",
    enabled: !menu.leaving,
  });

  useEffect(() => {
    if (!menu.mounted) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    dialog?.showModal();
    closeRef.current?.focus();
    return () => {
      dialog?.close();
      trigger?.focus();
    };
  }, [menu.mounted]);

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
      {menu.mounted && (
        <dialog
          ref={dialogRef}
          className="navMenu"
          aria-label={copy.menuDialogLabel}
          data-leaving={menu.leaving ? "true" : undefined}
          inert={menu.leaving}
          aria-hidden={menu.leaving ? true : undefined}
          onClose={() => setOpen(false)}
          {...blankTap}
          onCancel={(event) => {
            // Esc: slide out like the close button, not the browser's
            // instant close.
            event.preventDefault();
            setOpen(false);
          }}
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
                <Link
                  href={localizedPath("/", locale)}
                  onClick={() => setOpen(false)}
                >
                  {copy.home}
                </Link>
              </li>
              <li>
                <Link
                  href={localizedPath("/scan/easy", locale)}
                  onClick={() => setOpen(false)}
                >
                  {copy.scanMyHand}
                </Link>
              </li>
              <li>
                <Link
                  href={localizedPath("/how-it-works", locale)}
                  onClick={() => setOpen(false)}
                >
                  {copy.howItWorks}
                </Link>
              </li>
              <li>
                <Link
                  href={localizedPath("/account", locale)}
                  onClick={() => setOpen(false)}
                >
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
