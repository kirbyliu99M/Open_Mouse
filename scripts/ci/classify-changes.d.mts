// Types for classify-changes.mjs (tsconfig has allowJs off, so the .mjs itself is
// untyped to `tsc`; this file lets tests/unit/ci-classify.test.ts import it).

export interface Classification {
  heavy: boolean;
  e2e: boolean;
  reason: string;
}

export function isDocsOnlyPath(path: string): boolean;

export function classify(input: {
  event: string;
  paths: readonly string[] | null;
  problem?: string;
}): Classification;

export function readChangedPaths(
  base: string | undefined,
  cwd?: string,
): { paths: string[] } | { paths: null; problem: string };

export function main(
  env?: Record<string, string | undefined>,
  cwd?: string,
): Classification;
