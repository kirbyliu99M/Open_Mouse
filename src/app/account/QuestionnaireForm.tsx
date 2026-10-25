"use client";

import { useId, useState } from "react";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { Presence } from "@/components/motion/Presence";
import {
  MAIN_USES,
  MAX_RATED_MICE,
  PAIN_POINTS,
  USE_DURATIONS,
} from "@/lib/contracts/survey";
import { accountCopy } from "@/lib/copy/account";
import { questionnaireCopy } from "@/lib/copy/questionnaire";
import {
  browserStorage,
  markSurveyAnswered,
} from "@/lib/results/surveyReminder";
import { MouseChoiceFlow } from "./MouseChoice";
import {
  CommentBox,
  RatingSheet,
  OtherMouseEditSheet,
} from "./MouseEditSheets";
import { ChipChoice, ChipMulti, SatisfactionField } from "./QuestionFields";
import { ProfileSheet } from "./ProfileEditSheets";
import { useLastTrigger } from "./modal";
import { brandName } from "./profile-model";
import {
  buildSubmission,
  canSubmit,
  emptyForm,
  emptyRatingDraft,
  extraSlotsLeft,
  failureLine,
  formSlugs,
  hasUnscoredMouse,
  otherTaken,
  togglePain,
  type CatalogueChoice,
  type FormState,
  type MouseChoice,
  type OtherDraft,
  type RatingDraft,
} from "./questionnaire-model";
import { postSurvey, type SurveyFailure } from "./survey-client";

/** What the form is showing on top of itself. */
type Overlay =
  | { kind: "pick-current" }
  | { kind: "pick-extra" }
  /** A new or existing extra mouse's rating; `fresh` is true until it is added. */
  | { kind: "extra-rating"; draft: RatingDraft; fresh: boolean }
  | { kind: "extra-other"; draft: OtherDraft; fresh: boolean };

function ChevronDown() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M6 9l6 6 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The first-time questionnaire 「我的滑鼠」 (frame QrV23, candidate), a full
 * screen native dialog over the page. Every question is optional but the
 * consent tick and one mouse the contract can take (a catalogue mouse with its
 * score, or a brand-only answer). It posts `surveySubmissionSchema` for the
 * scan it is given.
 *
 * After a success a signed-in person goes back to the list (`onSubmitted`,
 * which reads the answers again); a signed-out person sees a calm
 * confirmation, no way back, and this device is marked so the results page
 * stops showing the reminder dot.
 */
export function QuestionnaireForm({
  scanId,
  signedIn,
  catalogue,
  mouseNames,
  showModelField = false,
  initialForm,
  initialFailure,
  canEditInstead = false,
  onClose,
  onSubmitted,
  returnFocusTo,
}: {
  scanId: string;
  signedIn: boolean;
  catalogue: readonly CatalogueChoice[];
  /** Slug -> "Brand Model", for naming the mice in the form's rows. */
  mouseNames: Readonly<Record<string, string>>;
  /** Switch on 「型號（選填）」 once the contract carries it (not sent today). */
  showModelField?: boolean;
  /** The answers to start from (a static render in a test has no way to type them). */
  initialForm?: FormState;
  /** The failure to start from (a static render in a test cannot make one happen). */
  initialFailure?: SurveyFailure;
  /**
   * A signed-in person who already has mice to edit: only then is 「修改我的回答」
   * offered after a 409. With none, the edit has nothing to open, so the
   * line stands alone with a way to close.
   */
  canEditInstead?: boolean;
  onClose: () => void;
  /** A signed-in person's answers were stored: read them again and close. */
  onSubmitted: () => void;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const locale = useLocale();
  const copy = questionnaireCopy(locale);
  const account = accountCopy(locale);
  const [form, setForm] = useState<FormState>(() => initialForm ?? emptyForm());
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<SurveyFailure | null>(
    initialFailure ?? null,
  );
  const [done, setDone] = useState(false);
  const commentId = useId();
  const consentId = useId();
  const { last, onClickCapture } = useLastTrigger();
  const trigger = () => last.current;

  const nameOf = (slug: string) => mouseNames[slug] ?? slug;
  const left = extraSlotsLeft(form);
  const current = form.current;

  function update(patch: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
    setFailure(null);
  }

  function updateCurrentRating(patch: Partial<RatingDraft>) {
    if (current?.kind !== "rating") return;
    update({
      current: { kind: "rating", draft: { ...current.draft, ...patch } },
    });
  }

  /** The first question: a catalogue mouse or a brand-only answer becomes the current mouse. */
  function chooseCurrent(choice: MouseChoice) {
    setOverlay(null);
    if (choice.kind === "other") {
      update({
        current: { kind: "other", draft: choice.draft },
        // The body holds one brand-only answer: it is this one now.
        extraOther: null,
      });
      return;
    }
    const same =
      current?.kind === "rating" && current.draft.slug === choice.slug;
    if (same) return;
    // A mouse that was an extra moves up, with what was said about it.
    const fromExtra = form.extraRatings.find((r) => r.slug === choice.slug);
    update({
      current: {
        kind: "rating",
        draft: fromExtra ?? emptyRatingDraft(choice.slug),
      },
      extraRatings: form.extraRatings.filter((r) => r.slug !== choice.slug),
    });
  }

  /** 「加入另一支滑鼠」: open the sheet that writes it. Nothing is added until that sheet is saved. */
  function chooseExtra(choice: MouseChoice) {
    if (choice.kind === "other") {
      setOverlay({ kind: "extra-other", draft: choice.draft, fresh: true });
      return;
    }
    if (current?.kind === "rating" && current.draft.slug === choice.slug) {
      setOverlay(null);
      return;
    }
    const existing = form.extraRatings.find((r) => r.slug === choice.slug);
    setOverlay({
      kind: "extra-rating",
      draft: existing ?? emptyRatingDraft(choice.slug),
      fresh: existing === undefined,
    });
  }

  function saveExtraRating(draft: RatingDraft) {
    const exists = form.extraRatings.some((r) => r.slug === draft.slug);
    update({
      extraRatings: exists
        ? form.extraRatings.map((r) => (r.slug === draft.slug ? draft : r))
        : [...form.extraRatings, draft],
    });
    setOverlay(null);
  }

  async function submit() {
    const body = buildSubmission(form, scanId);
    if (body === null || sending) return;
    setSending(true);
    setFailure(null);
    const result = await postSurvey(body);
    setSending(false);
    if (result.ok) {
      if (signedIn) {
        onSubmitted();
        return;
      }
      markSurveyAnswered(browserStorage);
      setDone(true);
      return;
    }
    setFailure(result.reason);
  }

  const extraRows = [
    ...form.extraRatings.map((draft) => ({
      key: `rating:${draft.slug}`,
      name: nameOf(draft.slug),
      meta:
        draft.satisfaction === null
          ? ""
          : account.satisfaction(draft.satisfaction),
      open: () => setOverlay({ kind: "extra-rating", draft, fresh: false }),
      remove: () =>
        update({
          extraRatings: form.extraRatings.filter((r) => r.slug !== draft.slug),
        }),
    })),
    ...(form.extraOther === null
      ? []
      : [
          {
            key: "other",
            name: account.otherModel(brandName(form.extraOther.brand, account)),
            meta: account.sizeFeel(account.sizeFeels[form.extraOther.sizeFeel]),
            open: () =>
              setOverlay({
                kind: "extra-other",
                draft: form.extraOther as OtherDraft,
                fresh: false,
              }),
            remove: () => update({ extraOther: null }),
          },
        ]),
  ];

  if (done) {
    return (
      <ProfileSheet
        title={copy.doneTitle}
        variant="page"
        onClose={onClose}
        returnFocusTo={returnFocusTo}
      >
        <p className="qn-done">{copy.doneBody}</p>
        <button type="button" className="profile-primary" onClick={onClose}>
          {copy.doneClose}
        </button>
      </ProfileSheet>
    );
  }

  const currentName =
    current?.kind === "rating"
      ? nameOf(current.draft.slug)
      : current?.kind === "other"
        ? account.otherModel(brandName(current.draft.brand, account))
        : null;

  return (
    <>
      <ProfileSheet
        title={copy.title}
        variant="page"
        onClose={onClose}
        returnFocusTo={returnFocusTo}
        note={<p className="qn-subtitle">{copy.subtitle}</p>}
      >
        <div onClickCapture={onClickCapture}>
          <fieldset className="qn-q">
            <legend className="qn-legend">{copy.qCurrent}</legend>
            <p className="qn-hint">{copy.qCurrentHint}</p>
            <button
              type="button"
              className="qn-select-button"
              aria-haspopup="dialog"
              onClick={() => setOverlay({ kind: "pick-current" })}
            >
              <span className={currentName === null ? "qn-placeholder" : ""}>
                {currentName ?? copy.choosePlaceholder}
              </span>
              <ChevronDown />
            </button>
          </fieldset>

          {current?.kind === "rating" && (
            <>
              <SatisfactionField
                name="form-satisfaction"
                legend={copy.qSatisfaction}
                value={current.draft.satisfaction}
                optionLabel={copy.satisfactionOption}
                lowCaption={copy.satisfactionLow}
                highCaption={copy.satisfactionHigh}
                hint={
                  current.draft.satisfaction === null ? (
                    <p className="qn-hint qn-needed">
                      {copy.satisfactionNeeded}
                    </p>
                  ) : undefined
                }
                onChange={(score) =>
                  updateCurrentRating({ satisfaction: score })
                }
              />
              <ChipChoice
                legend={copy.qDuration}
                options={USE_DURATIONS.map((value) => ({
                  value,
                  label: account.durations[value],
                }))}
                selected={current.draft.duration}
                onSelect={(duration) => updateCurrentRating({ duration })}
              />
              <ChipMulti
                legend={copy.qPain}
                options={PAIN_POINTS.map((value) => ({
                  value,
                  label: copy.pain[value],
                }))}
                selected={current.draft.painPoints}
                onToggle={(point) =>
                  updateCurrentRating({
                    painPoints: togglePain(
                      current.draft.painPoints,
                      point,
                      PAIN_POINTS,
                    ),
                  })
                }
              />
            </>
          )}

          <ChipChoice
            legend={copy.qMainUse}
            options={MAIN_USES.map((value) => ({
              value,
              label: copy.mainUses[value],
            }))}
            selected={form.mainUse}
            columns={3}
            onSelect={(mainUse) => update({ mainUse })}
          />

          <fieldset className="qn-q">
            <legend className="qn-legend">{copy.qOthers}</legend>
            <p id={`${consentId}-others`} className="qn-hint">
              {left > 0
                ? copy.othersHint(Math.min(left, MAX_RATED_MICE - 1))
                : copy.othersFull(MAX_RATED_MICE)}
            </p>
            {extraRows.length > 0 && (
              <ul className="profile-rows qn-extra-rows">
                {extraRows.map((row) => (
                  <li key={row.key} className="qn-extra">
                    <button
                      type="button"
                      className="profile-row profile-row-button profile-mouse"
                      onClick={row.open}
                    >
                      <span className="profile-mouse-text">
                        <span className="profile-mouse-name">{row.name}</span>
                        {row.meta !== "" && (
                          <span className="profile-mouse-meta">{row.meta}</span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="qn-extra-remove"
                      aria-label={copy.removeExtra(row.name)}
                      onClick={row.remove}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path
                          d="M7 7l10 10M17 7L7 17"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="profile-row profile-text-button profile-add"
              aria-haspopup="dialog"
              aria-describedby={`${consentId}-others`}
              disabled={left === 0}
              onClick={() => setOverlay({ kind: "pick-extra" })}
            >
              <PlusIcon />
              {copy.addMouse}
            </button>
          </fieldset>

          <div className="qn-q">
            <label className="qn-legend" htmlFor={commentId}>
              {copy.qComment}
            </label>
            <CommentBox
              id={commentId}
              value={form.feedback}
              onChange={(feedback) => update({ feedback })}
            />
          </div>

          <div className="qn-consent">
            <label className="qn-consent-label" htmlFor={consentId}>
              <input
                id={consentId}
                type="checkbox"
                checked={form.consent}
                aria-describedby={`${consentId}-text`}
                onChange={(event) => update({ consent: event.target.checked })}
              />
              <span>{copy.consentLabel}</span>
            </label>
            <div id={`${consentId}-text`} className="qn-consent-text">
              <p>{copy.consentKept}</p>
              <p>{copy.consentNotKept}</p>
              <p>{copy.consentWithdraw}</p>
            </div>
          </div>

          {failure !== null && (
            <div className="qn-failure" role="status">
              <p className="status-error">{failureLine(failure, copy)}</p>
              {failure === "conflict" && (
                <button
                  type="button"
                  className="button-secondary qn-failure-action"
                  onClick={signedIn && canEditInstead ? onSubmitted : onClose}
                >
                  {signedIn && canEditInstead ? copy.editInstead : copy.close}
                </button>
              )}
            </div>
          )}

          {hasUnscoredMouse(form) && (
            <p className="qn-hint qn-needed" role="status">
              {copy.satisfactionNeeded}
            </p>
          )}
          <button
            type="button"
            className="profile-primary qn-submit"
            disabled={!canSubmit(form) || sending}
            onClick={() => void submit()}
          >
            {sending ? copy.submitting : copy.submit}
          </button>
        </div>
      </ProfileSheet>

      {/* Each sheet slides down before it unmounts (V3.2 motion pass #28). */}
      <Presence kind="sheet">
        {overlay?.kind === "pick-current" && (
          <MouseChoiceFlow
            catalogue={catalogue}
            chosenSlugs={formSlugs(form)}
            allowOther={!otherTaken(form, "current")}
            showModelField={showModelField}
            initialOther={current?.kind === "other" ? current.draft : undefined}
            onChoose={chooseCurrent}
            onClose={() => setOverlay(null)}
            returnFocusTo={trigger}
          />
        )}
      </Presence>
      <Presence kind="sheet">
        {overlay?.kind === "pick-extra" && (
          <MouseChoiceFlow
            catalogue={catalogue}
            chosenSlugs={formSlugs(form)}
            allowOther={!otherTaken(form, "extra")}
            showModelField={showModelField}
            onChoose={chooseExtra}
            onClose={() => setOverlay(null)}
            returnFocusTo={trigger}
          />
        )}
      </Presence>
      <Presence kind="sheet">
        {overlay?.kind === "extra-rating" && (
          <RatingSheet
            title={nameOf(overlay.draft.slug)}
            initial={overlay.draft}
            initialCurrent={false}
            showCurrent={false}
            working={false}
            line={null}
            onSave={(draft) => saveExtraRating(draft)}
            onRemove={
              overlay.fresh
                ? undefined
                : () => {
                    update({
                      extraRatings: form.extraRatings.filter(
                        (r) => r.slug !== overlay.draft.slug,
                      ),
                    });
                    setOverlay(null);
                  }
            }
            onClose={() => setOverlay(null)}
            returnFocusTo={trigger}
          />
        )}
      </Presence>
      <Presence kind="sheet">
        {overlay?.kind === "extra-other" && (
          <OtherMouseEditSheet
            title={copy.otherEditTitle(brandName(overlay.draft.brand, account))}
            initialSizeFeel={overlay.draft.sizeFeel}
            initialCurrent={false}
            showCurrent={false}
            working={false}
            line={null}
            onSave={(sizeFeel) => {
              update({ extraOther: { ...overlay.draft, sizeFeel } });
              setOverlay(null);
            }}
            onRemove={
              overlay.fresh
                ? undefined
                : () => {
                    update({ extraOther: null });
                    setOverlay(null);
                  }
            }
            onClose={() => setOverlay(null)}
            returnFocusTo={trigger}
          />
        )}
      </Presence>
    </>
  );
}
