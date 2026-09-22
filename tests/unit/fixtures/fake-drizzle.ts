import { vi } from "vitest";

/**
 * A minimal stand-in for Drizzle's fluent query builder, for unit-testing a
 * `*-drizzle-repo.ts` module's control flow and row-shaping without a real
 * database (AGENTS.md: no real DB in unit tests). Every chaining method
 * returns the same object, so any call order the code under test uses
 * works, and the object is itself thenable — resolving to `rows` — so
 * `await db.select(...).from(...)` resolves even when the code never calls
 * a terminal method like `.limit()`.
 *
 * Callers cast this (via `unknown`) to whichever repo factory's `db`
 * parameter type they need — the real type is Drizzle's large generated
 * `NeonHttpDatabase<Schema>`, which this intentionally does not attempt to
 * satisfy structurally.
 */
export interface FakeDrizzleChain {
  select: (...args: unknown[]) => FakeDrizzleChain;
  from: (...args: unknown[]) => FakeDrizzleChain;
  innerJoin: (...args: unknown[]) => FakeDrizzleChain;
  where: (...args: unknown[]) => FakeDrizzleChain;
  limit: (...args: unknown[]) => Promise<unknown[]>;
  insert: (...args: unknown[]) => FakeDrizzleChain;
  values: (...args: unknown[]) => FakeDrizzleChain;
  onConflictDoUpdate: (...args: unknown[]) => Promise<void>;
  /** Same shape as `PromiseLike<unknown[]>.then`, so `await chain` works. */
  then: <TResult1 = unknown[], TResult2 = never>(
    onfulfilled?:
      ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>;
}

export function fakeDrizzleChain(rows: unknown[] = []): FakeDrizzleChain {
  const chain: FakeDrizzleChain = {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
    insert: vi.fn(() => chain),
    values: vi.fn(() => chain),
    onConflictDoUpdate: vi.fn(() => Promise.resolve(undefined)),
    then: (onfulfilled, onrejected) =>
      Promise.resolve(rows).then(onfulfilled, onrejected),
  };
  return chain;
}
