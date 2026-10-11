/**
 * Pure logic of the questionnaire form, the mouse picker and the edit sheet
 * (candidate, 2026-10-12). No React, no I/O, no clock. The bodies are built
 * against the contract in `src/lib/contracts/survey.ts`:
 *   - the first-time form builds a `SurveySubmission` (`POST /api/survey`);
 *   - an edit builds a `SurveyEdit` (`PUT /api/survey`) from the answers the
 *     page read (`GET /api/survey`), with ONE change. `PUT` replaces the whole
 *     set, so everything the body leaves out is removed: the builders below
 *     copy every answer and never drop one by accident.
 *
 * The model of a mouse that is not in the catalogue is held in the draft
 * (`OtherDraft.model`) so the field can be switched on, but it is NOT in any
 * body: the contract has no such field yet.
 */
import type { QuestionnaireCopy } from "@/lib/copy/questionnaire";
import type { SurveyFailure } from "./survey-client";
import {
  MAX_ACCOUNT_MICE,
  MAX_FEEDBACK_CHARS,
  MAX_RATED_MICE,
  SURVEY_CONSENT_VERSION,
  type MainUse,
  type OtherMouseBrand,
  type PainPoint,
  type SizeFeel,
  type SurveyEdit,
  type SurveyMineResponse,
  type SurveySubmission,
  type UseDuration,
} from "@/lib/contracts/survey";

/** A mouse the picker can offer: a catalogue row that is listed for the public. */
export interface CatalogueChoice {
  slug: string;
  brand: string;
  model: string;
}

export type MouseRating = SurveyMineResponse["ratings"][number];
export type OtherMouseAnswer = SurveyMineResponse["otherMice"][number];

/** What the picker hands back: a catalogue slug, or "none of these". */
export type MouseChoice =
  { kind: "catalogue"; slug: string } | { kind: "other"; draft: OtherDraft };

/** A rating that is being written in the form or in a sheet. */
export interface RatingDraft {
  slug: string;
  /** `null` until the person gives a score; a rating cannot be sent without one. */
  satisfaction: number | null;
  duration: UseDuration | null;
  painPoints: PainPoint[];
}

/** A mouse that is not in the catalogue, as the sheet writes it. */
export interface OtherDraft {
  brand: OtherMouseBrand;
  sizeFeel: SizeFeel;
  /** Not sent: the contract has no field for it yet (see the file header). */
  model: string;
}

export const DEFAULT_OTHER_BRAND: OtherMouseBrand = "logitech";
export const DEFAULT_SIZE_FEEL: SizeFeel = "just_right";

export function emptyRatingDraft(slug: string): RatingDraft {
  return { slug, satisfaction: null, duration: null, painPoints: [] };
}

export function emptyOtherDraft(): OtherDraft {
  return {
    brand: DEFAULT_OTHER_BRAND,
    sizeFeel: DEFAULT_SIZE_FEEL,
    model: "",
  };
}

/** The first question's answer: the mouse the person uses now. */
export type CurrentMouse =
  { kind: "rating"; draft: RatingDraft } | { kind: "other"; draft: OtherDraft };

/** Everything the first-time form holds. */
export interface FormState {
  current: CurrentMouse | null;
  mainUse: MainUse | null;
  /** The mice added with 「加入另一支滑鼠」: never the current one. */
  extraRatings: RatingDraft[];
  /** At most one mouse of the whole form can be a brand-only answer (the body has one `otherMouse`). */
  extraOther: OtherDraft | null;
  feedback: string;
  consent: boolean;
}

export function emptyForm(): FormState {
  return {
    current: null,
    mainUse: null,
    extraRatings: [],
    extraOther: null,
    feedback: "",
    consent: false,
  };
}

/** How many mice the form names so far. */
export function formMouseCount(form: FormState): number {
  return (
    (form.current === null ? 0 : 1) +
    form.extraRatings.length +
    (form.extraOther === null ? 0 : 1)
  );
}

/** How many more mice 「加入另一支滑鼠」 can still add (a body holds `MAX_RATED_MICE` in all). */
export function extraSlotsLeft(form: FormState): number {
  return Math.max(0, MAX_RATED_MICE - formMouseCount(form));
}

/** Is a brand-only answer already used by something other than `except`? */
export function otherTaken(
  form: FormState,
  except: "current" | "extra" | null,
): boolean {
  const currentIsOther = form.current?.kind === "other";
  const extraIsOther = form.extraOther !== null;
  if (except === "current") return extraIsOther;
  if (except === "extra") return currentIsOther;
  return currentIsOther || extraIsOther;
}

/** Slugs the form already holds, so the picker can say which one is chosen. */
export function formSlugs(form: FormState): string[] {
  const slugs: string[] = [];
  if (form.current?.kind === "rating") slugs.push(form.current.draft.slug);
  for (const r of form.extraRatings) slugs.push(r.slug);
  return slugs;
}

/** A rating draft as a body row, or `null` when it has no score yet. */
export function ratingFromDraft(
  draft: RatingDraft,
  current: boolean,
): MouseRating | null {
  if (draft.satisfaction === null) return null;
  const rating: MouseRating = {
    slug: draft.slug,
    satisfaction: draft.satisfaction,
    painPoints: [...draft.painPoints],
    current,
  };
  if (draft.duration !== null) rating.duration = draft.duration;
  return rating;
}

function otherFromDraft(draft: OtherDraft, current: boolean): OtherMouseAnswer {
  return { brand: draft.brand, sizeFeel: draft.sizeFeel, current };
}

/**
 * Is there something the form can send? At least one mouse that fits the
 * contract: a catalogue mouse needs its score, a brand-only answer needs
 * nothing more. The consent comes on top (see `canSubmit`).
 */
export function hasSendableMouse(form: FormState): boolean {
  if (form.current?.kind === "other") return true;
  if (
    form.current?.kind === "rating" &&
    form.current.draft.satisfaction !== null
  ) {
    return true;
  }
  return (
    form.extraOther !== null ||
    form.extraRatings.some((r) => r.satisfaction !== null)
  );
}

/** The submit button's rule: the consent is ticked and a mouse can be sent. */
export function canSubmit(form: FormState): boolean {
  return form.consent && hasSendableMouse(form);
}

/**
 * The `POST /api/survey` body, or `null` when the form cannot be sent (no
 * consent, no mouse the contract accepts). The comment is trimmed and left out
 * when empty. A catalogue mouse without a score is left out rather than sent
 * with an invented one.
 */
export function buildSubmission(
  form: FormState,
  scanId: string,
): SurveySubmission | null {
  if (!canSubmit(form)) return null;
  const ratings: MouseRating[] = [];
  let otherMouse: OtherMouseAnswer | undefined;
  if (form.current?.kind === "rating") {
    const rating = ratingFromDraft(form.current.draft, true);
    if (rating !== null) ratings.push(rating);
  } else if (form.current?.kind === "other") {
    otherMouse = otherFromDraft(form.current.draft, true);
  }
  for (const draft of form.extraRatings) {
    const rating = ratingFromDraft(draft, false);
    if (rating !== null) ratings.push(rating);
  }
  if (form.extraOther !== null && otherMouse === undefined) {
    otherMouse = otherFromDraft(form.extraOther, false);
  }
  const body: SurveySubmission = {
    scanId,
    consent: { accepted: true, version: SURVEY_CONSENT_VERSION },
    ratings,
  };
  if (form.mainUse !== null) body.mainUse = form.mainUse;
  if (otherMouse !== undefined) body.otherMouse = otherMouse;
  const feedback = form.feedback.trim();
  if (feedback !== "") body.feedback = feedback;
  return body;
}

/**
 * The comment's length as the contract counts it: UTF-16 units (zod's `max`),
 * so an emoji is two. The counter and the textarea's `maxLength` use the same
 * count, so what the box lets through is what the server accepts.
 */
export function feedbackLength(text: string): number {
  return text.length;
}

/** The comment is over the contract's limit. */
export function feedbackTooLong(text: string): boolean {
  return feedbackLength(text.trim()) > MAX_FEEDBACK_CHARS;
}

// ── Editing what is already kept (`PUT /api/survey`, a whole replacement) ─────

/**
 * The body that says "keep everything as it is": the read-back answers as an
 * edit body. A blank comment becomes `null` (the body refuses an empty string).
 */
export function editBodyFrom(answers: SurveyMineResponse): SurveyEdit {
  const feedback = (answers.feedback ?? "").trim();
  return {
    mainUse: answers.mainUse,
    ratings: answers.ratings.map((r) => ({
      ...r,
      painPoints: [...r.painPoints],
    })),
    otherMice: answers.otherMice.map((o) => ({ ...o })),
    feedback: feedback === "" ? null : feedback,
  };
}

/** The single-current rule: at most one mouse across both lists is the current one. */
function clearCurrent(body: SurveyEdit): SurveyEdit {
  return {
    ...body,
    ratings: body.ratings.map((r) =>
      r.current ? { ...r, current: false } : r,
    ),
    otherMice: body.otherMice.map((o) =>
      o.current ? { ...o, current: false } : o,
    ),
  };
}

/**
 * Put one rating into the set: it replaces the rating of the same slug, or is
 * added at the end. When it is the current mouse, the earlier current one (in
 * either list) is cleared in the state that is sent.
 */
export function withRating(body: SurveyEdit, rating: MouseRating): SurveyEdit {
  const base = rating.current ? clearCurrent(body) : body;
  const exists = base.ratings.some((r) => r.slug === rating.slug);
  return {
    ...base,
    ratings: exists
      ? base.ratings.map((r) => (r.slug === rating.slug ? rating : r))
      : [...base.ratings, rating],
  };
}

/** Put one brand-only answer into the set (the brand is its key), with the same current rule. */
export function withOther(
  body: SurveyEdit,
  other: OtherMouseAnswer,
): SurveyEdit {
  const base = other.current ? clearCurrent(body) : body;
  const exists = base.otherMice.some((o) => o.brand === other.brand);
  return {
    ...base,
    otherMice: exists
      ? base.otherMice.map((o) => (o.brand === other.brand ? other : o))
      : [...base.otherMice, other],
  };
}

export function withoutRating(body: SurveyEdit, slug: string): SurveyEdit {
  return { ...body, ratings: body.ratings.filter((r) => r.slug !== slug) };
}

export function withoutOther(body: SurveyEdit, brand: string): SurveyEdit {
  return {
    ...body,
    otherMice: body.otherMice.filter((o) => o.brand !== brand),
  };
}

export function withMainUse(
  body: SurveyEdit,
  mainUse: MainUse | null,
): SurveyEdit {
  return { ...body, mainUse };
}

/** A blank comment is sent as `null`, which removes it. */
export function withFeedback(
  body: SurveyEdit,
  feedback: string | null,
): SurveyEdit {
  const text = (feedback ?? "").trim();
  return { ...body, feedback: text === "" ? null : text };
}

/** How many mice the set holds (ratings and brand-only answers together). */
export function miceInBody(body: SurveyEdit): number {
  return body.ratings.length + body.otherMice.length;
}

/** The set is over the account's cap: the server refuses it, so the page says so first. */
export function isOverCap(body: SurveyEdit): boolean {
  return miceInBody(body) > MAX_ACCOUNT_MICE;
}

/**
 * Can this mouse be removed with an edit? The set must keep at least one mouse:
 * taking the last one away is `DELETE /api/survey` (the profile page's
 * 「刪除所有資料」), not an edit.
 */
export function canRemoveMouse(body: SurveyEdit): boolean {
  return miceInBody(body) > 1;
}

/** Turn a rating the sheet is editing into the draft the sheet shows. */
export function draftFromRating(rating: MouseRating): RatingDraft {
  return {
    slug: rating.slug,
    satisfaction: rating.satisfaction,
    duration: rating.duration ?? null,
    painPoints: [...rating.painPoints],
  };
}

/** Flip one value in a list: in when absent, out when present. Keeps the order of `all`. */
export function togglePain(
  list: readonly PainPoint[],
  point: PainPoint,
  all: readonly PainPoint[],
): PainPoint[] {
  const next = new Set(list);
  if (next.has(point)) next.delete(point);
  else next.add(point);
  return all.filter((p) => next.has(p));
}

// ── The picker ────────────────────────────────────────────────────────────────

/** "Brand Model" without saying the brand twice, for a row that names one mouse. */
export function choiceName(choice: CatalogueChoice): string {
  const b = choice.brand.trim();
  const m = choice.model.trim();
  if (b === "") return m;
  if (m === "") return b;
  return m.toLowerCase().startsWith(b.toLowerCase()) ? m : `${b} ${m}`;
}

/** The catalogue in the order the picker lists it: brand, then model (numbers in order). */
export function sortChoices(
  rows: readonly CatalogueChoice[],
): CatalogueChoice[] {
  const collator = new Intl.Collator("en", {
    numeric: true,
    sensitivity: "base",
  });
  return [...rows].sort(
    (a, b) =>
      collator.compare(a.brand, b.brand) || collator.compare(a.model, b.model),
  );
}

/**
 * The brand chips: every brand that has a mouse, the ones with the most mice
 * first (ties by name), so the common brands are in reach without scrolling.
 */
export function brandChips(rows: readonly CatalogueChoice[]): string[] {
  const counts = new Map<string, number>();
  for (const row of rows)
    counts.set(row.brand, (counts.get(row.brand) ?? 0) + 1);
  const collator = new Intl.Collator("en", { sensitivity: "base" });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || collator.compare(a[0], b[0]))
    .map(([brand]) => brand);
}

/**
 * The rows the picker shows: the chosen brand (or all), and every word of the
 * search found, in any case, in "brand model". An empty search shows all.
 */
export function filterChoices(
  rows: readonly CatalogueChoice[],
  query: string,
  brand: string | null,
): CatalogueChoice[] {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== "");
  return rows.filter((row) => {
    if (brand !== null && row.brand !== brand) return false;
    if (words.length === 0) return true;
    const text = `${row.brand} ${row.model}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

// ── What to say when a call fails ─────────────────────────────────────────────

/** The one line for a failed call. Every failure has a sentence; none is silent. */
export function failureLine(
  reason: SurveyFailure,
  copy: QuestionnaireCopy,
): string {
  switch (reason) {
    case "conflict":
      return copy.alreadyAnswered;
    case "not_found":
      return copy.scanGone;
    case "rate_limited":
      return copy.rateLimited;
    case "unauthorized":
      return copy.sessionExpired;
    case "invalid":
      return copy.sendInvalid;
    case "invalid_feedback":
      return copy.sendFeedbackInvalid;
    case "network":
      return copy.sendNetwork;
  }
}
