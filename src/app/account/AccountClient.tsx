"use client";

import { useRef, useState, type ComponentProps } from "react";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { MAX_ACCOUNT_MICE, type SurveyEdit } from "@/lib/contracts/survey";
import { accountCopy } from "@/lib/copy/account";
import { questionnaireCopy } from "@/lib/copy/questionnaire";
import {
  AccountView,
  type ProfileHandlerContext,
  type ProfileHandlers,
} from "./AccountView";
import { AnonymousAnswerLink } from "./AnonymousAnswerLink";
import { MouseChoiceFlow } from "./MouseChoice";
import {
  OtherAnswerSheet,
  OtherMouseEditSheet,
  RatingSheet,
  RemoveConfirm,
} from "./MouseEditSheets";
import { QuestionnaireForm } from "./QuestionnaireForm";
import { useLastTrigger } from "./modal";
import { brandName, type MouseTarget } from "./profile-model";
import {
  canRemoveMouse,
  draftFromRating,
  editBodyFrom,
  emptyRatingDraft,
  failureLine,
  isOverCap,
  answeredBrands,
  ratingFromDraft,
  routeAddOther,
  withFeedback,
  withMainUse,
  withOther,
  withRating,
  withoutOther,
  withoutRating,
  type CatalogueChoice,
  type MouseChoice,
  type OtherDraft,
  type RatingDraft,
} from "./questionnaire-model";
import { putSurvey } from "./survey-client";

/**
 * What sits on top of the profile page. Each overlay carries the handler
 * context it was opened with, so closing it can read the answers again.
 */
type Overlay =
  | { kind: "form"; scanId: string; ctx: ProfileHandlerContext }
  | { kind: "edit"; target: MouseTarget; ctx: ProfileHandlerContext }
  | { kind: "add-pick"; ctx: ProfileHandlerContext }
  | {
      kind: "add-rating";
      draft: RatingDraft;
      ctx: ProfileHandlerContext;
    }
  | {
      kind: "add-other";
      draft: OtherDraft;
      ctx: ProfileHandlerContext;
    }
  | {
      kind: "answer";
      field: "mainUse" | "feedback";
      ctx: ProfileHandlerContext;
    };

/** A confirmation open over an edit sheet: which mouse, and the control to give focus back to. */
interface RemoveState {
  target: MouseTarget;
  opener: HTMLElement | null;
}

type ViewProps = ComponentProps<typeof AccountView>;

/**
 * The signed-in profile page with its questionnaire controls wired. A server
 * component cannot hand functions to `AccountView`, so this client wrapper
 * supplies `handlers` and owns the overlays: the first-time form, the mouse
 * picker, the edit sheet and the removal confirmation (candidate, 2026-10-12).
 *
 * Every save is `PUT /api/survey` with the WHOLE new set, built from the
 * answers the page read with one change (`questionnaire-model.ts`); a removal
 * is the same call without that mouse. The nickname and avatar sheets stay
 * unwired (`editing` is not passed).
 */
export function SignedInProfile({
  catalogue,
  showModelField = false,
  ...viewProps
}: Omit<ViewProps, "handlers"> & {
  catalogue: readonly CatalogueChoice[];
  showModelField?: boolean;
}) {
  const locale = useLocale();
  const copy = questionnaireCopy(locale);
  const account = accountCopy(locale);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [remove, setRemove] = useState<RemoveState | null>(null);
  const [working, setWorking] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const goneRef = useRef(false);
  const { last, onClickCapture } = useLastTrigger();

  const mouseNames = viewProps.mouseNames ?? {};
  const nameOf = (slug: string) => mouseNames[slug] ?? slug;

  /**
   * Where focus goes when a sheet closes: the row or button that opened it, or,
   * when the opener has been taken out (a removed mouse), the page's own wrapper.
   */
  function returnFocus(): HTMLElement | null {
    if (goneRef.current) return wrapperRef.current;
    const target = last.current;
    return target?.isConnected ? target : wrapperRef.current;
  }

  function close() {
    setOverlay(null);
    setRemove(null);
    setLine(null);
    setWorking(false);
  }

  function open(next: Overlay) {
    goneRef.current = false;
    setLine(null);
    setRemove(null);
    setOverlay(next);
  }

  /** Send the whole new set. On success read the answers again and close everything. */
  async function save(body: SurveyEdit, ctx: ProfileHandlerContext) {
    if (working) return false;
    setWorking(true);
    setLine(null);
    const result = await putSurvey(body);
    setWorking(false);
    if (result.ok) {
      ctx.reload();
      close();
      return true;
    }
    setLine(failureLine(result.reason, copy));
    return false;
  }

  const handlers: ProfileHandlers = {
    onOpenQuestionnaire: (scanId, ctx) => open({ kind: "form", scanId, ctx }),
    onEditMouse: (target, ctx) => open({ kind: "edit", target, ctx }),
    onAddMouse: (ctx) => open({ kind: "add-pick", ctx }),
    onEditOtherAnswer: (field, ctx) => open({ kind: "answer", field, ctx }),
  };

  const capLine = (body: SurveyEdit) =>
    isOverCap(body) ? copy.overCap(MAX_ACCOUNT_MICE) : null;

  function renderOverlay() {
    if (overlay === null) return null;
    const { ctx } = overlay;

    if (overlay.kind === "form") {
      return (
        <QuestionnaireForm
          scanId={overlay.scanId}
          signedIn
          canEditInstead={
            ctx.answers !== null &&
            ctx.answers.ratings.length + ctx.answers.otherMice.length > 0
          }
          catalogue={catalogue}
          mouseNames={mouseNames}
          showModelField={showModelField}
          onClose={close}
          onSubmitted={() => {
            ctx.reload();
            close();
          }}
          returnFocusTo={returnFocus}
        />
      );
    }

    const answers = ctx.answers;
    if (answers === null) return null;
    const base = editBodyFrom(answers);

    if (overlay.kind === "add-pick") {
      const choose = (choice: MouseChoice) => {
        if (choice.kind === "other") {
          const route = routeAddOther(answers, choice.draft);
          if (route.kind === "edit-existing") {
            // That brand is already answered: open its own sheet, so an add
            // can never overwrite it (and clear its "in use now").
            open({
              kind: "edit",
              target: { kind: "other", brand: route.brand },
              ctx,
            });
            return;
          }
          void addOther(choice.draft, ctx, route.body);
          return;
        }
        const existing = answers.ratings.find((r) => r.slug === choice.slug);
        if (existing) {
          open({
            kind: "edit",
            target: { kind: "rating", slug: choice.slug },
            ctx,
          });
          return;
        }
        open({
          kind: "add-rating",
          draft: emptyRatingDraft(choice.slug),
          ctx,
        });
      };
      return (
        <MouseChoiceFlow
          catalogue={catalogue}
          chosenSlugs={answers.ratings.map((r) => r.slug)}
          allowOther
          showModelField={showModelField}
          answeredBrands={answeredBrands(answers)}
          onChoose={choose}
          onClose={close}
          returnFocusTo={returnFocus}
        />
      );
    }

    if (overlay.kind === "add-rating") {
      // One more mouse must still fit the account's cap.
      const over = miceAfterAdd(base) > MAX_ACCOUNT_MICE;
      return (
        <RatingSheet
          title={nameOf(overlay.draft.slug)}
          initial={overlay.draft}
          initialCurrent={false}
          showCurrent
          working={working}
          line={over ? copy.overCap(MAX_ACCOUNT_MICE) : line}
          blocked={over}
          onSave={(draft, current) => {
            const rating = ratingFromDraft(draft, current);
            if (rating !== null) void save(withRating(base, rating), ctx);
          }}
          onClose={close}
          returnFocusTo={returnFocus}
        />
      );
    }

    if (overlay.kind === "add-other") {
      return (
        <OtherMouseEditSheet
          title={copy.otherEditTitle(brandName(overlay.draft.brand, account))}
          initialSizeFeel={overlay.draft.sizeFeel}
          initialCurrent={false}
          working={working}
          line={line}
          blocked={isOverCap(base)}
          onSave={(sizeFeel, current) =>
            void save(
              withOther(base, {
                brand: overlay.draft.brand,
                sizeFeel,
                current,
              }),
              ctx,
            )
          }
          onClose={close}
          returnFocusTo={returnFocus}
        />
      );
    }

    if (overlay.kind === "answer") {
      return (
        <OtherAnswerSheet
          field={overlay.field}
          initialMainUse={base.mainUse ?? null}
          initialFeedback={base.feedback ?? ""}
          working={working}
          line={capLine(base) ?? line}
          blocked={isOverCap(base)}
          onSave={({ mainUse, feedback }) =>
            void save(
              overlay.field === "mainUse"
                ? withMainUse(base, mainUse)
                : withFeedback(base, feedback),
              ctx,
            )
          }
          onClose={close}
          returnFocusTo={returnFocus}
        />
      );
    }

    // overlay.kind === "edit"
    const { target } = overlay;
    const removable = canRemoveMouse(base);
    const askRemove = (opener: HTMLElement) => setRemove({ target, opener });
    if (target.kind === "rating") {
      const rating = answers.ratings.find((r) => r.slug === target.slug);
      if (!rating) return null;
      return (
        <RatingSheet
          title={nameOf(rating.slug)}
          initial={draftFromRating(rating)}
          initialCurrent={rating.current}
          showCurrent
          working={working}
          line={capLine(base) ?? line}
          blocked={isOverCap(base)}
          onSave={(draft, current) => {
            const next = ratingFromDraft(draft, current);
            if (next !== null) void save(withRating(base, next), ctx);
          }}
          onRemove={removable ? askRemove : undefined}
          onClose={close}
          returnFocusTo={returnFocus}
        />
      );
    }
    const other = answers.otherMice.find((o) => o.brand === target.brand);
    if (!other) return null;
    return (
      <OtherMouseEditSheet
        title={copy.otherEditTitle(brandName(other.brand, account))}
        initialSizeFeel={other.sizeFeel}
        initialCurrent={other.current}
        working={working}
        line={capLine(base) ?? line}
        blocked={isOverCap(base)}
        onSave={(sizeFeel, current) =>
          void save(
            withOther(base, { brand: other.brand, sizeFeel, current }),
            ctx,
          )
        }
        onRemove={removable ? askRemove : undefined}
        onClose={close}
        returnFocusTo={returnFocus}
      />
    );
  }

  /** A brand-only answer picked from the add path: sent at once; a failure opens its sheet with the reason. */
  async function addOther(
    draft: OtherDraft,
    ctx: ProfileHandlerContext,
    body: SurveyEdit,
  ) {
    if (isOverCap(body)) {
      open({ kind: "add-other", draft, ctx });
      setLine(copy.overCap(MAX_ACCOUNT_MICE));
      return;
    }
    setWorking(true);
    const result = await putSurvey(body);
    setWorking(false);
    if (result.ok) {
      ctx.reload();
      close();
      return;
    }
    open({ kind: "add-other", draft, ctx });
    setLine(failureLine(result.reason, copy));
  }

  function renderRemove() {
    if (remove === null || overlay === null) return null;
    const answers = overlay.ctx.answers;
    if (answers === null) return null;
    const base = editBodyFrom(answers);
    const { target } = remove;
    const after =
      target.kind === "rating"
        ? withoutRating(base, target.slug)
        : withoutOther(base, target.brand);
    const name =
      target.kind === "rating"
        ? nameOf(target.slug)
        : account.otherModel(brandName(target.brand, account));
    const stillOver = isOverCap(after);
    return (
      <RemoveConfirm
        name={name}
        working={working}
        line={stillOver ? copy.overCap(MAX_ACCOUNT_MICE) : line}
        onConfirm={() => {
          if (stillOver) return;
          goneRef.current = true;
          void save(after, overlay.ctx).then((ok) => {
            if (!ok) goneRef.current = false;
          });
        }}
        onClose={() => {
          setRemove(null);
          setLine(null);
        }}
        returnFocusTo={() =>
          focusIfConnectedTarget(remove.opener) ?? returnFocus()
        }
      />
    );
  }

  return (
    <>
      <div
        ref={wrapperRef}
        tabIndex={-1}
        className="profile-host"
        onClickCapture={onClickCapture}
      >
        <AccountView {...viewProps} handlers={handlers} />
      </div>
      {renderOverlay()}
      {renderRemove()}
    </>
  );
}

/** The opener when it is still in the page, else `null` (so the caller can fall back). */
function focusIfConnectedTarget(
  opener: HTMLElement | null,
): HTMLElement | null {
  return opener?.isConnected ? opener : null;
}

/** How many mice the set holds after one more is added. */
function miceAfterAdd(body: SurveyEdit): number {
  return body.ratings.length + body.otherMice.length + 1;
}

/**
 * The signed-out view's 「不登入，直接回答問卷」 link and the form behind it, for
 * a visitor whose browser holds a scan (`scanId` comes from the scan-session
 * cookie, resolved on the server). With no scan the link goes to `/scan/easy`.
 */
export function SignedOutAnswer({
  scanId,
  catalogue,
  mouseNames,
  showModelField = false,
}: {
  scanId: string | null;
  catalogue: readonly CatalogueChoice[];
  mouseNames: Readonly<Record<string, string>>;
  showModelField?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { last, onClickCapture } = useLastTrigger();
  return (
    <>
      <div onClickCapture={onClickCapture}>
        <AnonymousAnswerLink scanId={scanId} onOpen={() => setOpen(true)} />
      </div>
      {open && scanId !== null && (
        <QuestionnaireForm
          scanId={scanId}
          signedIn={false}
          catalogue={catalogue}
          mouseNames={mouseNames}
          showModelField={showModelField}
          onClose={() => setOpen(false)}
          onSubmitted={() => setOpen(false)}
          returnFocusTo={() => last.current}
        />
      )}
    </>
  );
}
