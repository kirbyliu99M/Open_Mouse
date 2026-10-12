import type { GripStyle } from "../../lib/contracts/fit";
import type {
  MainUse,
  OtherMouseBrand,
  PainPoint,
  SizeFeel,
  UseDuration,
} from "../../lib/contracts/survey";

/** One catalogue rating, with the mouse already resolved to its `mice.id`. */
export interface ContributionRating {
  mouseId: string;
  satisfaction: number;
  duration: UseDuration | null;
  painPoints: PainPoint[];
  isCurrent: boolean;
}

/**
 * A mouse outside the catalogue. The brand is a slug from the contract's
 * `OTHER_MOUSE_BRANDS`, already validated by the body schema, and is stored and
 * compared exactly as given (every brand that is not listed is `other`).
 */
export interface ContributionOtherMouse {
  brand: OtherMouseBrand;
  sizeFeel: SizeFeel;
  isCurrent: boolean;
}

/**
 * Everything one accepted submission writes, in one piece. Built by
 * `buildContributionWrite` (./profile.ts) from the validated body and the
 * scan read on the server; nothing in it comes from the client except the
 * answers themselves.
 */
export interface ContributionWrite {
  /**
   * The scan this contribution came from. Used ONLY to set the scan's
   * `survey_contributed_at` mark (and to refuse a second contribution for the
   * same scan); no row of the contribution stores it.
   */
  scanId: string;
  /** The signed-in contributor, or null for an anonymous contribution. */
  userId: string | null;
  consentVersion: string;
  /** Start of the UTC day of the consent: nothing finer is kept (see schema.ts). */
  consentedAt: Date;
  /** The exact instant, written to the scan's mark only; it goes with the scan. */
  markedAt: Date;
  /** Hand length rounded DOWN to `CONTRIBUTION_BIN_MM`. */
  handLengthBinMm: number;
  /** Palm width rounded DOWN to `CONTRIBUTION_BIN_MM`. */
  palmWidthBinMm: number;
  gripStyle: GripStyle;
  mainUse: MainUse | null;
  feedback: string | null;
  ratings: ContributionRating[];
  otherMouse: ContributionOtherMouse | null;
}

/**
 * - `stored`: the contribution is in, and the scan is marked.
 * - `already_contributed`: the scan was marked already; nothing was written or
 *   replaced (409).
 * - `scan_gone`: the scan no longer exists (deleted or expired between the
 *   ownership check and the write); nothing was written (404).
 */
export type RecordContributionResult =
  "stored" | "already_contributed" | "scan_gone";

/**
 * What `PUT /api/survey` writes: the caller's whole set of answers after the
 * edit (`surveyEditSchema`), with every catalogue mouse already resolved to its
 * `mice.id`. Built by `buildAnswersWrite` (./profile.ts). There is no scan, no
 * consent and no hand profile in it: an edit never carries any.
 */
export interface AnswersWrite {
  mainUse: MainUse | null;
  /** The comment of the account's latest contribution; null clears it. */
  feedback: string | null;
  ratings: ContributionRating[];
  otherMice: ContributionOtherMouse[];
}

/**
 * - `stored`: the answers are replaced.
 * - `no_contribution`: the account has no contribution (none ever, or it was
 *   withdrawn between the request's checks and the write); nothing was changed.
 */
export type ReplaceAnswersResult = "stored" | "no_contribution";

/**
 * A signed-in person's own answers as the database holds them, for
 * `GET /api/survey`. A rating carries the slug of its CURRENT `mice` row. The
 * values are the database's text columns; the service's response schema is what
 * decides whether each one is a value the contract knows.
 */
export interface StoredAnswers {
  mainUse: string | null;
  feedback: string | null;
  ratings: {
    slug: string;
    satisfaction: number;
    duration: string | null;
    painPoints: PainPoint[];
    isCurrent: boolean;
  }[];
  otherMice: { brand: string; sizeFeel: string; isCurrent: boolean }[];
}

/**
 * The DB seam for the survey routes. Route handlers wire `drizzle-repo.ts`'s
 * real implementation; unit tests inject an in-memory fake, and the same
 * behaviour matrix runs against the real repo on PGlite
 * (tests/unit/survey-repo.test.ts), so the two cannot drift apart.
 */
export interface SurveyRepo {
  /** `mice.id` for each catalogue slug that exists; an unknown slug is absent. */
  findMouseIdsBySlug(slugs: readonly string[]): Promise<Map<string, string>>;

  /**
   * Writes the contribution, its ratings and its other mouse, and sets the
   * scan's mark, ALL OR NOTHING: if any part fails the method throws and
   * nothing is left behind, the scan unmarked.
   *
   * The one-contribution-per-scan rule is decided here, inside that same
   * all-or-nothing write, not in a check before it, so two submissions for the
   * same scan at the same instant cannot both be stored.
   *
   * For a signed-in contributor (`userId` set) the write also applies the
   * repeat rules of src/lib/contracts/survey.ts:
   *  - a rating of a catalogue mouse the person already rated replaces it;
   *  - when this write marks a mouse as current (a rating or the other mouse),
   *    the person's earlier current marker, on a rating or an other mouse, is
   *    cleared; when it marks none, the earlier one stays, also when it sits on
   *    the very rating or other mouse this write replaces (the replacement does
   *    not take the marker away: survey.ts, "marks none leaves it where it was");
   *  - `mainUse`, when given, replaces the person's earlier answer (which is
   *    emptied); when this write gives none, the earlier answer stays;
   *  - an other mouse whose brand slug equals an earlier one of theirs (an
   *    exact match) replaces it; a new slug is added, so a person keeps at most
   *    one answer for `other`;
   *  - `feedback` is kept as written, every time.
   * An anonymous contribution replaces nothing.
   */
  recordContribution(
    write: ContributionWrite,
  ): Promise<RecordContributionResult>;

  /**
   * Deletes every contribution of `userId` (their ratings and other mice go
   * with them) and returns how many contributions that was; 0 when there was
   * nothing. The marks on their scans stay: they are not contributions.
   */
  withdrawContributions(userId: string): Promise<number>;

  /**
   * The caller's own answers, whole: every rating and other mouse of the
   * account (the current marker included), the account's `mainUse` and the
   * comment of its latest contribution. "Latest" is the contribution with the
   * newest `consented_at` (a contribution keeps no instant finer than a day, so
   * two of the same UTC day tie and the larger id wins: stable, not
   * chronological). `mainUse` is the account's latest non-empty one (the repeat
   * rules keep at most one). Nothing kept: empty lists and nulls.
   */
  readAnswers(userId: string): Promise<StoredAnswers>;

  /**
   * Replaces the signed-in `userId`'s answers with exactly `write`, ALL OR
   * NOTHING, and never touches a hand profile, a grip, a consent record or a
   * scan's mark:
   *  - ratings and other mice the person had and `write` leaves out are
   *    removed; those it names are set to what it says, the current marker
   *    included (so "no current mouse" is possible);
   *  - a rating or other mouse the person already had keeps the contribution
   *    (and so the hand profile) it was given with; a new one is attached to
   *    the latest contribution;
   *  - `mainUse` is emptied on every contribution of the person, then set on
   *    the latest one when `write` has one;
   *  - the latest contribution's comment is set to `write.feedback` (null
   *    clears it); the comments of earlier contributions are left as written.
   * With no contribution it changes nothing and returns `no_contribution`.
   * Two edits at once end as one of the two, never a mix: the write takes a
   * row lock on the latest contribution first, like `recordContribution` does
   * on the scan.
   */
  replaceAnswers(
    userId: string,
    write: AnswersWrite,
  ): Promise<ReplaceAnswersResult>;
}
