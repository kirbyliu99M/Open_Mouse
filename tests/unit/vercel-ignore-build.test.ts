import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
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

  it("builds whenever OPEN_MOUSE_FORCE_PREVIEW=1, even for a draft", () => {
    expect(
      decide(
        { ...WITH_PR, OPEN_MOUSE_FORCE_PREVIEW: "1" },
        { draft: true, state: "open" },
      ).action,
    ).toBe("build");
    expect(
      decide({ ...PREVIEW, OPEN_MOUSE_FORCE_PREVIEW: "1" }, null).action,
    ).toBe("build");
    expect(
      decide({ ...PREVIEW, OPEN_MOUSE_FORCE_PREVIEW: "true" }, null).action,
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
  });
});
