/**
 * The tester shots keep the DAY only, in Asia/Taipei (contract
 * src/lib/contracts/tester.ts), as `YYYY-MM-DD`. Pure.
 */
const TAIPEI_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `now` as an Asia/Taipei calendar date, `YYYY-MM-DD`. */
export function taipeiDay(now: Date): string {
  return TAIPEI_DATE.format(now);
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `day` moved by `days` calendar days (negative goes back). */
export function addDays(day: string, days: number): string {
  const m = DAY.exec(day);
  if (!m || !Number.isInteger(days)) throw new RangeError("Not a day.");
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}
