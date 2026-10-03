// Types for lib.mjs (tsconfig has allowJs off; this file lets
// tests/unit/vercel-ignore-build.test.ts import it).

export type Env = Record<string, string | undefined>;

export interface Decision {
  action: "build" | "skip";
  reason: string;
}

export const DEFAULT_OWNER: string;
export const DEFAULT_REPO: string;
export const GITHUB_TIMEOUT_MS: number;

export function decide(
  env: Env,
  pr: { draft?: unknown; state?: unknown } | null,
): Decision;

export function prNumber(env: Env): string | null;

export function readPullRequest(
  env: Env,
  fetchImpl: typeof fetch,
): Promise<{ draft: unknown; state: unknown } | null>;

export function ignoreBuildMain(io?: {
  env?: Env;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
  exit?: (code: number) => void;
  decideImpl?: typeof decide;
}): Promise<void>;
