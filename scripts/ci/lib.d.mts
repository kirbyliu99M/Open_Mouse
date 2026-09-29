// Types for lib.mjs (tsconfig has allowJs off, so the .mjs itself is untyped to
// `tsc`; this file lets tests/unit/ci-classify.test.ts import it).

export interface Classification {
  heavy: boolean;
  e2e: boolean;
  reason: string;
}

export type GitRunner = (args: string[], cwd: string) => string;

export interface Invocation {
  command: string;
  args: string[];
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
  run?: GitRunner,
): { paths: string[] } | { paths: null; problem: string };

export function parseNulList(text: string): string[];

export function classifyMain(
  env?: Record<string, string | undefined>,
  cwd?: string,
): Classification;

export function existingFiles(paths: readonly string[], cwd?: string): string[];

export function prettierVersion(packageJsonText: string): string;

export function prettierInvocation(input: {
  version: string;
  files: readonly string[];
  platform?: string;
  execPath?: string;
  exists?: (path: string) => boolean;
}): Invocation;

export function prettierMain(
  env?: Record<string, string | undefined>,
  cwd?: string,
  run?: (invocation: Invocation, cwd: string) => number,
): number;
