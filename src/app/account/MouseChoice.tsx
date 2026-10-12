"use client";

import { useId, useMemo, useState } from "react";
import { useLocale } from "@/client/i18n/LocaleProvider";
import {
  OTHER_MOUSE_BRANDS,
  SIZE_FEELS,
  type OtherMouseBrand,
} from "@/lib/contracts/survey";
import { accountCopy } from "@/lib/copy/account";
import { questionnaireCopy } from "@/lib/copy/questionnaire";
import { ChipChoice } from "./QuestionFields";
import { ProfileSheet } from "./ProfileEditSheets";
import { brandName } from "./profile-model";
import {
  brandChips,
  emptyOtherDraft,
  filterChoices,
  sortChoices,
  type CatalogueChoice,
  type MouseChoice,
  type OtherDraft,
} from "./questionnaire-model";

/**
 * Choosing one mouse (frames c9cki and TiEvE, candidate): a bottom sheet over
 * the catalogue, then, from 「其他」, a second sheet for a mouse that is not in
 * it. The same flow serves the form's first question, 「加入另一支滑鼠」 and the
 * profile page's add path. Only the mice the page hands in are listed (the
 * server sends the ones listed for the public); what comes back is the slug.
 */
export function MouseChoiceFlow({
  catalogue,
  chosenSlugs,
  allowOther,
  showModelField = false,
  initialOther,
  answeredBrands = [],
  onChoose,
  onClose,
  returnFocusTo,
}: {
  catalogue: readonly CatalogueChoice[];
  /** Slugs to mark with a check. */
  chosenSlugs: readonly string[];
  /** False when a brand-only answer is already taken elsewhere (a body holds one). */
  allowOther: boolean;
  /**
   * Show 「型號（選填）」. Off until the contract can carry the model (Claude's
   * contract change and migration, after Kirby approves the frames): the field
   * is built, its value is held in the draft, and nothing sends it.
   */
  showModelField?: boolean;
  initialOther?: OtherDraft;
  /** Brands the person has already answered; the brand list marks them. */
  answeredBrands?: readonly OtherMouseBrand[];
  onChoose: (choice: MouseChoice) => void;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const [step, setStep] = useState<"list" | "other">("list");
  if (step === "other") {
    return (
      <OtherMouseSheet
        initial={initialOther ?? emptyOtherDraft()}
        showModelField={showModelField}
        answeredBrands={answeredBrands}
        onDone={(draft) => onChoose({ kind: "other", draft })}
        onBack={() => setStep("list")}
        onClose={onClose}
        returnFocusTo={returnFocusTo}
      />
    );
  }
  return (
    <MousePickerSheet
      catalogue={catalogue}
      chosenSlugs={chosenSlugs}
      allowOther={allowOther}
      onPick={(slug) => onChoose({ kind: "catalogue", slug })}
      onOther={() => setStep("other")}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
    />
  );
}

function CheckIcon() {
  return (
    <svg
      className="qn-check"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="11"
        cy="11"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M16 16l4 4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MousePickerSheet({
  catalogue,
  chosenSlugs,
  allowOther,
  onPick,
  onOther,
  onClose,
  returnFocusTo,
}: {
  catalogue: readonly CatalogueChoice[];
  chosenSlugs: readonly string[];
  allowOther: boolean;
  onPick: (slug: string) => void;
  onOther: () => void;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const copy = questionnaireCopy(useLocale());
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState<string | null>(null);
  const searchId = useId();
  const sorted = useMemo(() => sortChoices(catalogue), [catalogue]);
  const brands = useMemo(() => brandChips(sorted), [sorted]);
  const rows = useMemo(
    () => filterChoices(sorted, query, brand),
    [sorted, query, brand],
  );

  return (
    <ProfileSheet
      title={copy.pickerTitle}
      variant="tall"
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      note={
        <div className="qn-picker-tools">
          <label className="profile-sr-only" htmlFor={searchId}>
            {copy.searchLabel}
          </label>
          <div className="qn-search">
            <SearchIcon />
            <input
              id={searchId}
              type="search"
              value={query}
              placeholder={copy.searchPlaceholder}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div
            className="qn-brand-row"
            role="group"
            aria-label={copy.brandFilterLabel}
          >
            <button
              type="button"
              className="qn-chip qn-chip-small"
              aria-pressed={brand === null}
              onClick={() => setBrand(null)}
            >
              {copy.brandAll}
            </button>
            {brands.map((name) => (
              <button
                key={name}
                type="button"
                className="qn-chip qn-chip-small"
                aria-pressed={brand === name}
                onClick={() => setBrand(brand === name ? null : name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      }
      footer={
        allowOther ? (
          <button type="button" className="qn-other-row" onClick={onOther}>
            <span>{copy.notFoundOther}</span>
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M9 6l6 6-6 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <p className="profile-muted" role="status">
          {copy.noResults}
        </p>
      ) : (
        <ul className="qn-choice-list">
          {rows.map((row) => {
            const chosen = chosenSlugs.includes(row.slug);
            return (
              <li key={row.slug}>
                <button
                  type="button"
                  className="qn-choice"
                  aria-current={chosen ? "true" : undefined}
                  onClick={() => onPick(row.slug)}
                >
                  <span className="qn-choice-text">
                    <span className="qn-choice-brand">{row.brand}</span>
                    <span className="qn-choice-model">{row.model}</span>
                  </span>
                  {chosen && (
                    <>
                      <CheckIcon />
                      <span className="profile-sr-only">{copy.chosen}</span>
                    </>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </ProfileSheet>
  );
}

export function OtherMouseSheet({
  initial,
  showModelField,
  answeredBrands = [],
  onDone,
  onBack,
  onClose,
  returnFocusTo,
}: {
  initial: OtherDraft;
  showModelField: boolean;
  answeredBrands?: readonly OtherMouseBrand[];
  onDone: (draft: OtherDraft) => void;
  onBack: () => void;
  onClose: () => void;
  returnFocusTo?: () => HTMLElement | null;
}) {
  const locale = useLocale();
  const copy = questionnaireCopy(locale);
  const account = accountCopy(locale);
  const [draft, setDraft] = useState(initial);
  const brandId = useId();
  const modelId = useId();

  return (
    <ProfileSheet
      title={copy.otherTitle}
      onClose={onClose}
      returnFocusTo={returnFocusTo}
      footer={
        <>
          <button
            type="button"
            className="profile-primary"
            onClick={() => onDone(draft)}
          >
            {copy.otherDone}
          </button>
          <button
            type="button"
            className="button-secondary qn-back"
            onClick={onBack}
          >
            {copy.backToList}
          </button>
        </>
      }
    >
      <div className="qn-q">
        <label className="qn-legend" htmlFor={brandId}>
          {copy.brandLabel}
        </label>
        <div className="qn-select">
          <select
            id={brandId}
            value={draft.brand}
            onChange={(event) =>
              setDraft({
                ...draft,
                brand:
                  OTHER_MOUSE_BRANDS.find((b) => b === event.target.value) ??
                  draft.brand,
              })
            }
          >
            {OTHER_MOUSE_BRANDS.map((slug) => (
              <option key={slug} value={slug}>
                {answeredBrands.includes(slug)
                  ? copy.brandAnswered(brandName(slug, account))
                  : brandName(slug, account)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {showModelField && (
        <div className="qn-q">
          <label className="qn-legend" htmlFor={modelId}>
            {copy.modelLabel}
          </label>
          <input
            id={modelId}
            className="qn-input"
            type="text"
            value={draft.model}
            maxLength={80}
            placeholder={copy.modelPlaceholder}
            autoComplete="off"
            onChange={(event) =>
              setDraft({ ...draft, model: event.target.value })
            }
          />
        </div>
      )}
      <ChipChoice
        legend={copy.sizeFeelLabel}
        options={SIZE_FEELS.map((value) => ({
          value,
          label: copy.sizeFeels[value],
        }))}
        selected={draft.sizeFeel}
        allowClear={false}
        columns={3}
        onSelect={(value) =>
          value !== null && setDraft({ ...draft, sizeFeel: value })
        }
      />
    </ProfileSheet>
  );
}
