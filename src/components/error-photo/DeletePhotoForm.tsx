"use client";

import { useId, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/contracts/locale";
import { DELETE_PHOTO_ANCHOR, errorPhotoCopy } from "@/lib/copy/error-photo";
import {
  deleteErrorPhoto,
  type DeleteOutcome,
} from "@/client/error-photo/send";
import "./error-photo.css";

/**
 * "Delete a photo I sent" (candidate 未拍板): the deletion code from the
 * error-photo sheet, typed here, deletes that photo at once
 * (`POST /api/error-photos/delete`). Mounted on /privacy below the policy,
 * at `#delete-photo`, only while `ERROR_PHOTO_ENABLED`. The code is checked
 * against its format before anything is sent, and is never stored or logged.
 */
export function DeletePhotoForm({ locale }: { readonly locale: Locale }) {
  const copy = errorPhotoCopy(locale);
  const inputId = useId();
  const statusId = useId();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<DeleteOutcome | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setOutcome(null);
    const result = await deleteErrorPhoto(code);
    setBusy(false);
    setOutcome(result);
    if (result === "deleted") setCode("");
  }

  const message =
    outcome === null
      ? busy
        ? copy.deleting
        : ""
      : {
          deleted: copy.deleteDone,
          "not-found": copy.deleteNotFound,
          invalid: copy.deleteInvalid,
          "too-many": copy.deleteTooMany,
          failed: copy.deleteFailed,
        }[outcome];

  return (
    <section
      id={DELETE_PHOTO_ANCHOR}
      className="errorPhotoDelete"
      aria-labelledby={`${inputId}-title`}
    >
      <h2 id={`${inputId}-title`}>{copy.deleteTitle}</h2>
      <p>{copy.deleteIntro}</p>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <label htmlFor={inputId}>{copy.deleteLabel}</label>
        <div className="errorPhotoDeleteRow">
          <input
            id={inputId}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={20}
            aria-describedby={statusId}
            aria-invalid={outcome === "invalid" || undefined}
            disabled={busy}
          />
          <button type="submit" className="errorPhotoPrimary" disabled={busy}>
            {busy ? copy.deleting : copy.deleteButton}
          </button>
        </div>
        <p
          id={statusId}
          className={
            outcome === null || outcome === "deleted"
              ? "errorPhotoDeleteStatus"
              : "errorPhotoDeleteStatus errorPhotoError"
          }
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      </form>
    </section>
  );
}
