"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useLocale } from "@/client/i18n/LocaleProvider";
import { useBlankTap } from "@/components/dialog/useBlankTap";
import { Presence, usePresence } from "@/components/motion/Presence";
import { Avatar } from "@/components/nav/Avatar";
import { SURVEY_PATH, resultsPagePath } from "@/lib/contracts/routes";
import {
  MAX_ACCOUNT_MICE,
  surveyMineResponseSchema,
  type SurveyMineResponse,
} from "@/lib/contracts/survey";
import { accountCopy, type AccountCopy } from "@/lib/copy/account";
import type { AccountScan } from "../../server/account/repo";
import {
  clearScanDisclosures,
  restoreTypedSizeNote,
} from "../../components/results/userLengthDisclosure";
import { clearAttempts } from "../../client/camera/easyScanPreferences";
import {
  AvatarSheet,
  NicknameSheet,
  type ProfileEditing,
} from "./ProfileEditSheets";
import {
  formatCm,
  formatMonthDay,
  handRows,
  hasAnswers,
  mouseRows,
  otherAnswerRows,
  shownAccountMeasurements,
  splitScans,
  type AnswersState,
  type MouseRow,
  type MouseTarget,
} from "./profile-model";

type Status = "idle" | "working" | "done" | "error";

/** Who the page is about. The e-mail is read on the server for its owner only. */
export interface ProfileInfo {
  name: string | null;
  email: string | null;
  image: string | null;
}

/** Given to every handler so it can ask the page to read the answers again after a change. */
export interface ProfileHandlerContext {
  reload: () => void;
  /**
   * The answers the page has read, `null` while they are not loaded. A handler
   * that edits builds its whole-replacement body from them (`PUT` replaces the
   * set), so it never needs a read of its own.
   */
  answers: SurveyMineResponse | null;
}

/**
 * What a tap on the answers does. The questionnaire form and the edit sheet
 * are built elsewhere (Builder Q): this page only calls them. A handler that is
 * not given leaves its control out (a row is plain text, the buttons are not
 * drawn), so no control is ever dead.
 */
export interface ProfileHandlers {
  /** The empty state's button: open the questionnaire for the account's latest scan. */
  onOpenQuestionnaire?: (scanId: string, ctx: ProfileHandlerContext) => void;
  /** A row of 我的滑鼠. */
  onEditMouse?: (target: MouseTarget, ctx: ProfileHandlerContext) => void;
  /** 「加入另一支滑鼠」. */
  onAddMouse?: (ctx: ProfileHandlerContext) => void;
  /** A row of 其他回答. */
  onEditOtherAnswer?: (
    field: "mainUse" | "feedback",
    ctx: ProfileHandlerContext,
  ) => void;
}

export interface AccountViewProps {
  scans: AccountScan[];
  profile?: ProfileInfo;
  /** Catalogue slug -> "Brand Model", to name the mice the person rated. */
  mouseNames?: Record<string, string>;
  /** The sign-out form (a server action), drawn at the bottom. */
  signOut?: ReactNode;
  /** Saves for the nickname and avatar sheets; without it they open "not wired". */
  editing?: ProfileEditing;
  handlers?: ProfileHandlers;
  /** The answers' state to start from (the page always reads them itself). */
  initialAnswers?: AnswersState;
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function Chevron() {
  return (
    <svg
      className="profile-chevron"
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
 * `/account`'s interactive half, the profile page 「我的檔案」: person block,
 * basics (avatar, nickname, e-mail), the latest measurement, the person's mice
 * and other answers, export and delete-everything, sign out. The server
 * component (`page.tsx`) fetches the scans so the page renders with data on
 * first paint; the answers are read in the browser from `GET /api/survey`
 * (a read budget of its own). Export re-fetches `GET /api/account/scans` and
 * turns it into a client-built download (issue #17).
 */
export function AccountView({
  scans,
  profile = { name: null, email: null, image: null },
  mouseNames = {},
  signOut,
  editing,
  handlers = {},
  initialAnswers = { kind: "loading" },
}: AccountViewProps) {
  const locale = useLocale();
  const copy = accountCopy(locale);
  const [visibleScans, setVisibleScans] = useState(scans);
  const [exportStatus, setExportStatus] = useState<Status>("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<Status>("idle");
  const [answers, setAnswers] = useState<AnswersState>(initialAnswers);
  const [reloadKey, setReloadKey] = useState(0);
  const [name, setName] = useState(profile.name);
  const [image, setImage] = useState(profile.image);
  const [sheet, setSheet] = useState<"nickname" | "avatar" | null>(null);
  const sheetRef = useRef<"nickname" | "avatar" | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nicknameTriggerRef = useRef<HTMLButtonElement>(null);
  const avatarTriggerRef = useRef<HTMLButtonElement>(null);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  const ctx: ProfileHandlerContext = {
    reload,
    answers: answers.kind === "ready" ? answers.answers : null,
  };

  // The confirmation fades out before it closes (V3.2 motion pass #26): it
  // stays open for leaveMs("fade") after `confirmOpen` turns false, and only
  // then closes and gives focus back to its trigger.
  const confirm = usePresence(confirmOpen, "fade");
  // A tap on the dimmed page beside the card cancels, as 取消 does (Kirby
  // 2026-10-26, candidate / 未拍板); not while it is deleting.
  const confirmBlankTap = useBlankTap(() => setConfirmOpen(false), {
    panel: "self",
    enabled: !confirm.leaving && deleteStatus !== "working",
  });
  useEffect(() => {
    if (!confirm.mounted) return;
    const dialog = dialogRef.current;
    const trigger = triggerRef.current;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog?.close();
      trigger?.focus();
    };
  }, [confirm.mounted]);

  // Reads the person's own answers. A re-read after an edit keeps what is on
  // screen until the new answer arrives; only a first read or a retry shows
  // "loading".
  useEffect(() => {
    const controller = new AbortController();
    fetch(SURVEY_PATH, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("read failed");
        const parsed = surveyMineResponseSchema.safeParse(await res.json());
        if (!parsed.success) throw new Error("unexpected body");
        setAnswers({ kind: "ready", answers: parsed.data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setAnswers({ kind: "error" });
      });
    return () => controller.abort();
  }, [reloadKey]);

  // Closing a sheet returns focus to the row that opened it. A sheet can ask
  // to close twice (its Cancel button, then the dialog's own close event), so
  // only the first call counts.
  function openSheet(kind: "nickname" | "avatar") {
    sheetRef.current = kind;
    setSheet(kind);
  }
  function closeSheet() {
    const kind = sheetRef.current;
    if (kind === null) return;
    sheetRef.current = null;
    setSheet(null);
    (kind === "avatar"
      ? avatarTriggerRef
      : nicknameTriggerRef
    ).current?.focus();
  }

  async function handleExport() {
    setExportStatus("working");
    try {
      const res = await fetch("/api/account/scans");
      if (!res.ok) throw new Error("export failed");
      const data: unknown = await res.json();
      downloadJson(`palmate-scans-${Date.now()}.json`, data);
      setExportStatus("done");
    } catch {
      setExportStatus("error");
    }
  }

  async function handleDeleteAll() {
    setDeleteStatus("working");
    try {
      const res = await fetch("/api/account/scans", { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      try {
        clearScanDisclosures(
          localStorage,
          visibleScans.map((scan) => scan.scanId),
        );
        // The scan attempt log kept on this device goes with the rest.
        clearAttempts(localStorage);
      } catch {
        // Browser storage may be unavailable; server deletion succeeded.
      }
      setVisibleScans([]);
      setDeleteStatus("done");
      setConfirmOpen(false);
      // The account is gone and this browser is signed out: load /account
      // again so the server renders the signed-out state.
      window.location.assign("/account");
    } catch {
      setDeleteStatus("error");
    }
  }

  const { latest, earlier } = splitScans(visibleScans);
  const displayName = name ?? copy.signedIn;

  return (
    <div className="profile">
      <div className="profile-person" data-testid="account-identity">
        <Avatar className="avatar avatar-profile" image={image} />
        <div className="profile-person-text">
          <p className="profile-name">{displayName}</p>
          {profile.email !== null && (
            <p className="profile-email">{profile.email}</p>
          )}
        </div>
      </div>

      <Section title={copy.basicsHeading}>
        <ul className="profile-rows">
          <li>
            <button
              ref={avatarTriggerRef}
              type="button"
              className="profile-row profile-row-button"
              aria-haspopup="dialog"
              onClick={() => openSheet("avatar")}
            >
              <span className="profile-row-label">{copy.avatarRow}</span>
              <Avatar className="avatar avatar-row" image={image} />
              <Chevron />
            </button>
          </li>
          <li>
            <button
              ref={nicknameTriggerRef}
              type="button"
              className="profile-row profile-row-button"
              aria-haspopup="dialog"
              onClick={() => openSheet("nickname")}
            >
              <span className="profile-row-label">{copy.nicknameRow}</span>
              <span className="profile-row-value">{displayName}</span>
              <Chevron />
            </button>
          </li>
          {profile.email !== null && (
            <li>
              <div className="profile-row">
                <span className="profile-row-label">{copy.emailRow}</span>
                <span className="profile-row-value profile-row-readonly">
                  {profile.email}
                </span>
              </div>
            </li>
          )}
        </ul>
      </Section>

      <HandSection
        copy={copy}
        locale={locale}
        latest={latest}
        earlier={earlier}
      />

      <MiceSection
        copy={copy}
        answers={answers}
        mouseNames={mouseNames}
        latestScanId={latest?.scanId ?? null}
        handlers={handlers}
        ctx={ctx}
        onRetry={() => {
          setAnswers({ kind: "loading" });
          reload();
        }}
      />

      <Section title={copy.dataHeading}>
        <ul className="profile-rows">
          <li>
            <button
              type="button"
              className="profile-row profile-text-button"
              onClick={handleExport}
              disabled={exportStatus === "working" || visibleScans.length === 0}
            >
              {exportStatus === "working"
                ? copy.preparingExport
                : copy.exportMyData}
            </button>
          </li>
          <li>
            <button
              type="button"
              className="profile-row profile-text-button profile-danger"
              ref={triggerRef}
              onClick={() => setConfirmOpen(true)}
            >
              {copy.deleteEverything}
            </button>
          </li>
        </ul>
        {exportStatus === "error" && (
          <p className="status-error" role="status">
            {copy.exportError}
          </p>
        )}
      </Section>

      {signOut !== undefined && (
        <div className="profile-signout">{signOut}</div>
      )}

      {/* Each sheet slides down before it unmounts (V3.2 motion pass #10);
          the focus `closeSheet` gives back lands once it has gone. */}
      <Presence
        kind="sheet"
        onExited={() => nicknameTriggerRef.current?.focus()}
      >
        {sheet === "nickname" && (
          <NicknameSheet
            saved={name ?? ""}
            editing={editing}
            onClose={closeSheet}
            onSaved={setName}
          />
        )}
      </Presence>
      <Presence kind="sheet" onExited={() => avatarTriggerRef.current?.focus()}>
        {sheet === "avatar" && (
          <AvatarSheet
            image={image}
            editing={editing}
            onClose={closeSheet}
            onSaved={setImage}
          />
        )}
      </Presence>

      {confirm.mounted && (
        <dialog
          ref={dialogRef}
          onClose={() => setConfirmOpen(false)}
          {...confirmBlankTap}
          onCancel={(event) => {
            // Esc: fade out like Cancel, not the browser's instant close.
            event.preventDefault();
            setConfirmOpen(false);
          }}
          data-leaving={confirm.leaving ? "true" : undefined}
          // Leaving: no second 刪除全部 (DELETE) during the fade.
          inert={confirm.leaving}
          aria-hidden={confirm.leaving ? true : undefined}
          role="alertdialog"
          aria-labelledby="delete-all-title"
          aria-describedby="delete-all-body"
          className="dialog"
        >
          <h2 id="delete-all-title">{copy.deleteTitle}</h2>
          <p id="delete-all-body">{copy.deleteBody(visibleScans.length)}</p>
          {deleteStatus === "error" && (
            <p className="status-error" role="status">
              {copy.deleteError}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button-secondary"
              ref={cancelRef}
              onClick={() => setConfirmOpen(false)}
            >
              {copy.cancel}
            </button>
            <button
              type="button"
              className="button-danger"
              onClick={handleDeleteAll}
              disabled={deleteStatus === "working"}
            >
              {deleteStatus === "working"
                ? copy.deleting
                : copy.deleteEverything}
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}

/** A titled block: a real heading, and the body named by it. */
function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="profile-section" aria-labelledby={id}>
      <div className="profile-section-head">
        <h2 id={id}>{title}</h2>
        {aside !== undefined && aside !== "" && (
          <span className="profile-section-aside">{aside}</span>
        )}
      </div>
      {children}
    </section>
  );
}

function HandSection({
  copy,
  locale,
  latest,
  earlier,
}: {
  copy: AccountCopy;
  locale: "zh-TW" | "en";
  latest: AccountScan | null;
  earlier: AccountScan[];
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  // The results page reads its "you typed this size" note from this browser, so
  // a typed scan made elsewhere needs the note put back before it is opened.
  useEffect(() => {
    if (latest === null) return;
    try {
      restoreTypedSizeNote(localStorage, latest);
    } catch {
      /* storage blocked: the results page then shows no typed-size note */
    }
  }, [latest]);

  if (latest === null) {
    return (
      <Section title={copy.handHeading}>
        <div className="profile-empty">
          <h3>{copy.noScanTitle}</h3>
          <p>{copy.noScanBody}</p>
          <Link className="profile-primary" href="/scan/easy">
            {copy.scanMyHand}
          </Link>
        </div>
      </Section>
    );
  }

  const rows = handRows(latest, copy);
  return (
    <Section
      title={copy.handHeading}
      aside={copy.handLatest(formatMonthDay(latest.createdAt, locale))}
    >
      <dl className="profile-rows profile-facts">
        {rows.map((row) => (
          <div key={row.key} className="profile-row">
            <dt className="profile-row-label">{row.label}</dt>
            <dd className="profile-fact">{row.value}</dd>
          </div>
        ))}
      </dl>
      <Link
        className="profile-row profile-row-link"
        href={resultsPagePath(latest.scanId)}
        data-testid="profile-latest-results"
      >
        <span className="profile-row-label">{copy.latestResultsLink}</span>
        <Chevron />
      </Link>
      {earlier.length > 0 && (
        <>
          <button
            type="button"
            className="profile-row profile-row-button profile-earlier-toggle"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="profile-row-label">
              {copy.earlierScans(earlier.length)}
            </span>
            <Chevron />
          </button>
          {open && (
            <ul
              id={listId}
              className="profile-rows profile-earlier"
              aria-label={copy.earlierScansLabel}
            >
              {earlier.map((scan) => (
                <li key={scan.scanId} className="profile-row">
                  <span className="profile-row-label">
                    {formatMonthDay(scan.createdAt, locale)} ·{" "}
                    {scan.hand === "left" ? copy.leftHand : copy.rightHand}
                  </span>
                  <span className="profile-row-value">
                    {copy.handLength}{" "}
                    {formatCm(shownAccountMeasurements(scan).handLengthMm)} ·{" "}
                    {copy.palmWidth}{" "}
                    {formatCm(shownAccountMeasurements(scan).palmWidthMm)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}

function MiceSection({
  copy,
  answers,
  mouseNames,
  latestScanId,
  handlers,
  ctx,
  onRetry,
}: {
  copy: AccountCopy;
  answers: AnswersState;
  mouseNames: Record<string, string>;
  latestScanId: string | null;
  handlers: ProfileHandlers;
  ctx: ProfileHandlerContext;
  onRetry: () => void;
}) {
  if (answers.kind === "loading") {
    return (
      <Section title={copy.miceHeading}>
        <p className="profile-muted" role="status" aria-busy="true">
          {copy.miceLoading}
        </p>
      </Section>
    );
  }
  if (answers.kind === "error") {
    return (
      <Section title={copy.miceHeading}>
        <p className="status-error" role="status">
          {copy.miceError}
        </p>
        <button
          type="button"
          className="button-secondary profile-retry"
          onClick={onRetry}
        >
          {copy.retry}
        </button>
      </Section>
    );
  }

  const data = answers.answers;
  const rows = mouseRows(data, mouseNames, copy);
  const others = otherAnswerRows(data, copy);

  if (!hasAnswers(data)) {
    return (
      <Section title={copy.miceHeading}>
        {latestScanId === null ? (
          <p className="profile-muted">{copy.noAnswersNoScan}</p>
        ) : (
          <div className="profile-empty">
            <h3>{copy.noAnswersTitle}</h3>
            <p>{copy.noAnswersBody}</p>
            {handlers.onOpenQuestionnaire && (
              <button
                type="button"
                className="profile-primary"
                onClick={() =>
                  handlers.onOpenQuestionnaire?.(latestScanId, ctx)
                }
              >
                {copy.answerQuestionnaire}
              </button>
            )}
          </div>
        )}
      </Section>
    );
  }

  return (
    <>
      <Section
        title={copy.miceHeading}
        aside={rows.length > 0 ? copy.miceCount(rows.length) : undefined}
      >
        {rows.length > 0 && (
          <ul className="profile-rows">
            {rows.map((row) => (
              <li key={row.key}>
                <MouseRowView
                  row={row}
                  copy={copy}
                  onEdit={
                    handlers.onEditMouse
                      ? () => handlers.onEditMouse?.(row.target, ctx)
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {handlers.onAddMouse && rows.length < MAX_ACCOUNT_MICE && (
          <button
            type="button"
            className="profile-row profile-text-button profile-add"
            onClick={() => handlers.onAddMouse?.(ctx)}
          >
            <PlusIcon />
            {copy.addMouse}
          </button>
        )}
      </Section>
      {others.length > 0 && (
        <Section title={copy.otherHeading}>
          <ul className="profile-rows">
            {others.map((row) => {
              const edit = handlers.onEditOtherAnswer;
              const field = row.key === "mainUse" ? "mainUse" : "feedback";
              const content = (
                <>
                  <span className="profile-row-label">{row.label}</span>
                  <span
                    className={`profile-row-value${
                      field === "feedback" ? " profile-row-ellipsis" : ""
                    }${row.empty ? " profile-row-empty" : ""}`}
                  >
                    {row.value}
                  </span>
                  {edit && <Chevron />}
                </>
              );
              return (
                <li key={row.key}>
                  {edit ? (
                    <button
                      type="button"
                      className="profile-row profile-row-button"
                      onClick={() => edit(field, ctx)}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="profile-row">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="profile-fine">{copy.feedbackNote}</p>
        </Section>
      )}
    </>
  );
}

function MouseRowView({
  row,
  copy,
  onEdit,
}: {
  row: MouseRow;
  copy: AccountCopy;
  onEdit?: () => void;
}) {
  const content = (
    <>
      <span className="profile-mouse-text">
        <span className="profile-mouse-name">{row.name}</span>
        <span className="profile-mouse-meta">
          {row.current && (
            <>
              <span className="profile-current">{copy.currentMouse}</span>
              {" · "}
            </>
          )}
          {row.meta}
        </span>
      </span>
      {onEdit && <Chevron />}
    </>
  );
  return onEdit ? (
    <button
      type="button"
      className="profile-row profile-row-button profile-mouse"
      onClick={onEdit}
    >
      {content}
    </button>
  ) : (
    <div className="profile-row profile-mouse">{content}</div>
  );
}
