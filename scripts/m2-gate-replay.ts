/**
 * M2 gate replay: runs the real /scan pipeline (in a real headless
 * browser, via Playwright) over Kirby's ground-truth top-down photos and
 * prints repeatability and accuracy against a ruler-measured truth file.
 *
 *   npm run m2:gate-replay
 *
 * NEVER runs in CI, and refuses to (docs/PLAN.md §M2: "the photos live
 * outside the repo (../Fixtures/hands/) and the script never runs in CI,
 * which keeps the privacy promise even for our own test data"). Fixture
 * layout, one directory per session:
 *
 *   ../Fixtures/hands/truth.json         { "handLengthMm": 190, "palmWidthMm": 88 }
 *   ../Fixtures/hands/<session>/top-1.jpg
 *   ../Fixtures/hands/<session>/top-2.jpg
 *   ...
 *
 * For each photo: launches /scan, uploads it, reads the resulting
 * measurements straight out of the DOM (the same
 * `data-testid="scan-measurements-json"` element `tests/e2e/scan.spec.ts`
 * would use), and prints hand length. Per session it then prints
 * repeatability (max − min hand length across that session's photos) and
 * error against `truth.handLengthMm`. A photo that fails a gate (retake
 * needed) is reported, not silently skipped, and excluded from the
 * repeatability/error numbers.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium } from "@playwright/test";

if (process.env.CI) {
  console.error(
    "m2-gate-replay uploads real hand photos to a real browser and must never run in CI.",
  );
  process.exit(1);
}

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const hand = (arg("--hand") as "left" | "right" | undefined) ?? "right";
const port = Number(arg("--port") ?? 3400);
const baseUrl = `http://127.0.0.1:${port}`;

const FIXTURES_DIR = resolve(process.cwd(), "..", "Fixtures", "hands");
const TRUTH_PATH = join(FIXTURES_DIR, "truth.json");

interface Truth {
  readonly handLengthMm: number;
  readonly palmWidthMm: number;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!existsSync(FIXTURES_DIR)) {
  fail(
    `Fixture directory not found at ${FIXTURES_DIR}.\n` +
      "It lives beside the repo (never inside it) — see this script's header comment for the expected layout.",
  );
}

if (!existsSync(TRUTH_PATH)) {
  fail(
    `${TRUTH_PATH} not found. Expected { "handLengthMm": <ruler mm>, "palmWidthMm": <ruler mm> }.`,
  );
}

let truth: Truth;
try {
  truth = JSON.parse(readFileSync(TRUTH_PATH, "utf8")) as Truth;
} catch (err) {
  fail(`${TRUTH_PATH} isn't valid JSON: ${(err as Error).message}`);
}
if (typeof truth.handLengthMm !== "number") {
  fail(`${TRUTH_PATH} is missing a numeric "handLengthMm".`);
}

const sessionDirs = readdirSync(FIXTURES_DIR).filter((name) => {
  const full = join(FIXTURES_DIR, name);
  return statSync(full).isDirectory();
});

if (sessionDirs.length === 0) {
  fail(
    `No session directories found under ${FIXTURES_DIR}. Expected one subdirectory per photo session, each containing top-*.jpg files.`,
  );
}

const sessions = sessionDirs
  .map((session) => {
    const dir = join(FIXTURES_DIR, session);
    const photos = readdirSync(dir)
      .filter((name) => /^top-.*\.(jpe?g|png)$/i.test(name))
      .sort()
      .map((name) => join(dir, name));
    return { session, photos };
  })
  .filter((s) => s.photos.length > 0);

if (sessions.length === 0) {
  fail(
    `No "top-*.jpg" photos found in any session directory under ${FIXTURES_DIR}.`,
  );
}

interface MeasurementJson {
  readonly handLengthMm: number;
  readonly [key: string]: unknown;
}

interface PhotoResult {
  readonly photo: string;
  readonly handLengthMm: number | null;
  readonly retakeReason: string | null;
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Dev server at ${url} did not become ready in time.`);
}

async function measurePhoto(
  page: import("@playwright/test").Page,
  photoPath: string,
): Promise<PhotoResult> {
  await page.goto(`${baseUrl}/scan`);
  await page
    .getByRole("button", { name: hand === "left" ? "Left hand" : "Right hand" })
    .click();
  await page.setInputFiles("#top-down-photo", photoPath);

  const status = page.locator("[data-testid='scan-status']");
  await status
    .filter({ hasText: /./ })
    .first()
    .waitFor({ state: "attached", timeout: 30_000 });

  // Poll until the status stops changing (settles on either measurements
  // or a retake message) instead of guessing a fixed delay.
  let lastText = "";
  for (let i = 0; i < 60; i++) {
    const text = (await status.textContent()) ?? "";
    const measurementsJson = await page
      .locator("[data-testid='scan-measurements-json']")
      .count();
    if (measurementsJson > 0) break;
    if (text === lastText && text.length > 0 && !text.includes("…")) break;
    lastText = text;
    await page.waitForTimeout(500);
  }

  const measurementsCount = await page
    .locator("[data-testid='scan-measurements-json']")
    .count();
  if (measurementsCount > 0) {
    const json = await page
      .locator("[data-testid='scan-measurements-json']")
      .textContent();
    const measurements = JSON.parse(json ?? "{}") as MeasurementJson;
    return {
      photo: photoPath,
      handLengthMm: measurements.handLengthMm,
      retakeReason: null,
    };
  }

  const reason = await status.textContent();
  return {
    photo: photoPath,
    handLengthMm: null,
    retakeReason: reason ?? "(unknown failure)",
  };
}

async function main() {
  console.log(`Starting dev server on ${baseUrl} …`);
  const server: ChildProcess = spawn(
    "npx",
    ["next", "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    { stdio: "ignore", shell: true },
  );

  try {
    await waitForServer(`${baseUrl}/scan`, 60_000);

    const browser = await chromium.launch();
    const page = await browser.newPage();

    console.log(
      `\nReplaying ${sessions.reduce((n, s) => n + s.photos.length, 0)} photo(s) across ${sessions.length} session(s), hand=${hand}\n`,
    );

    let anyFailure = false;
    const sessionSummaries: {
      session: string;
      lengths: number[];
      failures: number;
    }[] = [];

    for (const { session, photos } of sessions) {
      console.log(`Session: ${session}`);
      const lengths: number[] = [];
      let failures = 0;
      for (const photo of photos) {
        const result = await measurePhoto(page, photo);
        if (result.handLengthMm !== null) {
          lengths.push(result.handLengthMm);
          console.log(
            `  ${photo}: handLengthMm = ${result.handLengthMm.toFixed(1)}`,
          );
        } else {
          failures++;
          anyFailure = true;
          console.log(`  ${photo}: FAILED GATE — ${result.retakeReason}`);
        }
      }
      sessionSummaries.push({ session, lengths, failures });
    }

    await browser.close();

    console.log("\n--- Summary ---");
    for (const { session, lengths, failures } of sessionSummaries) {
      if (lengths.length === 0) {
        console.log(
          `${session}: no successful measurements (${failures} failed)`,
        );
        continue;
      }
      const max = Math.max(...lengths);
      const min = Math.min(...lengths);
      const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      const repeatability = max - min;
      const error = Math.abs(mean - truth.handLengthMm);
      console.log(
        `${session}: n=${lengths.length} mean=${mean.toFixed(2)}mm repeatability=±${(repeatability / 2).toFixed(2)}mm (max-min=${repeatability.toFixed(2)}mm) error-vs-truth=${error.toFixed(2)}mm${failures > 0 ? ` (${failures} photo(s) failed a gate)` : ""}`,
      );
    }
    console.log(
      `\nTruth: handLengthMm=${truth.handLengthMm}, palmWidthMm=${truth.palmWidthMm}`,
    );
    console.log(
      "\nM2 gate (docs/PLAN.md §M2): repeatability ≤ ±1.5mm across photos, accuracy ≤ ±2mm vs ruler.",
    );

    if (anyFailure) {
      console.log(
        "\nOne or more photos failed a quality gate — see FAILED GATE lines above.",
      );
    }
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
