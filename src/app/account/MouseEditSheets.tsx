"use client";

import { useId, useRef, useState, type RefObject } from "react";
import { useLocale } from "@/client/i18n/LocaleProvider";
import {
  MAIN_USES,
  MAX_FEEDBACK_CHARS,
  PAIN_POINTS,
  SIZE_FEELS,
  USE_DURATIONS,
  type MainUse,
  type SizeFeel,
} from "@/lib/contracts/survey";
import { accountCopy } from "@/lib/copy/account";
import { questionnaireCopy } from "@/lib/copy/questionnaire";
import { ChipChoice, ChipMulti, SatisfactionField } from "./QuestionFields";
import { ProfileSheet } from "./ProfileEditSheets";
import { useModalDialog } from "./modal";
import {
  feedbackLength,
  togglePain,
  type RatingDraft,
} from "./questionnaire-model";

/**
 * The sheets that edit what is already kept, and the confirmation before a
 * mouse's answers are removed (frames CFbGl, LHhIs and gDxD7, candidate). They
 * hold a draft and hand it back; building the body and calling `PUT` belong to
 * the parent (`AccountClient`), which knows the whole set.
 */

interface SaveFooterProps {
  working: boolean;
  disabled: boolean;
  /** A line above the button: a failed call, or the over-the-cap line. */
  line: string | null;
  onSave: () => void;
}

/** The pinned footer: a line when there is something to say, and 「儲存」. */
function SaveFooter({ working, disabled, line, onSave }: SaveFooterProps) {
  const copy = accountCopy(useLocale());
  return (
    <>
      {line !== null && (
        <p className="status-error qn-footer-line" role="status">
          {line}
        </p>
      )}
      <button
        type="button"
        className="profile-primary"
        disabled={disabled || working}
        onClick={onSave}
      >
        {working ? copy.saving : copy.save}
      </button>
    </>
  );
}

/** A switch row: a real checkbox with `role="switch"`, so its state is spoken. */
function SwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="qn-switch-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="qn-switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}

/** The red text row 「移除這支滑鼠」. */
function RemoveRow({
  label,
  onClick,
}: {
  label: string;
  onClick: (opener: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className="qn-remove-row"
      onClick={(event) => onClick(event.currentTarget)}
    >
      {label}
    </button>
  );
}

/**
 * One catalogue mouse's rating: satisfaction, use time, what does not fit, and
 * whether it is the one the person uses now. `showCurrent` is off in the
 * first-time form, where the first question already says which mouse is the
 * current one. 「儲存」 stays off until there is a score.
 */
export function RatingSheet({
  title,
  initial,
  initialCurrent,
  showCurrent,
  working,
  line,
  blocked = false,
  onSave,
  onRemove,
  onClose,
  returnFocusTo,
}: {
  title: string;
  initial: RatingDraft;
  initialCurrent: boolean;
  showCurrent: boolean;
  working: boolean;
  line: string | null;
  /** The save would put the set over the account's cap: Save stays off. */
  blocked?: boolean;
  onSave: (draft: RatingDraft, current: boolean) => void;
  /** Left out when the mouse cannot be removed (the last one, or one not yet added). Gets the button, so the confirmation can give focus back to it. */
  onRemove?: (opener: HTMLElement) => void;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const locale = useLocale();
  const copy = questionnaireCopy(locale);
  const account = accountCopy(locale);
  const [draft, setDraft] = useState(initial);
  const [current, setCurrent] = useState(initialCurrent);

  return (
    <ProfileSheet
      title={title}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      note={<p className="qn-sheet-note">{copy.editNote}</p>}
      footer={
        <SaveFooter
          working={working}
          disabled={draft.satisfaction === null || blocked}
          line={line}
          onSave={() => onSave(draft, current)}
        />
      }
    >
      <SatisfactionField
        name="sheet-satisfaction"
        legend={copy.satisfactionLegend}
        value={draft.satisfaction}
        optionLabel={copy.satisfactionOption}
        lowCaption={copy.satisfactionLow}
        highCaption={copy.satisfactionHigh}
        onChange={(score) => setDraft({ ...draft, satisfaction: score })}
      />
      <ChipChoice
        legend={copy.qDuration}
        options={USE_DURATIONS.map((value) => ({
          value,
          label: account.durations[value],
        }))}
        selected={draft.duration}
        onSelect={(duration) => setDraft({ ...draft, duration })}
      />
      <ChipMulti
        legend={copy.qPain}
        options={PAIN_POINTS.map((value) => ({
          value,
          label: copy.pain[value],
        }))}
        selected={draft.painPoints}
        onToggle={(point) =>
          setDraft({
            ...draft,
            painPoints: togglePain(draft.painPoints, point, PAIN_POINTS),
          })
        }
      />
      {showCurrent && (
        <SwitchRow
          label={copy.isCurrent}
          checked={current}
          onChange={setCurrent}
        />
      )}
      {onRemove && <RemoveRow label={copy.removeMouse} onClick={onRemove} />}
    </ProfileSheet>
  );
}

/** The edit sheet of a mouse that is not in the catalogue: its size feel, and whether it is the current one. */
export function OtherMouseEditSheet({
  title,
  initialSizeFeel,
  initialCurrent,
  showCurrent = true,
  working,
  line,
  blocked = false,
  onSave,
  onRemove,
  onClose,
  returnFocusTo,
}: {
  title: string;
  initialSizeFeel: SizeFeel;
  initialCurrent: boolean;
  /** Off in the first-time form, where the first question names the current mouse. */
  showCurrent?: boolean;
  working: boolean;
  line: string | null;
  onSave: (sizeFeel: SizeFeel, current: boolean) => void;
  onRemove?: (opener: HTMLElement) => void;
  /** The save would put the set over the account's cap: Save stays off. */
  blocked?: boolean;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const copy = questionnaireCopy(useLocale());
  const [sizeFeel, setSizeFeel] = useState(initialSizeFeel);
  const [current, setCurrent] = useState(initialCurrent);
  return (
    <ProfileSheet
      title={title}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      note={<p className="qn-sheet-note">{copy.editNote}</p>}
      footer={
        <SaveFooter
          working={working}
          disabled={blocked}
          line={line}
          onSave={() => onSave(sizeFeel, current)}
        />
      }
    >
      <ChipChoice
        legend={copy.sizeFeelLabel}
        options={SIZE_FEELS.map((value) => ({
          value,
          label: copy.sizeFeels[value],
        }))}
        selected={sizeFeel}
        allowClear={false}
        columns={3}
        onSelect={(value) => value !== null && setSizeFeel(value)}
      />
      {showCurrent && (
        <SwitchRow
          label={copy.isCurrent}
          checked={current}
          onChange={setCurrent}
        />
      )}
      {onRemove && <RemoveRow label={copy.removeMouse} onClick={onRemove} />}
    </ProfileSheet>
  );
}

/** The sheet of one of 其他回答: the main use, or the comment. */
export function OtherAnswerSheet({
  field,
  initialMainUse,
  initialFeedback,
  working,
  line,
  blocked = false,
  onSave,
  onClose,
  returnFocusTo,
}: {
  field: "mainUse" | "feedback";
  initialMainUse: MainUse | null;
  initialFeedback: string;
  working: boolean;
  line: string | null;
  blocked?: boolean;
  onSave: (value: { mainUse: MainUse | null; feedback: string }) => void;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const copy = questionnaireCopy(useLocale());
  const [mainUse, setMainUse] = useState(initialMainUse);
  const [feedback, setFeedback] = useState(initialFeedback);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const areaId = useId();
  return (
    <ProfileSheet
      title={field === "mainUse" ? copy.mainUseTitle : copy.feedbackTitle}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      initialFocus={field === "feedback" ? areaRef : undefined}
      footer={
        <SaveFooter
          working={working}
          disabled={blocked}
          line={line}
          onSave={() => onSave({ mainUse, feedback })}
        />
      }
    >
      {field === "mainUse" ? (
        <ChipChoice
          legend={copy.qMainUse}
          options={MAIN_USES.map((value) => ({
            value,
            label: copy.mainUses[value],
          }))}
          selected={mainUse}
          columns={3}
          onSelect={setMainUse}
        />
      ) : (
        <div className="qn-q">
          <label className="qn-legend" htmlFor={areaId}>
            {copy.qComment}
          </label>
          <CommentBox
            id={areaId}
            areaRef={areaRef}
            value={feedback}
            onChange={setFeedback}
          />
          <p className="qn-hint">{copy.feedbackNote}</p>
        </div>
      )}
    </ProfileSheet>
  );
}

/** The comment box and its counter (used by the form and the comment sheet). */
export function CommentBox({
  id,
  value,
  onChange,
  areaRef,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  areaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const copy = questionnaireCopy(useLocale());
  return (
    <div className="qn-comment">
      <textarea
        ref={areaRef}
        id={id}
        value={value}
        rows={4}
        maxLength={MAX_FEEDBACK_CHARS}
        placeholder={copy.commentPlaceholder}
        aria-describedby={`${id}-count`}
        onChange={(event) => onChange(event.target.value)}
      />
      <span id={`${id}-count`} className="qn-comment-count">
        {copy.commentCount(feedbackLength(value), MAX_FEEDBACK_CHARS)}
      </span>
    </div>
  );
}

/**
 * The confirmation before one mouse's answers are removed (frame gDxD7): a
 * bottom action sheet, default focus on 「取消」 (so Enter never removes), and
 * a focus ring only for keyboard focus. Esc and the backdrop close it.
 */
export function RemoveConfirm({
  name,
  working,
  line,
  onConfirm,
  onClose,
  returnFocusTo,
}: {
  name: string;
  working: boolean;
  line: string | null;
  onConfirm: () => void;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const locale = useLocale();
  const copy = questionnaireCopy(locale);
  const account = accountCopy(locale);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  // Focus starts on 「取消」, so Enter never removes.
  const modal = useModalDialog({
    onClose,
    initialFocus: cancelRef,
    returnFocusTo,
  });

  return (
    <dialog
      ref={modal.dialogRef}
      className="qn-confirm"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onClose={modal.onClose}
      onCancel={modal.onCancel}
      onClick={(event) => {
        // A tap on the backdrop (the dialog element itself) cancels.
        if (event.target === modal.dialogRef.current) onClose();
      }}
    >
      <div className="qn-confirm-card">
        <h2 id={titleId}>{copy.removeTitle}</h2>
        <p id={bodyId}>{copy.removeBody(name)}</p>
        {line !== null && (
          <p className="status-error" role="status">
            {line}
          </p>
        )}
        <button
          type="button"
          className="qn-confirm-remove"
          disabled={working}
          onClick={onConfirm}
        >
          {working ? copy.removing : copy.removeConfirm}
        </button>
      </div>
      <button
        ref={cancelRef}
        type="button"
        className="qn-confirm-cancel"
        onClick={onClose}
      >
        {account.cancel}
      </button>
    </dialog>
  );
}
