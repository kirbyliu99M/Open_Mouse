"use client";

/**
 * v3.4 (candidate 未拍板; review items 5+6, Pencil export
 * scan-tutorial-2026-11-04/v3/card-reference-menu.png): with the card flag
 * ON, the reference chip opens a small menu above it: A4 紙 / Letter 紙 /
 * 卡片, each a direct choice. It replaces the A4 → Letter → card cycle, in
 * which a Letter user's one tap back to A4 went through the card (a loop
 * reset and, on iOS, the motion-sensor question). With the flag OFF this
 * component is not used: the chip is main's A4 ↔ Letter toggle.
 *
 * Keyboard: Enter / Space on the chip opens it with focus on the current
 * choice; ↑ ↓ Home End move; Enter / Space choose; Esc closes and gives focus
 * back to the chip; Tab or a tap outside closes. Every row is ≥ 44 px.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { CardReferenceCopy } from "../../lib/copy/card-reference";
import { referenceChoices, type ScanReference } from "./easyScanPreferences";
import { CheckIcon } from "./icons";

/** What a key does inside the open menu (pure, tested). */
export type ReferenceMenuKeyAction =
  | { readonly kind: "focus"; readonly index: number }
  | { readonly kind: "close"; readonly refocusChip: boolean }
  | null;

export function referenceMenuKey(
  key: string,
  index: number,
  count: number,
): ReferenceMenuKeyAction {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return { kind: "focus", index: (index + 1) % count };
    case "ArrowUp":
      return { kind: "focus", index: (index - 1 + count) % count };
    case "Home":
      return { kind: "focus", index: 0 };
    case "End":
      return { kind: "focus", index: count - 1 };
    case "Escape":
      return { kind: "close", refocusChip: true };
    case "Tab":
      return { kind: "close", refocusChip: false };
    default:
      return null;
  }
}

export interface ReferenceMenuProps {
  /** The reference in use. */
  readonly current: ScanReference;
  /** The chip's visible label (A4, Letter or 卡片). */
  readonly label: string;
  readonly copy: CardReferenceCopy;
  /** No change while a shot is taken or measured (review item 13). */
  readonly disabled: boolean;
  readonly onSelect: (reference: ScanReference) => void;
  /** Starts open (static rendering in tests only). */
  readonly initialOpen?: boolean;
}

export function ReferenceMenu({
  current,
  label,
  copy,
  disabled,
  onSelect,
  initialOpen = false,
}: ReferenceMenuProps) {
  const [open, setOpen] = useState(initialOpen);
  const wrapRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const titleId = useId();
  const choices = referenceChoices(true);
  const currentIndex = Math.max(0, choices.indexOf(current));

  const close = (refocusChip: boolean) => {
    setOpen(false);
    if (refocusChip) chipRef.current?.focus();
  };

  // Opened: focus on the current choice; a tap anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[currentIndex]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
    // Only on opening: moving with the arrows must not jump back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A shot started (the auto-shutter): the menu goes with the chip's use.
  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const names: Record<ScanReference, { name: string; detail: string }> = {
    a4: { name: copy.menuA4, detail: copy.menuA4Detail },
    letter: { name: copy.menuLetter, detail: copy.menuLetterDetail },
    card: { name: copy.menuCard, detail: copy.menuCardDetail },
  };

  return (
    <div
      className="easyReferenceMenuWrap"
      ref={wrapRef}
      onKeyDown={(event) => {
        if (!open) return;
        const at = itemRefs.current.findIndex(
          (el) => el !== null && el === document.activeElement,
        );
        const action = referenceMenuKey(
          event.key,
          at < 0 ? currentIndex : at,
          choices.length,
        );
        if (!action) return;
        if (action.kind === "focus") {
          event.preventDefault();
          itemRefs.current[action.index]?.focus();
        } else {
          if (action.refocusChip) event.preventDefault();
          close(action.refocusChip);
        }
      }}
    >
      {open && (
        <div className="easyReferenceMenu" data-testid="reference-menu">
          <p id={titleId} className="easyReferenceMenuTitle">
            {copy.menuTitle}
          </p>
          <div id={menuId} role="menu" aria-labelledby={titleId}>
            {choices.map((reference, i) => {
              const checked = reference === current;
              return (
                <button
                  key={reference}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  tabIndex={checked ? 0 : -1}
                  className={`easyReferenceMenuItem${checked ? " on" : ""}`}
                  data-reference={reference}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  onClick={() => {
                    close(true);
                    if (!checked) onSelect(reference);
                  }}
                >
                  <span className="easyReferenceMenuText">
                    <span className="easyReferenceMenuName">
                      {names[reference].name}
                    </span>
                    <span className="easyReferenceMenuDetail">
                      {names[reference].detail}
                    </span>
                  </span>
                  {checked && (
                    <CheckIcon
                      width={18}
                      height={18}
                      className="easyReferenceMenuCheck"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <button
        type="button"
        ref={chipRef}
        className="easyPaperToggle"
        data-tour="reference-chip"
        aria-label={copy.chipAccessibleName(label)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
    </div>
  );
}
