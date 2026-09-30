import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prettierMain } from "../../scripts/ci/lib.mjs";

// `spawnSync` is stubbed for the whole file, so nothing here starts a process.
// (The real processes, with a fake npx on PATH, are in ci-classify.test.ts.)
vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
  execFileSync: vi.fn(),
}));

/**
 * The default runner of prettier-changed-docs.mjs (`runInherit`): what it turns
 * the outcome of the Prettier process into. It is the last line of defence of
 * the only check a docs-only PR gets, so a wrong mapping is a red change that
 * goes green:
 *
 *   - Prettier could not be started at all  -> exit 1, never 0.
 *   - Prettier was killed by a signal (status null, no error) -> exit 1, never 0.
 *   - otherwise Prettier's own exit status, unchanged.
 */
describe("prettierMain's default runner (spawnSync stubbed)", () => {
  const spawn = vi.mocked(spawnSync);
  let dir: string;
  let env: { CHANGED_FILE: string };
  let logs: string[];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ci-prettier-runner-"));
    mkdirSync(join(dir, "docs"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { prettier: "9.9.9" } }),
    );
    writeFileSync(join(dir, "README.md"), "# Hi\n");
    writeFileSync(join(dir, "list.bin"), "README.md\0");
    env = { CHANGED_FILE: join(dir, "list.bin") };
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    logs = [];
    const keep = (...args: unknown[]) => void logs.push(args.join(" "));
    vi.spyOn(console, "log").mockImplementation(keep);
    vi.spyOn(console, "error").mockImplementation(keep);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    spawn.mockReset();
  });

  /** What spawnSync returns for a finished, killed or unstartable child. */
  const outcome = (result: Record<string, unknown>) =>
    spawn.mockReturnValue(result as unknown as ReturnType<typeof spawnSync>);

  it.each([0, 1, 2, 3])(
    "Prettier's exit status %i comes back unchanged",
    (status) => {
      outcome({ status, signal: null });
      expect(prettierMain(env, dir)).toBe(status);
    },
  );

  it.each([
    ["killed by a signal (status null)", { status: null, signal: "SIGKILL" }],
    ["no status at all", { status: undefined }],
  ])("Prettier %s: exit 1, never 0", (_name, result) => {
    outcome(result);
    expect(prettierMain(env, dir)).toBe(1);
  });

  it("Prettier cannot be started: exit 1, never 0, and the error is printed", () => {
    outcome({
      status: null,
      error: new Error("spawn npx ENOENT"),
    });
    expect(prettierMain(env, dir)).toBe(1);
    expect(logs.join("\n")).toMatch(/could not run .*spawn npx ENOENT/);
  });

  it("an error wins over a status of 0", () => {
    outcome({ status: 0, error: new Error("spawn npx EACCES") });
    expect(prettierMain(env, dir)).toBe(1);
  });

  it("runs it in the project directory with the child's output inherited", () => {
    outcome({ status: 0 });
    prettierMain(env, dir);
    expect(spawn).toHaveBeenCalledTimes(1);
    const [, args, options] = spawn.mock.calls[0]!;
    expect(options).toMatchObject({ cwd: dir, stdio: "inherit" });
    expect(args).toEqual(
      expect.arrayContaining([
        "--yes",
        "prettier@9.9.9",
        "--check",
        "--ignore-unknown",
        "README.md",
      ]),
    );
  });

  it("does not start Prettier when there is nothing to check", () => {
    writeFileSync(join(dir, "only-deleted.bin"), "docs/gone.md\0");
    expect(
      prettierMain({ CHANGED_FILE: join(dir, "only-deleted.bin") }, dir),
    ).toBe(0);
    expect(spawn).not.toHaveBeenCalled();
  });
});
