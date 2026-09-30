import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  GITHUB_TIMEOUT_MS,
  decide,
  ignoreBuildMain,
  prNumber,
  readPullRequest,
} from "../../scripts/vercel/lib.mjs";

const PREVIEW = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature" };
const WITH_PR = { ...PREVIEW, VERCEL_GIT_PULL_REQUEST_ID: "92" };

function reply(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

async function run(env: Record<string, string>, fetchImpl: typeof fetch) {
  const log = vi.fn();
  const exit = vi.fn();
  await ignoreBuildMain({ env, fetchImpl, log, exit });
  return {
    code: exit.mock.calls[0]?.[0],
    line: String(log.mock.calls[0]?.[0]),
  };
}

describe("decide", () => {
  it("always builds production and main", () => {
    expect(decide({ VERCEL_ENV: "production" }, null).action).toBe("build");
    expect(
      decide({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "main" }, null)
        .action,
    ).toBe("build");
  });

  it("skips a branch without a pull request", () => {
    expect(decide(PREVIEW, null)).toEqual({
      action: "skip",
      reason: "branch has no pull request",
    });
    expect(
      decide({ ...PREVIEW, VERCEL_GIT_PULL_REQUEST_ID: "" }, null).action,
    ).toBe("skip");
  });

  it("builds a ready PR and skips a draft or a closed one", () => {
    expect(decide(WITH_PR, { draft: false, state: "open" }).action).toBe(
      "build",
    );
    expect(decide(WITH_PR, { draft: true, state: "open" }).action).toBe("skip");
    expect(decide(WITH_PR, { draft: false, state: "closed" }).action).toBe(
      "skip",
    );
  });

  it("treats a missing or odd draft flag as a draft", () => {
    expect(decide(WITH_PR, { state: "open" }).action).toBe("skip");
    expect(decide(WITH_PR, { draft: "false", state: "open" }).action).toBe(
      "skip",
    );
  });

  it("fails open when GitHub could not be read", () => {
    expect(decide(WITH_PR, null).action).toBe("build");
  });

  it("ignores the removed OPEN_MOUSE_FORCE_PREVIEW flag", () => {
    expect(
      decide(
        { ...WITH_PR, OPEN_MOUSE_FORCE_PREVIEW: "1" },
        { draft: true, state: "open" },
      ).action,
    ).toBe("skip");
  });
});

describe("prNumber", () => {
  it("accepts only a positive integer", () => {
    expect(prNumber({ VERCEL_GIT_PULL_REQUEST_ID: " 92 " })).toBe("92");
    for (const bad of ["", "0", "-1", "92a", "../1", undefined]) {
      expect(prNumber({ VERCEL_GIT_PULL_REQUEST_ID: bad })).toBeNull();
    }
  });
});

describe("readPullRequest", () => {
  it("asks GitHub for the PR of this repository", async () => {
    const fetchImpl = reply(200, { draft: true, state: "open", title: "x" });
    await expect(readPullRequest(WITH_PR, fetchImpl)).resolves.toEqual({
      draft: true,
      state: "open",
    });
    expect(vi.mocked(fetchImpl).mock.calls[0][0]).toBe(
      "https://api.github.com/repos/kirbyliu99M/Open_Mouse/pulls/92",
    );
  });

  it("uses Vercel's repo owner and slug when present", async () => {
    const fetchImpl = reply(200, { draft: false, state: "open" });
    await readPullRequest(
      { ...WITH_PR, VERCEL_GIT_REPO_OWNER: "o", VERCEL_GIT_REPO_SLUG: "r" },
      fetchImpl,
    );
    expect(vi.mocked(fetchImpl).mock.calls[0][0]).toBe(
      "https://api.github.com/repos/o/r/pulls/92",
    );
  });

  it("returns null, never throws, on any failure", async () => {
    await expect(
      readPullRequest(WITH_PR, reply(403, { message: "rate limit" })),
    ).resolves.toBeNull();
    await expect(
      readPullRequest(WITH_PR, reply(200, null)),
    ).resolves.toBeNull();
    const broken = vi.fn(async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    await expect(readPullRequest(WITH_PR, broken)).resolves.toBeNull();
    const notJson = vi.fn(
      async () => new Response("<html>", { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(readPullRequest(WITH_PR, notJson)).resolves.toBeNull();
  });

  it("treats a 200 reply that is not a PR as unreadable (null, so build)", async () => {
    for (const body of [
      {},
      [],
      { state: "open" },
      { state: "open", draft: "false" },
      { draft: false },
    ]) {
      await expect(
        readPullRequest(WITH_PR, reply(200, body)),
      ).resolves.toBeNull();
    }
  });

  it("refuses an odd owner or slug without calling GitHub", async () => {
    for (const bad of [
      { VERCEL_GIT_REPO_OWNER: "a/b" },
      { VERCEL_GIT_REPO_SLUG: "r?x=1" },
      { VERCEL_GIT_REPO_OWNER: ".. " },
    ]) {
      const fetchImpl = reply(200, { draft: false, state: "open" });
      await expect(
        readPullRequest({ ...WITH_PR, ...bad }, fetchImpl),
      ).resolves.toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("sends GitHub's required headers and a timeout signal", async () => {
    const fetchImpl = reply(200, { draft: false, state: "open" });
    await readPullRequest(WITH_PR, fetchImpl);
    const init = vi.mocked(fetchImpl).mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({
      accept: "application/vnd.github+json",
      "user-agent": "open-mouse-vercel-ignore",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(GITHUB_TIMEOUT_MS).toBe(5000);
  });

  it("returns null when the request times out", async () => {
    const timedOut = vi.fn(async () => {
      throw new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      );
    }) as unknown as typeof fetch;
    await expect(readPullRequest(WITH_PR, timedOut)).resolves.toBeNull();
  });

  it("drains the body of a failed reply", async () => {
    const cancel = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      body: { cancel },
    })) as unknown as typeof fetch;
    await expect(readPullRequest(WITH_PR, fetchImpl)).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not call GitHub without a PR number", async () => {
    const fetchImpl = reply(200, {});
    await expect(readPullRequest(PREVIEW, fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ignoreBuildMain: Vercel's inverted exit code", () => {
  it("exits 0 (skip) for a draft and 1 (build) for a ready PR", async () => {
    expect(
      (await run(WITH_PR, reply(200, { draft: true, state: "open" }))).code,
    ).toBe(0);
    expect(
      (await run(WITH_PR, reply(200, { draft: false, state: "open" }))).code,
    ).toBe(1);
  });

  it("exits 1 (build) for production and when GitHub fails", async () => {
    expect((await run({ VERCEL_ENV: "production" }, reply(500, {}))).code).toBe(
      1,
    );
    expect((await run(WITH_PR, reply(500, {}))).code).toBe(1);
  });

  it("builds (exit 1) when the script itself fails", async () => {
    const log = vi.fn();
    const exit = vi.fn();
    await ignoreBuildMain({
      env: WITH_PR,
      fetchImpl: reply(200, { draft: true, state: "open" }),
      log,
      exit,
      decideImpl: () => {
        throw new RangeError("bug");
      },
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(
      "vercel ignoreCommand: build (ignore script failed (RangeError))",
    );
  });

  it("logs one line naming the decision", async () => {
    const { line } = await run(PREVIEW, reply(200, {}));
    expect(line).toBe(
      "vercel ignoreCommand: skip (branch has no pull request)",
    );
  });
});

describe("wiring", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));

  it("vercel.json runs the script as its ignoreCommand", () => {
    const config = JSON.parse(readFileSync(`${root}vercel.json`, "utf8"));
    expect(config.ignoreCommand).toBe("node scripts/vercel/ignore-build.mjs");
  });

  it("the real script skips a branch without a PR (exit 0) and builds production (exit 1)", () => {
    const script = `${root}scripts/vercel/ignore-build.mjs`;
    const base: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
    };
    const skip = spawnSync(process.execPath, [script], {
      env: { ...base, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature" },
      encoding: "utf8",
    });
    expect(skip.status).toBe(0);
    expect(skip.stdout).toContain("skip (branch has no pull request)");
    const build = spawnSync(process.execPath, [script], {
      env: { ...base, VERCEL_ENV: "production" },
      encoding: "utf8",
    });
    expect(build.status).toBe(1);
    // The fail-open path, through the real exit code (process.exitCode),
    // without the network: an odd owner name is refused before any request.
    const failOpen = spawnSync(process.execPath, [script], {
      env: {
        ...base,
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feature",
        VERCEL_GIT_PULL_REQUEST_ID: "7",
        VERCEL_GIT_REPO_OWNER: "not/valid",
      },
      encoding: "utf8",
    });
    expect(failOpen.status).toBe(1);
    expect(failOpen.stdout).toContain(
      "build (could not read the pull request from GitHub)",
    );
  });
});
