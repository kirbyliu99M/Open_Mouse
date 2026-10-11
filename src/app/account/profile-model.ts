/**
 * Pure helpers of the profile page 「我的檔案」: what `AccountView` shows from
 * the person's scans and from their questionnaire answers
 * (`GET /api/survey`, `surveyMineResponseSchema`). No React, no I/O, no clock:
 * every sentence comes from the copy table, every number is computed here
 * (hard rule 2), and a date is formatted in Asia/Taipei so the server render
 * and the browser agree.
 */
import type { Locale } from "@/lib/contracts/locale";
import type { SurveyMineResponse } from "@/lib/contracts/survey";
import type { AccountCopy } from "@/lib/copy/account";
import type { AccountScan } from "@/server/account/repo";

const NBSP = String.fromCharCode(0xa0);

/** Where answers are read from, as the page knows it. */
export type AnswersState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; answers: SurveyMineResponse };

/** What a tap on a row of 我的滑鼠 refers to (the edit sheet is built elsewhere). */
export type MouseTarget =
  { kind: "rating"; slug: string } | { kind: "other"; brand: string };

/** A row of 我的滑鼠, ready to render. */
export interface MouseRow {
  key: string;
  target: MouseTarget;
  name: string;
  current: boolean;
  /** `滿意 4/5 · 使用 6–12 個月`, or the size feel of a brand-only answer. */
  meta: string;
}

/** A label/value pair of 我的手 or 其他回答. */
export interface ValueRow {
  key: string;
  label: string;
  value: string;
}

/** Millimetres as centimetres with one decimal and a no-break space: 186 -> "18.6 cm". */
export function formatCm(mm: number): string {
  return `${(Math.round(mm) / 10).toFixed(1)}${NBSP}cm`;
}

/** "10/12" in Taiwan time (zh-TW), "Oct 12" in English. */
export function formatMonthDay(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat(
    locale === "zh-TW" ? "zh-TW" : "en-US",
    {
      timeZone: "Asia/Taipei",
      month: locale === "zh-TW" ? "numeric" : "short",
      day: "numeric",
    },
  ).formatToParts(date);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return locale === "zh-TW" ? `${month}/${day}` : `${month} ${day}`;
}

/** The newest scan and the ones before it. `AccountRepo.listScans` is newest first. */
export function splitScans(scans: readonly AccountScan[]): {
  latest: AccountScan | null;
  earlier: AccountScan[];
} {
  const sorted = [...scans].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
  return { latest: sorted[0] ?? null, earlier: sorted.slice(1) };
}

/**
 * The rows of 我的手 for one scan: hand length and palm width always, grip and
 * palm thickness only when the person stated them (both are nullable, and a
 * skipped answer is never shown as a value).
 */
export function handRows(scan: AccountScan, copy: AccountCopy): ValueRow[] {
  const rows: ValueRow[] = [
    {
      key: "handLength",
      label: copy.handLength,
      value: formatCm(scan.measurements.handLengthMm),
    },
    {
      key: "palmWidth",
      label: copy.palmWidth,
      value: formatCm(scan.measurements.palmWidthMm),
    },
  ];
  if (scan.gripStyleStated !== null) {
    rows.push({
      key: "grip",
      label: copy.gripRow,
      value: copy.grip[scan.gripStyleStated],
    });
  }
  if (scan.palmThicknessStated !== null) {
    rows.push({
      key: "thickness",
      label: copy.thicknessRow,
      value: copy.thickness[scan.palmThicknessStated],
    });
  }
  return rows;
}

/** "Brand Model", without saying the brand twice when the model already starts with it. */
export function mouseDisplayName(brand: string, model: string): string {
  const b = brand.trim();
  const m = model.trim();
  if (b === "") return m;
  if (m === "") return b;
  return m.toLowerCase().startsWith(b.toLowerCase()) ? m : `${b} ${m}`;
}

/** Catalogue rows as `{ slug: "Brand Model" }`, for naming the mice a person rated. */
export function mouseNamesFromRows(
  rows: readonly { slug: string; brand: string; model: string }[],
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const row of rows) {
    names[row.slug] = mouseDisplayName(row.brand, row.model);
  }
  return names;
}

/** Brands people can pick for a mouse that is not in the catalogue, as the brand writes itself. */
const BRAND_NAMES: Record<string, string> = {
  logitech: "Logitech",
  razer: "Razer",
  steelseries: "SteelSeries",
  corsair: "Corsair",
  hyperx: "HyperX",
  asus: "ASUS",
  msi: "MSI",
  acer: "Acer",
  zowie: "ZOWIE",
  glorious: "Glorious",
  pulsar: "Pulsar",
  finalmouse: "Finalmouse",
  vaxee: "VAXEE",
  endgame_gear: "Endgame Gear",
  cooler_master: "Cooler Master",
  microsoft: "Microsoft",
  apple: "Apple",
  hp: "HP",
  dell: "Dell",
  lenovo: "Lenovo",
  xiaomi: "Xiaomi",
  anker: "Anker",
  elecom: "ELECOM",
  kensington: "Kensington",
};

/** The name of a brand slug; `other` and an unknown slug read as the generic words. */
export function brandName(slug: string, copy: AccountCopy): string {
  return BRAND_NAMES[slug] ?? copy.otherBrand;
}

/** `滿意 4/5 · 使用 6–12 個月`; the duration part is left out when not given. */
export function ratingMeta(
  satisfaction: number,
  duration: keyof AccountCopy["durations"] | undefined,
  copy: AccountCopy,
): string {
  const parts = [copy.satisfaction(satisfaction)];
  if (duration !== undefined) parts.push(copy.used(copy.durations[duration]));
  return parts.join(" · ");
}

/**
 * The rows of 我的滑鼠: catalogue mice first (the current one on top, then the
 * order the server gave), then answers that only name a brand. `names` maps a
 * catalogue slug to "Brand Model"; a slug with no entry shows as itself.
 */
export function mouseRows(
  answers: SurveyMineResponse,
  names: Readonly<Record<string, string>>,
  copy: AccountCopy,
): MouseRow[] {
  const rated: MouseRow[] = answers.ratings.map((r) => ({
    key: `rating:${r.slug}`,
    target: { kind: "rating", slug: r.slug },
    name: names[r.slug] ?? r.slug,
    current: r.current,
    meta: ratingMeta(r.satisfaction, r.duration, copy),
  }));
  const others: MouseRow[] = answers.otherMice.map((o) => ({
    key: `other:${o.brand}`,
    target: { kind: "other", brand: o.brand },
    name: copy.otherModel(brandName(o.brand, copy)),
    current: o.current,
    meta: copy.sizeFeel(copy.sizeFeels[o.sizeFeel]),
  }));
  const all = [...rated, ...others];
  // A stable partition: the current mouse leads, the rest keep their order.
  return [...all.filter((r) => r.current), ...all.filter((r) => !r.current)];
}

/** The rows of 其他回答: main use and the comment (as one line; the page ellipsises it). */
export function otherAnswerRows(
  answers: SurveyMineResponse,
  copy: AccountCopy,
): ValueRow[] {
  const rows: ValueRow[] = [];
  if (answers.mainUse !== null) {
    rows.push({
      key: "mainUse",
      label: copy.mainUseRow,
      value: copy.mainUses[answers.mainUse],
    });
  }
  const feedback = answers.feedback?.replace(/\s+/g, " ").trim() ?? "";
  if (feedback !== "") {
    rows.push({ key: "feedback", label: copy.feedbackRow, value: feedback });
  }
  return rows;
}

/** True when the person has answered anything at all. */
export function hasAnswers(answers: SurveyMineResponse): boolean {
  return (
    answers.ratings.length > 0 ||
    answers.otherMice.length > 0 ||
    answers.mainUse !== null ||
    (answers.feedback ?? "").trim() !== ""
  );
}

/** The nickname's limit in characters (candidate, from the frame's "2/20"). */
export const NICKNAME_MAX = 20;

/** Characters as a person counts them: a code point, not a UTF-16 unit. */
export function nicknameLength(value: string): number {
  return Array.from(value.trim()).length;
}

/** Whether Save is allowed: not empty, within the limit, and different from what is saved. */
export function canSaveNickname(draft: string, saved: string): boolean {
  const length = nicknameLength(draft);
  return length > 0 && length <= NICKNAME_MAX && draft.trim() !== saved.trim();
}
