// Logic behind vercel.json's `ignoreCommand` (scripts/vercel/ignore-build.mjs):
// should Vercel build this Git deployment at all?
//
// Why: every push to a branch used to create a preview deployment, drafts
// included. 406 deployments piled up in 9 days and the account's deployment
// storage neared its limit (Kirby, 2026-09-30). Previews are now built only
// for pull requests that are ready for review; `main` always builds.
//
// Vercel's contract for this command is inverted: exit 0 = skip the build,
// exit 1 = go ahead. `decide` returns "build" or "skip"; `ignoreBuildMain`
// turns that into the exit code.
//
// Rules (in order):
//   - OPEN_MOUSE_FORCE_PREVIEW=1    build. Lets Claude start a preview for a
//                                   PR that was marked ready without a push.
//   - VERCEL_ENV=production, or the branch is `main`   build.
//   - no VERCEL_GIT_PULL_REQUEST_ID skip: a branch without a PR.
//   - the PR, read from GitHub:
//       open and not a draft        build
//       a draft, or not open        skip
//   - GitHub cannot be read (network, rate limit, bad reply)   build. Failing
//     open costs one deployment; failing closed could silently leave a ready
//     PR without the preview its merge check waits for.
//
// Plain Node, no dependencies: it runs right after the clone, before
// `npm ci`. The repository is public, so the GitHub read needs no token.

export const DEFAULT_OWNER = "kirbyliu99M";
export const DEFAULT_REPO = "Open_Mouse";
const GITHUB_TIMEOUT_MS = 5000;

/**
 * @param {Record<string, string | undefined>} env
 * @param {{ draft?: unknown, state?: unknown } | null} pr  null = not read
 * @returns {{ action: "build" | "skip", reason: string }}
 */
export function decide(env, pr) {
  if (env.OPEN_MOUSE_FORCE_PREVIEW === "1") {
    return { action: "build", reason: "OPEN_MOUSE_FORCE_PREVIEW=1" };
  }
  if (env.VERCEL_ENV === "production" || env.VERCEL_GIT_COMMIT_REF === "main") {
    return { action: "build", reason: "production / main" };
  }
  if (!prNumber(env)) {
    return { action: "skip", reason: "branch has no pull request" };
  }
  if (pr === null) {
    return {
      action: "build",
      reason: "could not read the pull request from GitHub",
    };
  }
  if (pr.state !== "open") {
    return { action: "skip", reason: `pull request is ${String(pr.state)}` };
  }
  if (pr.draft !== false) {
    return { action: "skip", reason: "pull request is a draft" };
  }
  return { action: "build", reason: "pull request is ready for review" };
}

/** @param {Record<string, string | undefined>} env */
export function prNumber(env) {
  const id = (env.VERCEL_GIT_PULL_REQUEST_ID ?? "").trim();
  return /^[1-9]\d*$/.test(id) ? id : null;
}

/**
 * Reads the PR from the GitHub REST API. Any failure returns null, never throws.
 * @param {Record<string, string | undefined>} env
 * @param {typeof fetch} fetchImpl
 */
export async function readPullRequest(env, fetchImpl) {
  const id = prNumber(env);
  if (!id) return null;
  const owner = env.VERCEL_GIT_REPO_OWNER || DEFAULT_OWNER;
  const repo = env.VERCEL_GIT_REPO_SLUG || DEFAULT_REPO;
  try {
    const res = await fetchImpl(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${id}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "open-mouse-vercel-ignore",
        },
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const body = await res.json();
    if (body === null || typeof body !== "object") return null;
    return { draft: body.draft, state: body.state };
  } catch {
    return null;
  }
}

/**
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch,
 *           log?: (line: string) => void, exit?: (code: number) => void }} [io]
 */
export async function ignoreBuildMain(io = {}) {
  const env = io.env ?? process.env;
  const log = io.log ?? ((line) => console.log(line));
  const exit = io.exit ?? ((code) => process.exit(code));
  let result;
  try {
    const pr = await readPullRequest(env, io.fetchImpl ?? fetch);
    result = decide(env, pr);
  } catch (err) {
    // Unexpected bug in this script: build rather than silently skip.
    result = {
      action: "build",
      reason: `ignore script failed (${err instanceof Error ? err.name : "error"})`,
    };
  }
  log(`vercel ignoreCommand: ${result.action} (${result.reason})`);
  exit(result.action === "skip" ? 0 : 1);
}
