"use client";

/**
 * The nickname sheet and the avatar sheet of the profile page (Pencil frames
 * S4XQz0 and wyYy5, candidate). They are NOT WIRED: no route saves a nickname
 * or an avatar yet (an owner-only route that updates `users.name` and
 * `users.image` needs a contract written first, and where the picture is kept
 * is not decided). The sheets are built behind the `editing` prop:
 *   - with `editing` given, Save calls it;
 *   - without it, the sheet still opens and works locally (typing, choosing and
 *     cropping a photo), says "這項修改還不能儲存。" and keeps Save off.
 * An avatar is cropped to a square and shrunk in the browser before it is
 * handed to `saveAvatar`; nothing in this file sends it anywhere. The promise
 * that photos never leave the browser is about HAND photos (Kirby,
 * 2026-10-12), not about an avatar.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { reducedMotionNow, useLeaving } from "@/components/motion/Presence";
import { cardMotion, TOGGLE_MOTION } from "@/lib/results/shapeToggle";
import { Avatar } from "@/components/nav/Avatar";
import { accountCopy } from "@/lib/copy/account";
import { cropToSquareBlob } from "./avatar-crop";
import { useModalDialog } from "./modal";
import { NICKNAME_MAX, canSaveNickname, nicknameLength } from "./profile-model";

/** What saving a profile change does, once a route exists. */
export interface ProfileEditing {
  /** Saves the nickname; resolves with the name as stored. */
  saveNickname: (name: string) => Promise<{ name: string }>;
  /** Saves the cropped, shrunk picture; resolves with the new image URL. */
  saveAvatar: (picture: Blob) => Promise<{ image: string | null }>;
  /** Goes back to the Google picture; resolves with its URL. */
  resetAvatar: () => Promise<{ image: string | null }>;
}

type SaveStatus = "idle" | "saving" | "error";

/**
 * A bottom sheet on a native `<dialog>`: focus is trapped, Esc and Cancel close
 * it, and focus goes back to the control that opened it. Also the frame of the
 * questionnaire's sheets (Builder Q):
 *   - `footer` pins a button row under a body that scrolls, with a fade above it
 *     that says there is more (frame LHhIs);
 *   - `note` is a line under the title that stays put while the body scrolls;
 *   - `variant` "tall" fills most of the screen (the mouse picker), "page" fills
 *     all of it (the form), with no handle;
 *   - `returnFocusTo` names the control to focus on close (default: whatever had
 *     focus when the sheet opened);
 *   - `swapKey` / `swapDir`: one sheet showing steps (the mouse picker's list
 *     and 「其他」, V3.2 motion pass #11). A new key swaps the content in the
 *     same dialog: it comes in from the side of the step it goes to (`swapDir`
 *     1 from the right, -1 from the left) over --motion-base, and focus goes
 *     to the first control, where a newly opened dialog would put it.
 * Without any of these it is the plain sheet of the nickname and avatar.
 */
export function ProfileSheet({
  title,
  onClose,
  initialFocus,
  children,
  footer,
  note,
  variant = "sheet",
  returnFocusTo,
  labelledBy,
  swapKey,
  swapDir = 0,
}: {
  title: string;
  onClose: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
  footer?: ReactNode;
  note?: ReactNode;
  variant?: "sheet" | "tall" | "page";
  returnFocusTo?: () => HTMLElement | null;
  /** Overrides the title as the dialog's accessible name. */
  labelledBy?: string;
  /** The step shown; a change swaps the content in place (see above). */
  swapKey?: string;
  /** Where the new step comes in from: 1 the right, -1 the left. */
  swapDir?: -1 | 0 | 1;
}) {
  const copy = accountCopy(useLocale());
  const titleId = useId();
  const modal = useModalDialog({ onClose, initialFocus, returnFocusTo });
  // Its owner keeps it for the slide down (`<Presence kind="sheet">`).
  const leaving = useLeaving();

  // A new step: its content comes in, before it is painted.
  const shownKey = useRef(swapKey);
  useLayoutEffect(() => {
    if (shownKey.current === swapKey) return;
    shownKey.current = swapKey;
    const dialog = modal.dialogRef.current;
    if (!dialog) return;
    const m = cardMotion(swapDir, reducedMotionNow());
    for (const part of Array.from(dialog.children)) {
      if (!(part instanceof HTMLElement) || typeof part.animate !== "function")
        continue;
      part.animate(
        [
          { opacity: 0, transform: `translateX(${m.inFromPx}px)` },
          { opacity: 1, transform: "translateX(0)" },
        ],
        { duration: m.inMs, easing: TOGGLE_MOTION.EASE_OUT },
      );
    }
    // The control that was pressed has gone with the old step.
    dialog
      .querySelector<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
      )
      ?.focus();
  }, [swapKey, swapDir, modal.dialogRef]);

  const pinned = footer !== undefined;
  return (
    <dialog
      ref={modal.dialogRef}
      className={`profile-sheet profile-sheet-${variant}${
        pinned ? " profile-sheet-pinned" : ""
      }`}
      data-leaving={leaving ? "true" : undefined}
      // Leaving: 儲存 and the rest can not be pressed again during the slide.
      inert={leaving}
      aria-hidden={leaving ? true : undefined}
      aria-labelledby={labelledBy ?? titleId}
      onClose={modal.onClose}
      onCancel={modal.onCancel}
    >
      <div className="profile-sheet-head">
        {variant !== "page" && (
          <span className="profile-sheet-handle" aria-hidden="true" />
        )}
        <button
          type="button"
          className="button-secondary profile-sheet-cancel"
          onClick={onClose}
        >
          {copy.cancel}
        </button>
        <h2 id={titleId} className="profile-sheet-title">
          {title}
        </h2>
        {note !== undefined && note}
      </div>
      {pinned ? (
        <>
          <div className="profile-sheet-body">{children}</div>
          <div className="profile-sheet-footer">{footer}</div>
        </>
      ) : (
        children
      )}
    </dialog>
  );
}

export function NicknameSheet({
  saved,
  editing,
  onClose,
  onSaved,
}: {
  saved: string;
  editing?: ProfileEditing;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const copy = accountCopy(useLocale());
  const [draft, setDraft] = useState(saved);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const length = nicknameLength(draft);
  const canSave =
    editing !== undefined &&
    status !== "saving" &&
    canSaveNickname(draft, saved);

  async function save() {
    if (!editing || !canSave) return;
    setStatus("saving");
    try {
      const result = await editing.saveNickname(draft.trim());
      onSaved(result.name);
      onClose();
    } catch {
      setStatus("error");
    }
  }

  return (
    <ProfileSheet
      title={copy.nicknameTitle}
      onClose={onClose}
      initialFocus={inputRef}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="profile-sr-only" htmlFor={inputId}>
          {copy.nicknameLabel}
        </label>
        <div className="profile-field">
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={draft}
            autoComplete="nickname"
            // Counts UTF-16 units, so an emoji uses two; the count under the
            // field (in characters) is what decides Save.
            maxLength={NICKNAME_MAX}
            aria-describedby={`${inputId}-count`}
            aria-invalid={length > NICKNAME_MAX}
            onChange={(event) => {
              setDraft(event.target.value);
              setStatus("idle");
            }}
          />
          {draft !== "" && (
            <button
              type="button"
              className="profile-field-clear"
              aria-label={copy.nicknameClear}
              onClick={() => {
                setDraft("");
                inputRef.current?.focus();
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M9 9l6 6M15 9l-6 6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
        <p id={`${inputId}-count`} className="profile-field-count">
          {copy.nicknameCount(length, NICKNAME_MAX)}
        </p>
        <SheetStatus editing={editing} status={status} />
        <button
          type="submit"
          className="profile-primary profile-sheet-save"
          disabled={!canSave}
        >
          {status === "saving" ? copy.saving : copy.save}
        </button>
      </form>
    </ProfileSheet>
  );
}

export function AvatarSheet({
  image,
  editing,
  onClose,
  onSaved,
}: {
  image: string | null;
  editing?: ProfileEditing;
  onClose: () => void;
  onSaved: (image: string | null) => void;
}) {
  const copy = accountCopy(useLocale());
  const [picture, setPicture] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [readError, setReadError] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const fileRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setReadError(false);
    setStatus("idle");
    try {
      const cropped = await cropToSquareBlob(file);
      setPicture(cropped);
      setPreviewUrl(URL.createObjectURL(cropped));
    } catch {
      setReadError(true);
    }
  }

  const busy = status === "saving";
  const canSave = editing !== undefined && picture !== null && !busy;

  async function run(action: () => Promise<{ image: string | null }>) {
    setStatus("saving");
    try {
      const result = await action();
      onSaved(result.image);
      onClose();
    } catch {
      setStatus("error");
    }
  }

  return (
    <ProfileSheet
      title={copy.avatarTitle}
      onClose={onClose}
      initialFocus={chooseRef}
    >
      <div className="profile-avatar-preview">
        <Avatar
          className="avatar profile-avatar-xl"
          image={previewUrl ?? image}
        />
        <span className="profile-avatar-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path
              d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
            <circle
              cx="12"
              cy="13"
              r="3.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            />
          </svg>
        </span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="profile-sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          void onFile(event.target.files?.[0]);
          // The same file can be chosen again.
          event.target.value = "";
        }}
      />
      <button
        ref={chooseRef}
        type="button"
        className="profile-outline"
        onClick={() => fileRef.current?.click()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect
            x="3.5"
            y="4.5"
            width="17"
            height="15"
            rx="2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <circle cx="9" cy="10" r="1.6" fill="currentColor" />
          <path
            d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
        {copy.choosePhoto}
      </button>
      <button
        type="button"
        className="button-secondary profile-sheet-reset"
        disabled={editing === undefined || busy}
        onClick={() => editing && void run(() => editing.resetAvatar())}
      >
        {copy.useGoogleAvatar}
      </button>
      <p className="profile-sheet-note">{copy.avatarNote}</p>
      {readError && (
        <p className="status-error" role="status">
          {copy.avatarReadError}
        </p>
      )}
      <SheetStatus editing={editing} status={status} />
      <button
        type="button"
        className="profile-primary profile-sheet-save"
        disabled={!canSave}
        onClick={() =>
          picture && editing && void run(() => editing.saveAvatar(picture))
        }
      >
        {busy ? copy.saving : copy.save}
      </button>
    </ProfileSheet>
  );
}

/** The sheet's status line: why Save is off, or what went wrong. */
function SheetStatus({
  editing,
  status,
}: {
  editing?: ProfileEditing;
  status: SaveStatus;
}) {
  const copy = accountCopy(useLocale());
  if (status === "error") {
    return (
      <p className="status-error" role="status">
        {copy.saveError}
      </p>
    );
  }
  if (editing === undefined) {
    return (
      <p className="profile-sheet-note" role="status">
        {copy.notWired}
      </p>
    );
  }
  return null;
}
